import { useState } from "react";
import type { ProjectSyncState } from "./model";

/** Small inline modal: generate a fresh pairing code to show on this device,
 *  or type in a code shown on another device to join its sync group. No
 *  accounts, no external service -- possession of the code is the whole
 *  authorization model, same as a shared link. */
function PairingModal({ onGenerate, onPair, onClose }: { onGenerate: () => string; onPair: (code: string) => boolean; onClose: () => void }) {
  const [mode, setMode] = useState<"choose" | "generated" | "enter">("choose");
  const [generatedCode, setGeneratedCode] = useState("");
  const [enteredCode, setEnteredCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  return <div role="dialog" aria-label="Pair this device" className="mt-2 p-3 border border-neutral-700 rounded bg-neutral-900">
    {mode === "choose" && <>
      <p className="text-[10px] text-neutral-300 mb-2">Pair this device to sync a project across your own devices. No account needed.</p>
      <div className="flex gap-2">
        <button data-testid="button-generate-pairing-code" onClick={() => { setGeneratedCode(onGenerate()); setMode("generated"); }} className="text-[10px] px-2 py-1 rounded bg-orange-500 text-neutral-950">Start on this device</button>
        <button data-testid="button-enter-pairing-code" onClick={() => setMode("enter")} className="text-[10px] px-2 py-1 rounded border border-neutral-700">I have a code</button>
        <button onClick={onClose} className="text-[10px] px-2 py-1 rounded text-neutral-500 ml-auto">Cancel</button>
      </div>
    </>}
    {mode === "generated" && <>
      <p className="text-[10px] text-neutral-300 mb-1">Enter this code on your other device to link it:</p>
      <p data-testid="text-pairing-code" className="text-sm font-mono tracking-wider text-orange-400 mb-2 select-all">{generatedCode}</p>
      <button onClick={onClose} className="text-[10px] px-2 py-1 rounded bg-orange-500 text-neutral-950">Done</button>
    </>}
    {mode === "enter" && <>
      <p className="text-[10px] text-neutral-300 mb-2">Enter the code shown on your other device:</p>
      <input data-testid="input-pairing-code" value={enteredCode} onChange={(e) => { setEnteredCode(e.target.value); setError(null); }}
        placeholder="ABCD-EFGH-JKMN" className="text-[10px] font-mono w-full px-2 py-1 rounded bg-neutral-950 border border-neutral-700 text-neutral-100 mb-2" />
      {error && <p className="text-[10px] text-amber-400 mb-2">{error}</p>}
      <div className="flex gap-2">
        <button data-testid="button-confirm-pairing-code" onClick={() => { if (onPair(enteredCode)) onClose(); else setError("That code doesn't look right -- check for typos."); }} className="text-[10px] px-2 py-1 rounded bg-orange-500 text-neutral-950">Pair</button>
        <button onClick={() => setMode("choose")} className="text-[10px] px-2 py-1 rounded text-neutral-500">Back</button>
      </div>
    </>}
  </div>;
}

export default function SyncPanel({ state, signedIn, pairingCode, onPair, onUnpair, onGenerate, onEnable, onDisable, onRetry, onResolve }: {
  state: ProjectSyncState; signedIn: boolean; pairingCode: string | null;
  onPair: (code: string) => boolean; onUnpair: () => void; onGenerate: () => string;
  onEnable: () => void; onDisable: () => void; onRetry: () => void; onResolve: (choice: "local" | "remote") => void;
}) {
  const [showPairing, setShowPairing] = useState(false);
  const progress = state.totalBytes ? Math.min(100, Math.round(state.transferredBytes / state.totalBytes * 100)) : 0;
  return <section aria-label="Cloud sync" className="p-3 border-b border-neutral-800 bg-neutral-950">
    <div className="flex items-center gap-2">
      <strong className="text-[10px] uppercase tracking-wider">Device sync</strong>
      {signedIn && <span className="text-[9px] font-mono text-neutral-500">{pairingCode}</span>}
      <span data-testid="status-cloud-sync" role="status" className={`text-[9px] ml-auto ${state.phase === "conflict" || state.phase === "quota" || state.phase === "error" ? "text-amber-400" : state.phase === "synced" ? "text-emerald-400" : "text-neutral-400"}`}>{state.phase}</span>
    </div>
    <p className="text-[10px] text-neutral-400 mt-1">{state.message}</p>
    {state.totalBytes > 0 && <div className="mt-2 h-1 bg-neutral-800 rounded"><div className="h-full bg-orange-500 rounded" style={{ width: `${progress}%` }} /></div>}
    <div className="flex gap-2 mt-2">
      {!state.enabled ? signedIn
        ? <button data-testid="button-enable-sync" onClick={onEnable} className="text-[10px] px-2 py-1 rounded bg-orange-500 text-neutral-950">Enable sync</button>
        : <button data-testid="button-sign-in-sync" onClick={() => setShowPairing(true)} className="text-[10px] px-2 py-1 rounded bg-orange-500 text-neutral-950">Pair this device</button>
        : <button data-testid="button-disable-sync" onClick={onDisable} className="text-[10px] px-2 py-1 rounded border border-neutral-700">Keep local only</button>}
      {signedIn && <button data-testid="button-unpair" onClick={onUnpair} className="text-[10px] px-2 py-1 rounded text-neutral-500">Unpair</button>}
      {(state.phase === "offline" || state.phase === "error" || state.phase === "quota" || state.phase === "pending") && <button data-testid="button-retry-sync" onClick={onRetry} className="text-[10px] px-2 py-1 rounded border border-neutral-700">Retry now</button>}
    </div>
    {showPairing && <PairingModal onGenerate={onGenerate} onPair={onPair} onClose={() => setShowPairing(false)} />}
    {state.phase === "conflict" && <div className="mt-2 p-2 border border-amber-700/50 rounded">
      <p className="text-[10px] text-amber-300">Review required. Both copies are preserved.</p>
      <div className="flex gap-2 mt-2">
        <button data-testid="button-keep-local" onClick={() => onResolve("local")} className="text-[10px] px-2 py-1 rounded bg-orange-500 text-neutral-950">Keep this device</button>
        <button data-testid="button-use-cloud" onClick={() => onResolve("remote")} className="text-[10px] px-2 py-1 rounded border border-neutral-600">Use cloud copy</button>
      </div>
    </div>}
  </section>;
}
