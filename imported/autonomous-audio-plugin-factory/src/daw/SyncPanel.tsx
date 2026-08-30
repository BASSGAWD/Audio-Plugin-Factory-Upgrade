import type { ProjectSyncState } from "./model";
import { SignInButton } from "@clerk/react";

export default function SyncPanel({ state, signedIn, onEnable, onDisable, onRetry, onResolve }: {
  state: ProjectSyncState; signedIn: boolean; onEnable: () => void; onDisable: () => void; onRetry: () => void; onResolve: (choice: "local" | "remote") => void;
}) {
  const progress = state.totalBytes ? Math.min(100, Math.round(state.transferredBytes / state.totalBytes * 100)) : 0;
  return <section aria-label="Cloud sync" className="p-3 border-b border-neutral-800 bg-neutral-950">
    <div className="flex items-center gap-2">
      <strong className="text-[10px] uppercase tracking-wider">Cloud sync</strong>
      <span data-testid="status-cloud-sync" role="status" className={`text-[9px] ml-auto ${state.phase === "conflict" || state.phase === "quota" || state.phase === "error" ? "text-amber-400" : state.phase === "synced" ? "text-emerald-400" : "text-neutral-400"}`}>{state.phase}</span>
    </div>
    <p className="text-[10px] text-neutral-400 mt-1">{state.message}</p>
    {state.totalBytes > 0 && <div className="mt-2 h-1 bg-neutral-800 rounded"><div className="h-full bg-orange-500 rounded" style={{ width: `${progress}%` }} /></div>}
    <div className="flex gap-2 mt-2">
      {!state.enabled ? signedIn
        ? <button data-testid="button-enable-sync" onClick={onEnable} className="text-[10px] px-2 py-1 rounded bg-orange-500 text-neutral-950">Enable sync</button>
        : <SignInButton mode="modal"><button data-testid="button-sign-in-sync" className="text-[10px] px-2 py-1 rounded bg-orange-500 text-neutral-950">Sign in to sync</button></SignInButton>
        : <button data-testid="button-disable-sync" onClick={onDisable} className="text-[10px] px-2 py-1 rounded border border-neutral-700">Keep local only</button>}
      {(state.phase === "offline" || state.phase === "error" || state.phase === "quota" || state.phase === "pending") && <button data-testid="button-retry-sync" onClick={onRetry} className="text-[10px] px-2 py-1 rounded border border-neutral-700">Retry now</button>}
    </div>
    {state.phase === "conflict" && <div className="mt-2 p-2 border border-amber-700/50 rounded">
      <p className="text-[10px] text-amber-300">Review required. Both copies are preserved.</p>
      <div className="flex gap-2 mt-2">
        <button data-testid="button-keep-local" onClick={() => onResolve("local")} className="text-[10px] px-2 py-1 rounded bg-orange-500 text-neutral-950">Keep this device</button>
        <button data-testid="button-use-cloud" onClick={() => onResolve("remote")} className="text-[10px] px-2 py-1 rounded border border-neutral-600">Use cloud copy</button>
      </div>
    </div>}
  </section>;
}