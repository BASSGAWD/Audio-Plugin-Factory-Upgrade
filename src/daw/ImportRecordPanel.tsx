import { useRef, useState } from "react";
import { Circle, FileAudio, Mic, Square } from "lucide-react";
import { BrowserRecorder, RecordingError } from "./assets";

interface ImportedAudio {
  name: string;
  blob: Blob;
  source: "import" | "record";
}

interface ImportRecordPanelProps {
  armedTrackName: string | null;
  onAudio: (audio: ImportedAudio) => void;
}

export default function ImportRecordPanel({ armedTrackName, onAudio }: ImportRecordPanelProps) {
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("Choose a local audio file or arm one track to record.");
  const recorderRef = useRef<BrowserRecorder | null>(null);

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setStatus(`Importing ${file.name} to durable project storage…`);
    onAudio({ name: file.name, blob: file, source: "import" });
  };

  const startRecording = async () => {
    if (!armedTrackName) {
      setStatus("Arm exactly one destination track before recording.");
      return;
    }
    try {
      const recorder = new BrowserRecorder();
      recorderRef.current = recorder;
      await recorder.start();
      setRecording(true);
      setStatus(`Recording into ${armedTrackName}…`);
    } catch (error) {
      setStatus(`Microphone unavailable: ${error instanceof RecordingError ? error.message : error instanceof Error ? error.message : "request failed"}.`);
    }
  };

  const stopRecording = async () => {
    try {
      const blob = await recorderRef.current?.stop();
      if (!blob) throw new Error("Recording produced no audio");
      const name = `Take ${new Date().toLocaleTimeString()}.webm`;
      onAudio({ name, blob, source: "record" });
      setStatus(`Recording captured for ${armedTrackName}; decoding and saving…`);
    } catch (error) {
      setStatus(`Recording failed: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally {
      recorderRef.current = null;
      setRecording(false);
    }
  };

  return (
    <section aria-label="Import and record" className="h-full flex flex-col">
      <div className="h-10 px-3 border-b border-neutral-800 flex items-center"><h2 className="text-xs font-semibold uppercase tracking-wider">Capture</h2></div>
      <div className="p-3 space-y-3">
        <label data-testid="button-import-audio" className="flex items-center justify-center gap-2 p-3 border border-dashed border-neutral-700 rounded-lg hover:border-orange-500 cursor-pointer text-xs">
          <FileAudio className="w-4 h-4 text-orange-400" /> Import WAV, MP3, or browser-decodable audio
          <input data-testid="input-import-audio" type="file" accept="audio/*" className="sr-only" onChange={(event) => void importFile(event.target.files?.[0])} />
        </label>
        <div className="flex items-center gap-2">
          <button data-testid={recording ? "button-stop-recording" : "button-start-recording"} type="button" onClick={recording ? () => void stopRecording() : () => void startRecording()} className={`flex items-center gap-2 px-3 py-2 rounded text-xs ${recording ? "bg-rose-600 text-white" : "bg-neutral-800 hover:bg-neutral-700"}`}>
            {recording ? <Square className="w-3.5 h-3.5 fill-current" /> : <Circle className="w-3.5 h-3.5 fill-rose-500 text-rose-500" />}{recording ? "Stop recording" : "Record armed track"}
          </button>
          <span className="text-[10px] text-neutral-500 flex items-center gap-1"><Mic className="w-3 h-3" />{armedTrackName ?? "No track armed"}</span>
        </div>
        <p data-testid="status-capture" role="status" className="text-[11px] leading-relaxed text-neutral-400">{status}</p>
      </div>
    </section>
  );
}

export type { ImportedAudio };