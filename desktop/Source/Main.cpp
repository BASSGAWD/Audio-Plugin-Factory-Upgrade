#include <JuceHeader.h>
#include <atomic>
#include <algorithm>
#include <array>
#include <cmath>
#include <map>
#include <iostream>
#include <vector>

namespace
{
constexpr int projectVersion = 3;

float number (const juce::var& object, const juce::Identifier& key, float fallback)
{
    if (auto* dynamic = object.getDynamicObject(); dynamic != nullptr && dynamic->hasProperty (key))
        return static_cast<float> (dynamic->getProperty (key));
    return fallback;
}

juce::String text (const juce::var& object, const juce::Identifier& key)
{
    if (auto* dynamic = object.getDynamicObject(); dynamic != nullptr)
        return dynamic->getProperty (key).toString();
    return {};
}

struct BundleDocument
{
    juce::File root;
    juce::var project;

    juce::Result open (const juce::File& directory)
    {
        auto jsonFile = directory.getChildFile ("project.json");
        if (! directory.isDirectory() || ! jsonFile.existsAsFile())
            return juce::Result::fail ("Choose an .ojdaw directory containing project.json");
        auto parsed = juce::JSON::parse (jsonFile);
        if (parsed.isVoid() || ! parsed.isObject())
            return juce::Result::fail ("project.json is not valid JSON");
        if (static_cast<int> (parsed.getProperty ("version", 0)) != projectVersion)
            return juce::Result::fail ("Only canonical DawProject version 3 is supported");
        for (const auto& required : { "id", "name", "tracks", "buses", "routes", "automation", "assets", "transport" })
            if (! parsed.hasProperty (required))
                return juce::Result::fail ("project.json is missing " + juce::String (required));
        auto assetList = parsed.getProperty ("assets", {});
        if (auto* assets = assetList.getArray())
            for (const auto& asset : *assets)
            {
                auto id = text (asset, "id");
                if (! id.containsOnly ("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"))
                    return juce::Result::fail ("Unsafe asset id " + id);
                auto matches = directory.getChildFile ("assets").findChildFiles (juce::File::findFiles, false, id + ".*");
                if (matches.size() != 1)
                    return juce::Result::fail ("Expected exactly one assets/" + id + ".* file");
                if (matches[0].getSize() != static_cast<juce::int64> (number (asset, "byteLength", -1)))
                    return juce::Result::fail ("Asset byte length mismatch: " + id);
            }
        root = directory;
        project = parsed;
        return juce::Result::ok();
    }

    juce::Result save (const juce::File& directory)
    {
        if (project.isVoid()) return juce::Result::fail ("No project is open");
        if (auto result = directory.createDirectory(); result.failed())
            return juce::Result::fail ("Could not create bundle directory: " + result.getErrorMessage());
        auto assets = directory.getChildFile ("assets");
        if (auto result = assets.createDirectory(); result.failed())
            return juce::Result::fail ("Could not create assets directory: " + result.getErrorMessage());
        if (root != directory && root.isDirectory())
            for (const auto& source : root.getChildFile ("assets").findChildFiles (juce::File::findFiles, false))
                if (! source.copyFileTo (assets.getChildFile (source.getFileName())))
                    return juce::Result::fail ("Could not copy " + source.getFileName());
        auto target = directory.getChildFile ("project.json");
        if (! target.replaceWithText (juce::JSON::toString (project, true) + "\n"))
            return juce::Result::fail ("Could not write project.json");
        root = directory;
        return juce::Result::ok();
    }
};

struct AutomationLane
{
    juce::String kind, owner, parameter;
    float fallback = 0.0f;
    juce::Array<juce::Point<double>> points;
    float at (double seconds) const noexcept
    {
        if (points.isEmpty()) return fallback;
        if (seconds <= points[0].x) return static_cast<float> (points[0].y);
        for (int i = 1; i < points.size(); ++i)
            if (seconds <= points[i].x)
            {
                const auto& a = points[i - 1]; const auto& b = points[i];
                auto alpha = (seconds - a.x) / juce::jmax (1.0e-12, b.x - a.x);
                return static_cast<float> (a.y + alpha * (b.y - a.y));
            }
        return static_cast<float> (points.getLast().y);
    }
};

/** Canonical v3 graph. All strings, vectors, decoding and sorting happen in
    load(); process() only traverses stable storage and fixed-size bus scratch. */
class CanonicalEngine
{
public:
    struct Metrics
    {
        double inputMs{}, outputMs{};
        double maxCallbackMs{};
        uint64_t callbacks{}, deadlineMisses{}, irregularBlocks{};
        int driverXruns = -1;
    };

    juce::Result load (const juce::var& project, const juce::File& bundleRoot = {},
                       const juce::var& fixtureAudio = {})
    {
        loading.store (true, std::memory_order_release);
        while (activeCallbacks.load (std::memory_order_acquire) != 0)
            juce::Thread::yield();

        Graph next;
        auto fail = [&] (juce::String message)
        {
            loading.store (false, std::memory_order_release);
            return juce::Result::fail (message);
        };
        if (static_cast<int> (project.getProperty ("version", 0)) != projectVersion)
            return fail ("Engine requires DawProject v3");

        auto assetValues = project.getProperty ("assets", {});
        if (auto* assets = assetValues.getArray())
            for (const auto& value : *assets)
            {
                Asset asset;
                asset.id = text (value, "id");
                asset.rate = number (value, "sampleRate", 0);
                if (auto* dynamic = fixtureAudio.getDynamicObject())
                {
                    auto sampleValues = dynamic->getProperty (asset.id);
                    if (auto* samples = sampleValues.getArray())
                    {
                        asset.left.ensureStorageAllocated (samples->size());
                        for (const auto& sample : *samples) asset.left.add (static_cast<float> (sample));
                        asset.right = asset.left;
                    }
                }
                if (asset.left.isEmpty() && bundleRoot.isDirectory())
                {
                    auto matches = bundleRoot.getChildFile ("assets").findChildFiles (
                        juce::File::findFiles, false, asset.id + ".*");
                    if (matches.size() != 1) return fail ("Audio asset is unavailable: " + asset.id);
                    juce::AudioFormatManager formats;
                    formats.registerBasicFormats();
                    std::unique_ptr<juce::AudioFormatReader> reader (formats.createReaderFor (matches[0]));
                    if (reader == nullptr) return fail ("Could not decode audio asset: " + asset.id);
                    asset.rate = reader->sampleRate;
                    auto frames = static_cast<int> (reader->lengthInSamples);
                    asset.left.resize (frames); asset.right.resize (frames);
                    float* channels[] { asset.left.getRawDataPointer(), asset.right.getRawDataPointer() };
                    if (! reader->read (channels, 2, 0, frames))
                        return fail ("Could not read audio asset: " + asset.id);
                }
                next.assets.push_back (std::move (asset));
            }

        auto busValues = project.getProperty ("buses", {});
        if (auto* buses = busValues.getArray())
            for (const auto& value : *buses)
            {
                Bus bus;
                bus.id = text (value, "id"); bus.master = text (value, "kind") == "master";
                bus.gain = number (value, "gain", 1); bus.pan = number (value, "pan", 0);
                if (auto result = parsePlugins (value.getProperty ("inserts", {}), bus.plugins); result.failed())
                    return fail ("Bus " + bus.id + ": " + result.getErrorMessage());
                next.buses.push_back (std::move (bus));
            }
        if (next.buses.size() > maxBuses) return fail ("Native graph supports at most 64 buses");

        auto trackValues = project.getProperty ("tracks", {});
        if (auto* tracks = trackValues.getArray())
            for (const auto& value : *tracks)
            {
                Track track;
                track.id = text (value, "id"); track.gain = number (value, "gain", 1);
                track.pan = number (value, "pan", 0); track.mute = value.getProperty ("mute", false);
                track.solo = value.getProperty ("solo", false); track.live = value.getProperty ("armed", false);
                if (auto result = parsePlugins (value.getProperty ("inserts", {}), track.plugins); result.failed())
                    return fail ("Track " + track.id + ": " + result.getErrorMessage());
                auto clipValues = value.getProperty ("clips", {});
                if (auto* clips = clipValues.getArray())
                    for (const auto& item : *clips)
                    {
                        Clip clip;
                        auto assetId = text (item, "assetId");
                        clip.asset = findAsset (next, assetId);
                        if (clip.asset < 0) return fail ("Clip references missing asset: " + assetId);
                        clip.start = number (item, "start", 0); clip.offset = number (item, "offset", 0);
                        clip.duration = number (item, "duration", 0);
                        clip.sourceDuration = number (item, "sourceDuration", 0);
                        clip.gain = number (item, "gain", 1); clip.fadeIn = number (item, "fadeIn", 0);
                        clip.fadeOut = number (item, "fadeOut", 0); clip.loop = item.getProperty ("loop", false);
                        track.clips.push_back (clip);
                    }
                auto sendValues = value.getProperty ("sends", {});
                if (auto* sends = sendValues.getArray())
                    for (const auto& item : *sends)
                    {
                        auto busId = text (item, "busId");
                        track.sends.push_back ({ findBus (next, busId), number (item, "gain", 1),
                            static_cast<bool> (item.getProperty ("preFader", false)), "send:" + busId + ":gain" });
                    }
                next.tracks.push_back (std::move (track));
            }
        if (next.tracks.size() > maxTracks) return fail ("Native graph supports at most 64 tracks");

        auto routeValues = project.getProperty ("routes", {});
        if (auto* routes = routeValues.getArray())
            for (const auto& value : *routes)
                if (static_cast<bool> (value.getProperty ("enabled", false)))
                {
                    auto source = findTrack (next, text (value, "sourceTrackId"));
                    auto destination = findTrack (next, text (value, "destinationTrackId"));
                    auto pluginId = text (value, "pluginInstanceId");
                    bool supported = false;
                    if (destination >= 0)
                        for (const auto& plugin : next.tracks[static_cast<size_t> (destination)].plugins)
                            supported = supported || (plugin.id == pluginId && plugin.sidechain);
                    // Matches bounce.ts: malformed/unsupported routes do not
                    // feed a detector. The UI graph reports those warnings.
                    if (source >= 0 && destination >= 0 && source != destination && supported)
                        next.routes.push_back ({ source, destination, pluginId });
                }

        auto laneValues = project.getProperty ("automation", {});
        if (auto* lanes = laneValues.getArray())
            for (const auto& value : *lanes)
            {
                if (! static_cast<bool> (value.getProperty ("enabled", false))) continue;
                Lane lane;
                auto target = value.getProperty ("target", {});
                lane.kind = text (target, "kind"); lane.owner = text (target, "ownerId");
                lane.parameter = text (target, "parameterId");
                lane.fallback = number (value, "defaultValue", 0);
                auto pointValues = value.getProperty ("points", {});
                if (auto* points = pointValues.getArray())
                    for (const auto& item : *points)
                        lane.points.push_back ({ number (item, "time", 0), number (item, "value", 0),
                                                text (item, "curve"), text (item, "id") });
                std::sort (lane.points.begin(), lane.points.end(), [] (const Point& a, const Point& b) {
                    return a.time != b.time ? a.time < b.time : a.id < b.id;
                });
                next.lanes.push_back (std::move (lane));
            }
        graph = std::move (next);
        samplePosition = 0;
        loading.store (false, std::memory_order_release);
        return juce::Result::ok();
    }

    void prepare (double rate, int block) noexcept
    {
        sampleRate = rate; expectedBlock = block; samplePosition = 0;
        callbacks.store (0); deadlineMisses.store (0); irregularBlocks.store (0);
        maxCallbackNanoseconds.store (0);
    }

    void process (const float* const* input, int inputChannels, float* const* output,
                  int outputChannels, int frames) noexcept
    {
        activeCallbacks.fetch_add (1, std::memory_order_acq_rel);
        if (loading.load (std::memory_order_acquire))
        {
            for (int ch = 0; ch < outputChannels; ++ch)
                juce::FloatVectorOperations::clear (output[ch], frames);
            activeCallbacks.fetch_sub (1, std::memory_order_release);
            return;
        }
        const auto started = juce::Time::getHighResolutionTicks();
        const bool anySolo = std::any_of (graph.tracks.begin(), graph.tracks.end(),
                                         [] (const Track& t) { return t.solo; });
        for (int frame = 0; frame < frames; ++frame)
        {
            const double time = static_cast<double> (samplePosition + frame) / sampleRate;
            std::array<Stereo, maxTracks> raw {};
            std::array<Stereo, maxBuses> returns {};
            for (size_t ti = 0; ti < graph.tracks.size() && ti < maxTracks; ++ti)
            {
                raw[ti] = arrangementSample (graph.tracks[ti], time);
                if (graph.tracks[ti].live && inputChannels > 0)
                {
                    raw[ti].l += input[0] != nullptr ? input[0][frame] : 0;
                    raw[ti].r += input[juce::jmin (1, inputChannels - 1)] != nullptr
                        ? input[juce::jmin (1, inputChannels - 1)][frame] : raw[ti].l;
                }
            }
            Stereo master;
            for (size_t ti = 0; ti < graph.tracks.size() && ti < maxTracks; ++ti)
            {
                const auto& track = graph.tracks[ti];
                if (track.mute || (anySolo && ! track.solo)) continue;
                auto signal = raw[ti];
                for (const auto& plugin : track.plugins)
                    if (plugin.enabled) signal = runPlugin (plugin, signal, sidechain (ti, plugin.id, raw), time);
                for (const auto& send : track.sends)
                    if (send.bus >= 0 && send.bus < static_cast<int> (maxBuses))
                    {
                        auto tapped = send.pre ? signal : gainPan (signal,
                            lane ("track", track.id, "gain", time, track.gain),
                            lane ("track", track.id, "pan", time, track.pan));
                        auto sendGain = lane ("track", track.id, send.parameter, time, send.gain);
                        returns[send.bus] += tapped * sendGain;
                    }
                master += gainPan (signal, lane ("track", track.id, "gain", time, track.gain),
                                    lane ("track", track.id, "pan", time, track.pan));
            }
            for (size_t bi = 0; bi < graph.buses.size(); ++bi)
            {
                const auto& bus = graph.buses[bi];
                if (bus.master) continue;
                auto signal = returns[bi];
                for (const auto& plugin : bus.plugins)
                    if (plugin.enabled) signal = runPlugin (plugin, signal, {}, time);
                master += gainPan (signal, lane ("bus", bus.id, "gain", time, bus.gain),
                                    lane ("bus", bus.id, "pan", time, bus.pan));
            }
            for (const auto& bus : graph.buses) if (bus.master)
            {
                for (const auto& plugin : bus.plugins)
                    if (plugin.enabled) master = runPlugin (plugin, master, {}, time);
                master = gainPan (master, lane ("bus", bus.id, "gain", time, bus.gain),
                                  lane ("bus", bus.id, "pan", time, bus.pan));
                break;
            }
            if (outputChannels > 0) output[0][frame] = sanitize (master.l);
            if (outputChannels > 1) output[1][frame] = sanitize (master.r);
        }
        samplePosition += frames;
        callbacks.fetch_add (1, std::memory_order_relaxed);
        const auto elapsed = juce::Time::highResolutionTicksToSeconds (
            juce::Time::getHighResolutionTicks() - started);
        const auto elapsedNanoseconds = static_cast<uint64_t> (elapsed * 1.0e9);
        auto previousMaximum = maxCallbackNanoseconds.load (std::memory_order_relaxed);
        while (previousMaximum < elapsedNanoseconds
               && ! maxCallbackNanoseconds.compare_exchange_weak (
                   previousMaximum, elapsedNanoseconds, std::memory_order_relaxed)) {}
        if (elapsed > static_cast<double> (frames) / sampleRate)
            deadlineMisses.fetch_add (1, std::memory_order_relaxed);
        if (frames != expectedBlock) irregularBlocks.fetch_add (1, std::memory_order_relaxed);
        activeCallbacks.fetch_sub (1, std::memory_order_release);
    }

    Metrics metrics (juce::AudioIODevice* device) const noexcept
    {
        Metrics m;
        if (device != nullptr)
        {
            m.inputMs = 1000.0 * device->getInputLatencyInSamples() / device->getCurrentSampleRate();
            m.outputMs = 1000.0 * device->getOutputLatencyInSamples() / device->getCurrentSampleRate();
            m.driverXruns = device->getXRunCount();
        }
        m.callbacks = callbacks.load();
        m.deadlineMisses = deadlineMisses.load();
        m.irregularBlocks = irregularBlocks.load();
        m.maxCallbackMs = static_cast<double> (maxCallbackNanoseconds.load()) / 1.0e6;
        return m;
    }

private:
    static constexpr size_t maxTracks = 64, maxBuses = 64;
    struct Stereo {
        float l{}, r{};
        Stereo& operator+= (Stereo x) noexcept { l += x.l; r += x.r; return *this; }
        Stereo operator* (float x) const noexcept { return { l * x, r * x }; }
    };
    struct Asset { juce::String id; double rate{}; juce::Array<float> left, right; };
    struct Clip { int asset{-1}; double start{}, offset{}, duration{}, sourceDuration{}; float gain{1}, fadeIn{}, fadeOut{}; bool loop{}; };
    struct Plugin { juce::String id, pluginId; bool enabled{}, sidechain{}; float gain{1}, mix{}; };
    struct Send { int bus{-1}; float gain{1}; bool pre{}; juce::String parameter; };
    struct Track { juce::String id; float gain{1}, pan{}; bool mute{}, solo{}, live{}; std::vector<Clip> clips; std::vector<Plugin> plugins; std::vector<Send> sends; };
    struct Bus { juce::String id; bool master{}; float gain{1}, pan{}; std::vector<Plugin> plugins; };
    struct Route { int source{-1}, destination{-1}; juce::String plugin; };
    struct Point { double time{}, value{}; juce::String curve, id; };
    struct Lane { juce::String kind, owner, parameter; float fallback{}; std::vector<Point> points; };
    struct Graph { std::vector<Asset> assets; std::vector<Track> tracks; std::vector<Bus> buses; std::vector<Route> routes; std::vector<Lane> lanes; };

    static juce::Result parsePlugins (const juce::var& list, std::vector<Plugin>& output)
    {
        if (auto* plugins = list.getArray()) for (const auto& item : *plugins)
        {
            auto parameters = item.getProperty ("parameters", {});
            auto routing = item.getProperty ("routing", {});
            auto auxiliary = routing.getProperty ("auxiliaryInput", {});
            const auto enabled = static_cast<bool> (item.getProperty ("enabled", true));
            const auto pluginId = text (item, "pluginId");
            if (enabled && pluginId != "generated.gain/v1" && pluginId != "generated.ducker/v1")
                return juce::Result::fail ("Unsupported enabled native plugin "
                    + text (item, "name") + " (" + pluginId + ")");
            output.push_back ({ text (item, "id"), pluginId, enabled,
                static_cast<bool> (auxiliary.getProperty ("supported", false)),
                number (parameters, "gain", 1), number (parameters, "mix", 0) });
        }
        return juce::Result::ok();
    }
    static int findAsset (const Graph& g, const juce::String& id) { for (size_t i=0;i<g.assets.size();++i) if(g.assets[i].id==id)return static_cast<int>(i); return -1; }
    static int findBus (const Graph& g, const juce::String& id) { for (size_t i=0;i<g.buses.size();++i) if(g.buses[i].id==id)return static_cast<int>(i); return -1; }
    static int findTrack (const Graph& g, const juce::String& id) { for (size_t i=0;i<g.tracks.size();++i) if(g.tracks[i].id==id)return static_cast<int>(i); return -1; }
    float lane (juce::StringRef kind, juce::StringRef owner, juce::StringRef parameter,
                double time, float fallback) const noexcept
    {
        for (const auto& value : graph.lanes)
            if (value.kind == kind && value.owner == owner && value.parameter == parameter)
            {
                if (value.points.empty() || time < value.points.front().time) return value.fallback;
                auto left = value.points.front();
                for (size_t i = 1; i < value.points.size(); ++i)
                {
                    const auto& right = value.points[i];
                    if (time < right.time)
                    {
                        if (left.curve == "step" || right.time == left.time) return static_cast<float> (left.value);
                        auto x = (time - left.time) / (right.time - left.time);
                        if (left.curve == "exponential" && left.value > 0 && right.value > 0)
                            return static_cast<float> (left.value * std::pow (right.value / left.value, x));
                        return static_cast<float> (left.value + (right.value - left.value) * x);
                    }
                    left = right;
                }
                return static_cast<float> (left.value);
            }
        return fallback;
    }
    Stereo arrangementSample (const Track& track, double time) const noexcept
    {
        Stereo result;
        for (const auto& clip : track.clips)
        {
            if (time < clip.start || time >= clip.start + clip.duration) continue;
            const auto& asset = graph.assets[clip.asset];
            auto clipTime = time - clip.start;
            auto sourceTime = clip.loop ? clip.offset + std::fmod (clipTime, juce::jmax (1.0 / asset.rate, clip.sourceDuration))
                                        : clip.offset + clipTime;
            auto frame = static_cast<int64_t> (std::floor (sourceTime * asset.rate));
            if (frame < 0 || frame >= asset.left.size()) continue;
            auto fadeIn = clip.fadeIn > 0 ? juce::jlimit (0.0, 1.0, clipTime / clip.fadeIn) : 1.0;
            auto fadeOut = clip.fadeOut > 0 ? juce::jlimit (0.0, 1.0, (clip.duration - clipTime) / clip.fadeOut) : 1.0;
            auto gain = clip.gain * static_cast<float> (juce::jmin (fadeIn, fadeOut));
            result.l += asset.left[static_cast<int> (frame)] * gain;
            result.r += asset.right[static_cast<int> (frame)] * gain;
        }
        return result;
    }
    Stereo sidechain (size_t destination, const juce::String& plugin,
                      const std::array<Stereo, maxTracks>& raw) const noexcept
    {
        Stereo result;
        for (const auto& route : graph.routes)
            if (route.destination == static_cast<int> (destination) && route.plugin == plugin
                && route.source >= 0 && route.source < static_cast<int> (maxTracks))
                result += raw[static_cast<size_t> (route.source)];
        return result;
    }
    Stereo runPlugin (const Plugin& p, Stereo input, Stereo key, double time) const noexcept
    {
        if (p.pluginId == "generated.gain/v1")
        {
            auto gain = lane ("plugin", p.id, "gain", time, p.gain);
            return input * gain;
        }
        if (p.pluginId == "generated.ducker/v1")
        {
            auto mix = lane ("plugin", p.id, "mix", time, p.mix);
            auto detector = (key.l + key.r) * 0.5f;
            return input * (1.0f - juce::jmin (std::abs (detector), 1.0f) * mix);
        }
        jassertfalse; // load() rejects unsupported enabled adapters.
        return {};
    }
    static Stereo gainPan (Stereo value, float gain, float pan) noexcept
    {
        pan = juce::jlimit (-1.0f, 1.0f, pan);
        return { value.l * gain * (pan > 0 ? 1 - pan : 1),
                 value.r * gain * (pan < 0 ? 1 + pan : 1) };
    }
    static float sanitize (float value) noexcept { return std::isfinite (value) ? value : 0.0f; }
    Graph graph;
    double sampleRate = 48000.0;
    int expectedBlock = 0;
    int64_t samplePosition = 0;
    std::atomic<uint64_t> callbacks { 0 }, deadlineMisses { 0 }, irregularBlocks { 0 },
                          maxCallbackNanoseconds { 0 }, activeCallbacks { 0 };
    std::atomic<bool> loading { false };
};

class StudioComponent final : public juce::AudioAppComponent, private juce::Timer
{
public:
    StudioComponent()
    {
        addAndMakeVisible (openButton); addAndMakeVisible (saveButton);
        addAndMakeVisible (status); addAndMakeVisible (metrics);
        openButton.setButtonText ("Open .ojdaw bundle");
        saveButton.setButtonText ("Save bundle as…");
        openButton.onClick = [this] { chooseOpen(); };
        saveButton.onClick = [this] { chooseSave(); };
        status.setText ("No project open", juce::dontSendNotification);
        setAudioChannels (2, 2);
        startTimerHz (4);
    }
    ~StudioComponent() override { shutdownAudio(); }

    void prepareToPlay (int block, double rate) override { engine.prepare (rate, block); }
    void releaseResources() override {}
    void getNextAudioBlock (const juce::AudioSourceChannelInfo& info) override
    {
        const float* inputs[2] { info.buffer->getReadPointer (0, info.startSample),
                                 info.buffer->getNumChannels() > 1 ? info.buffer->getReadPointer (1, info.startSample) : nullptr };
        float* outputs[2] { info.buffer->getWritePointer (0, info.startSample),
                            info.buffer->getNumChannels() > 1 ? info.buffer->getWritePointer (1, info.startSample) : nullptr };
        engine.process (inputs, inputs[1] != nullptr ? 2 : 1, outputs,
                        outputs[1] != nullptr ? 2 : 1, info.numSamples);
    }
    void resized() override
    {
        auto r = getLocalBounds().reduced (16);
        openButton.setBounds (r.removeFromTop (34).removeFromLeft (190));
        r.removeFromTop (8); saveButton.setBounds (r.removeFromTop (34).removeFromLeft (190));
        r.removeFromTop (16); status.setBounds (r.removeFromTop (44)); metrics.setBounds (r.removeFromTop (80));
    }

private:
    void chooseOpen()
    {
        chooser = std::make_unique<juce::FileChooser> ("Open portable project bundle");
        chooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectDirectories,
            [this] (const juce::FileChooser& c) {
                auto result = document.open (c.getResult());
                if (result.wasOk()) result = engine.load (document.project, document.root);
                status.setText (result.wasOk() ? "Open: " + text (document.project, "name") : result.getErrorMessage(),
                                juce::dontSendNotification);
            });
    }
    void chooseSave()
    {
        chooser = std::make_unique<juce::FileChooser> ("Save portable project bundle");
        chooser->launchAsync (juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectDirectories,
            [this] (const juce::FileChooser& c) {
                auto result = document.save (c.getResult());
                status.setText (result.wasOk() ? "Saved " + c.getResult().getFullPathName() : result.getErrorMessage(),
                                juce::dontSendNotification);
            });
    }
    void timerCallback() override
    {
        auto m = engine.metrics (deviceManager.getCurrentAudioDevice());
        auto driverXruns = m.driverXruns >= 0 ? juce::String (m.driverXruns) : "unavailable";
        metrics.setText ("Device input latency: " + juce::String (m.inputMs, 2) + " ms\n"
                         "Device output latency: " + juce::String (m.outputMs, 2) + " ms\n"
                         "Callbacks: " + juce::String (m.callbacks)
                         + "  driver xruns: " + driverXruns
                         + "  callback deadline misses: " + juce::String (m.deadlineMisses),
                         juce::dontSendNotification);
    }
    BundleDocument document;
    CanonicalEngine engine;
    juce::TextButton openButton, saveButton;
    juce::Label status, metrics;
    std::unique_ptr<juce::FileChooser> chooser;
};

class MainWindow final : public juce::DocumentWindow
{
public:
    MainWindow() : DocumentWindow ("OrangeJUCE Studio", juce::Colours::darkgrey, allButtons)
    {
        setUsingNativeTitleBar (true); setContentOwned (new StudioComponent(), true);
        centreWithSize (620, 300); setVisible (true);
    }
    void closeButtonPressed() override { juce::JUCEApplication::getInstance()->systemRequestedQuit(); }
};

struct LatencyBenchmarkConfig
{
    int durationSeconds{};
    juce::File projectDirectory;
    juce::String deviceType, deviceName;
    double sampleRate{};
    int blockSize{};
};

class LatencyBenchmark final : private juce::AudioIODeviceCallback, private juce::Timer
{
public:
    explicit LatencyBenchmark (LatencyBenchmarkConfig requested)
        : config (std::move (requested))
    {
        duration = juce::jlimit (1, 3600, config.durationSeconds);
        auto loaded = document.open (config.projectDirectory);
        if (loaded.wasOk()) loaded = engine.load (document.project, document.root);
        if (loaded.failed())
        {
            std::cerr << "latency benchmark failed: " << loaded.getErrorMessage() << std::endl;
            juce::JUCEApplication::getInstance()->setApplicationReturnValue (2);
            juce::JUCEApplication::getInstance()->quit();
            return;
        }
        auto error = devices.initialise (2, 2, nullptr, true);
        if (error.isEmpty() && config.deviceType.isNotEmpty()
            && devices.getCurrentAudioDeviceType() != config.deviceType)
        {
            devices.setCurrentAudioDeviceType (config.deviceType, true);
            if (devices.getCurrentAudioDeviceType() != config.deviceType)
                error = "Could not select audio device type " + config.deviceType;
        }
        if (error.isEmpty())
        {
            auto setup = devices.getAudioDeviceSetup();
            setup.inputDeviceName = config.deviceName;
            setup.outputDeviceName = config.deviceName;
            setup.sampleRate = config.sampleRate;
            setup.bufferSize = config.blockSize;
            error = devices.setAudioDeviceSetup (setup, true);
        }
        if (error.isNotEmpty())
        {
            std::cerr << "latency benchmark failed: " << error << std::endl;
            juce::JUCEApplication::getInstance()->setApplicationReturnValue (2);
            juce::JUCEApplication::getInstance()->quit();
            return;
        }
        devices.addAudioCallback (this);
        startTimer (100);
    }
    ~LatencyBenchmark() override { devices.removeAudioCallback (this); }
private:
    void audioDeviceAboutToStart (juce::AudioIODevice* d) override
    {
        rate = d->getCurrentSampleRate();
        initialDriverXruns = d->getXRunCount();
        engine.prepare (rate, d->getCurrentBufferSizeSamples());
    }
    void audioDeviceStopped() override {}
    void audioDeviceIOCallbackWithContext (const float* const* input, int inputChannels, float* const* output,
                                           int outputChannels, int frames,
                                           const juce::AudioIODeviceCallbackContext&) override
    {
        const auto now = juce::Time::getHighResolutionTicks();
        auto unset = static_cast<juce::int64> (0);
        firstCallbackTicks.compare_exchange_strong (unset, now, std::memory_order_relaxed);
        const auto previous = lastCallbackTicks.exchange (now, std::memory_order_relaxed);
        if (previous > 0)
        {
            const auto gap = juce::Time::highResolutionTicksToSeconds (now - previous);
            const auto gapNanoseconds = static_cast<juce::int64> (gap * 1.0e9);
            auto previousMaximum = maxCallbackGapNanoseconds.load (std::memory_order_relaxed);
            while (previousMaximum < gapNanoseconds
                   && ! maxCallbackGapNanoseconds.compare_exchange_weak (
                       previousMaximum, gapNanoseconds, std::memory_order_relaxed)) {}
            if (gap > 1.5 * static_cast<double> (frames) / rate)
                callbackArrivalMisses.fetch_add (1, std::memory_order_relaxed);
        }
        engine.process (input, inputChannels, output, outputChannels, frames);
    }
    void timerCallback() override
    {
        const auto firstTick = firstCallbackTicks.load (std::memory_order_relaxed);
        if (firstTick <= 0) return;
        const auto elapsedSeconds = juce::Time::highResolutionTicksToSeconds (
            juce::Time::getHighResolutionTicks() - firstTick);
        if (elapsedSeconds < static_cast<double> (duration)) return;
        stopTimer();
        auto* d = devices.getCurrentAudioDevice();
        const auto measured = engine.metrics (d);
        if (d == nullptr || d->getCurrentSampleRate() <= 0 || measured.callbacks == 0)
        {
            std::cerr << "latency benchmark failed: no active native audio device callbacks" << std::endl;
            juce::JUCEApplication::getInstance()->setApplicationReturnValue (2);
            juce::JUCEApplication::getInstance()->quit();
            return;
        }
        const auto finalDriverXruns = d->getXRunCount();
        const auto driverXruns = initialDriverXruns >= 0 && finalDriverXruns >= initialDriverXruns
            ? finalDriverXruns - initialDriverXruns : -1;
        auto result = std::make_unique<juce::DynamicObject>();
        result->setProperty ("deviceType", devices.getCurrentAudioDeviceType());
        result->setProperty ("device", d->getName());
        result->setProperty ("sampleRate", d->getCurrentSampleRate());
        result->setProperty ("blockSize", d->getCurrentBufferSizeSamples());
        result->setProperty ("inputLatencySamples", d->getInputLatencyInSamples());
        result->setProperty ("outputLatencySamples", d->getOutputLatencyInSamples());
        result->setProperty ("callbacks", static_cast<juce::int64> (measured.callbacks));
        result->setProperty ("deadlineMisses", static_cast<juce::int64> (measured.deadlineMisses));
        result->setProperty ("irregularBlocks", static_cast<juce::int64> (measured.irregularBlocks));
        result->setProperty ("maxCallbackMs", measured.maxCallbackMs);
        result->setProperty ("callbackArrivalMisses", static_cast<juce::int64> (
            callbackArrivalMisses.load (std::memory_order_relaxed)));
        result->setProperty ("maxCallbackGapMs", static_cast<double> (
            maxCallbackGapNanoseconds.load (std::memory_order_relaxed)) / 1.0e6);
        result->setProperty ("driverXruns", driverXruns);
        result->setProperty ("requestedSeconds", duration);
        result->setProperty ("elapsedSeconds", elapsedSeconds);
        std::cout << juce::JSON::toString (juce::var (result.release()), false).toStdString() << std::endl;
        juce::JUCEApplication::getInstance()->quit();
    }
    juce::AudioDeviceManager devices;
    BundleDocument document;
    CanonicalEngine engine;
    LatencyBenchmarkConfig config;
    double rate = 48000.0;
    int duration = 0;
    int initialDriverXruns = -1;
    std::atomic<juce::int64> firstCallbackTicks { 0 }, lastCallbackTicks { 0 },
                             maxCallbackGapNanoseconds { 0 };
    std::atomic<uint64_t> callbackArrivalMisses { 0 };
};

class App final : public juce::JUCEApplication
{
public:
    const juce::String getApplicationName() override { return "OrangeJUCE Studio"; }
    const juce::String getApplicationVersion() override { return "0.1.0"; }
    void initialise (const juce::String& command) override
    {
        auto arguments = juce::StringArray::fromTokens (command, true);
        if (auto flag = arguments.indexOf ("--roundtrip"); flag >= 0)
        {
            if (flag + 2 >= arguments.size())
            {
                std::cerr << "--roundtrip requires input and output .ojdaw directories" << std::endl;
                setApplicationReturnValue (2); quit(); return;
            }
            BundleDocument document;
            auto result = document.open (juce::File (arguments[flag + 1]));
            if (result.wasOk()) result = document.save (juce::File (arguments[flag + 2]));
            if (result.wasOk())
            {
                BundleDocument verification;
                result = verification.open (juce::File (arguments[flag + 2]));
            }
            if (result.failed())
            {
                std::cerr << result.getErrorMessage() << std::endl;
                setApplicationReturnValue (2);
            }
            else std::cout << "{\"roundtrip\":true}" << std::endl;
            quit(); return;
        }
        if (command.contains ("--golden"))
        {
            auto flag = arguments.indexOf ("--golden");
            if (flag < 0 || flag + 1 >= arguments.size())
            {
                std::cerr << "--golden requires the checked-in fixture path" << std::endl;
                setApplicationReturnValue (2); quit(); return;
            }
            auto fixture = juce::JSON::parse (juce::File (arguments[flag + 1]));
            auto project = fixture.getProperty ("project", {});
            CanonicalEngine engine;
            auto loaded = engine.load (project, {}, fixture.getProperty ("audio", {}));
            if (loaded.failed())
            {
                std::cerr << loaded.getErrorMessage() << std::endl;
                setApplicationReturnValue (2); quit(); return;
            }
            engine.prepare (4.0, 4);
            float left[4] {}, right[4] {};
            float* outputs[] { left, right };
            engine.process (nullptr, 0, outputs, 2, 4);
            std::cout << "{\"samples\":[";
            for (int i = 0; i < 4; ++i)
            {
                if (i != 0) std::cout << ",";
                std::cout << left[i];
            }
            std::cout << "]}" << std::endl;
            quit();
            return;
        }
        if (command.contains ("--list-audio-devices"))
        {
            juce::AudioDeviceManager manager;
            juce::OwnedArray<juce::AudioIODeviceType> types;
            manager.createAudioDeviceTypes (types);
            juce::Array<juce::var> available;
            for (auto* type : types)
            {
                type->scanForDevices();
                auto entry = std::make_unique<juce::DynamicObject>();
                entry->setProperty ("deviceType", type->getTypeName());
                juce::Array<juce::var> inputs, outputs;
                for (const auto& name : type->getDeviceNames (true)) inputs.add (name);
                for (const auto& name : type->getDeviceNames (false)) outputs.add (name);
                entry->setProperty ("inputs", inputs);
                entry->setProperty ("outputs", outputs);
                available.add (juce::var (entry.release()));
            }
            std::cout << juce::JSON::toString (juce::var (available), true).toStdString() << std::endl;
            quit();
            return;
        }
        if (command.contains ("--latency-benchmark"))
        {
            auto argument = [&arguments] (const juce::String& name)
            {
                auto index = arguments.indexOf (name);
                return index >= 0 && index + 1 < arguments.size() ? arguments[index + 1] : juce::String();
            };
            auto secondsFlag = arguments.indexOf ("--seconds");
            auto seconds = secondsFlag >= 0 && secondsFlag + 1 < arguments.size()
                ? arguments[secondsFlag + 1].getIntValue() : 30;
            auto projectFlag = arguments.indexOf ("--project");
            auto deviceType = argument ("--device-type");
            auto device = argument ("--device");
            auto sampleRate = argument ("--sample-rate").getDoubleValue();
            auto blockSize = argument ("--block-size").getIntValue();
            if (projectFlag < 0 || projectFlag + 1 >= arguments.size()
                || deviceType.isEmpty() || device.isEmpty() || sampleRate <= 0 || blockSize <= 0)
            {
                std::cerr << "--latency-benchmark requires --project <bundle-dir>, --device-type <backend>, "
                             "--device <name>, --sample-rate <hz>, and --block-size <samples>" << std::endl;
                setApplicationReturnValue (2); quit(); return;
            }
            benchmark = std::make_unique<LatencyBenchmark> (LatencyBenchmarkConfig {
                seconds > 0 ? seconds : 30,
                juce::File (arguments[projectFlag + 1]),
                deviceType,
                device,
                sampleRate,
                blockSize
            });
            return;
        }
        window = std::make_unique<MainWindow>();
    }
    void shutdown() override { benchmark.reset(); window.reset(); }
private:
    std::unique_ptr<MainWindow> window;
    std::unique_ptr<LatencyBenchmark> benchmark;
};
}

START_JUCE_APPLICATION (App)