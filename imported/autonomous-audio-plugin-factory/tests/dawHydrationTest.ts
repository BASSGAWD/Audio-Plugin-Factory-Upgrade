import assert from "node:assert/strict";
import { compileAudioSoftwareProject, updateBriefDecision } from "../src/audioProjects";
import { dawProjectFromAudioProject, reconcileDawProjectWithAudioProject } from "../src/daw/DAWStudio";

const source = compileAudioSoftwareProject("Build a multitrack DAW workstation for reopen testing").project;
if (source.kind !== "daw") throw new Error("Expected a DAW project");

const saved = dawProjectFromAudioProject(source);
assert.equal(saved.id, `daw-derived-${source.id}`);
assert.equal(saved.tracks.length, source.workstation.tracks);
assert.equal(saved.transport.tempo[0]?.bpm, source.workstation.transportBpm);

const eightTrack = updateBriefDecision(source, "daw-tracks", "8 tracks");
if (eightTrack.kind !== "daw") throw new Error("Expected a revised DAW project");
const grown = reconcileDawProjectWithAudioProject(saved, eightTrack);
assert.equal(grown.project.id, saved.id, "Reopening must preserve the persisted DAW identity");
assert.equal(grown.project.tracks.length, 8, "Reopening must apply safe brief growth");
assert.equal(grown.changed, true, "Safe brief growth must be persisted");

const twoTrack = updateBriefDecision(eightTrack, "daw-tracks", "2 tracks");
if (twoTrack.kind !== "daw") throw new Error("Expected a revised DAW project");
const preserved = reconcileDawProjectWithAudioProject(grown.project, twoTrack);
assert.equal(preserved.project.tracks.length, 8, "Reopening must not delete saved tracks");
assert.match(
  preserved.limitation ?? "",
  /avoid deleting existing work/,
  "A destructive brief shrink must be disclosed instead of silently ignored",
);

console.log("DAW hydration tests passed");