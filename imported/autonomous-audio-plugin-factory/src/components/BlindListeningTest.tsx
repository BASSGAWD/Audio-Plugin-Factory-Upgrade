import React, { useEffect, useMemo, useRef, useState } from "react";
import { Ear, Play, Square, X, Trophy } from "lucide-react";
import { AudioPlugin } from "../types";
import { RankedCandidate, isNearTie, NEAR_TIE_MARGIN } from "../utils/refinementLoop";

/**
 * The "eye exam" for your ears: the perfecting loop's top versions, stripped of
 * their names and scores and shuffled into A / B / C. You audition each one
 * blind and pick the one that sounds best. Only then are the identities and
 * scores revealed.
 *
 * Final determination (the user's rule): the ear wins only on a NEAR-TIE. If the
 * picked version scores within NEAR_TIE_MARGIN of the top-ranked one, it becomes
 * the loaded plugin; otherwise the gate's clear winner stays loaded and the pick
 * is recorded. `onChoose` receives the picked candidate and whether to load it.
 */
const SLOT_LETTERS = ["A", "B", "C", "D"];
const MEDALS = ["🥇", "🥈", "🥉", "🏅"];

interface BlindListeningTestProps {
  candidates: RankedCandidate[];
  /** Start auditioning a candidate through the live audio engine. */
  onPreview: (plugin: AudioPlugin) => void;
  /** Stop audio. */
  onStop: () => void;
  /** Close the test and restore the currently-loaded plugin. */
  onClose: () => void;
  /** Apply the human verdict: load the pick when willLoad is true. */
  onChoose: (picked: RankedCandidate, willLoad: boolean) => void;
}

/** Deterministic-per-open Fisher–Yates shuffle so slot order is unpredictable
 *  but stable across re-renders while the modal is open. */
function shuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function BlindListeningTest({ candidates, onPreview, onStop, onClose, onChoose }: BlindListeningTestProps) {
  // Up to three distinct versions, shuffled into blind slots once per open.
  const seed = useMemo(() => Date.now(), []);
  const slots = useMemo(() => shuffle(candidates.slice(0, 3), seed), [candidates, seed]);

  const [playing, setPlaying] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const topScore = useMemo(() => Math.max(...candidates.map((c) => c.score)), [candidates]);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = () => {
    onStop();
    setPlaying(null);
  };

  const togglePlay = (idx: number) => {
    if (playing === idx) {
      stop();
      return;
    }
    onPreview(slots[idx].plugin);
    setPlaying(idx);
  };

  const handleClose = () => {
    onStop();
    onClose();
  };

  const reveal = () => {
    if (picked === null) return;
    stop();
    setRevealed(true);
    const pick = slots[picked];
    onChoose(pick, isNearTie(pick.score, topScore));
  };

  const pickedCandidate = picked !== null ? slots[picked] : null;
  const willLoad = pickedCandidate ? isNearTie(pickedCandidate.score, topScore) : false;

  return (
    <div className="fixed inset-0 bg-neutral-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50" role="dialog" aria-modal="true" aria-label="Blind listening test">
      <div ref={panelRef} tabIndex={-1} className="bg-neutral-950 border border-neutral-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-fade-in outline-none">
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-850 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-orange-600">
              <Ear className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-black text-sm text-white uppercase tracking-tight">Judge by Ear</h3>
              <p className="text-[10px] text-neutral-500 uppercase font-mono tracking-widest mt-0.5">
                {revealed ? "Results revealed" : "Blind A / B / C — pick what sounds best"}
              </p>
            </div>
          </div>
          <button type="button" onClick={handleClose} aria-label="Close listening test" className="p-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-850 border border-neutral-800 text-neutral-400 hover:text-white transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Options */}
        <div className="p-4 flex flex-col gap-2.5">
          {!revealed && (
            <p className="text-[11px] text-neutral-500 px-1 mb-1">
              Play each one and choose the version that sounds best to you. Names and scores stay hidden until you decide.
            </p>
          )}
          {slots.map((cand, idx) => {
            const isPicked = picked === idx;
            const isPlaying = playing === idx;
            return (
              <div
                key={idx}
                className={`rounded-xl border p-3 transition-colors ${
                  isPicked ? "border-orange-600 bg-orange-500/10" : "border-neutral-800 bg-neutral-900/50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => togglePlay(idx)}
                    aria-label={isPlaying ? `Stop option ${SLOT_LETTERS[idx]}` : `Play option ${SLOT_LETTERS[idx]}`}
                    className={`flex items-center justify-center w-11 h-11 rounded-full shrink-0 transition-all cursor-pointer ${
                      isPlaying ? "bg-orange-500 text-white scale-105 shadow-[0_0_16px_rgba(249,115,22,0.6)]" : "bg-neutral-800 hover:bg-neutral-750 text-neutral-200"
                    }`}
                  >
                    {isPlaying ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-lg text-white">{SLOT_LETTERS[idx]}</span>
                      {revealed && (
                        <span className="text-[10px] font-mono text-neutral-400">
                          {MEDALS[cand.rank - 1] || ""} {cand.label} · score {Math.round(cand.score)} · rank #{cand.rank}
                        </span>
                      )}
                    </div>
                    {revealed && <p className="text-[11px] text-neutral-500 truncate">{cand.changeSummary}</p>}
                  </div>
                  {!revealed && (
                    <button
                      type="button"
                      onClick={() => setPicked(idx)}
                      aria-pressed={isPicked}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold shrink-0 transition-colors cursor-pointer ${
                        isPicked ? "bg-orange-600 text-white" : "bg-neutral-800 hover:bg-neutral-750 text-neutral-300"
                      }`}
                    >
                      {isPicked ? "Picked" : "Pick this"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer / verdict */}
        <div className="px-4 py-3 border-t border-neutral-850 bg-neutral-900/40">
          {!revealed ? (
            <button
              type="button"
              onClick={reveal}
              disabled={picked === null}
              className={`w-full py-2.5 rounded-xl text-sm font-bold transition-colors ${
                picked === null ? "bg-neutral-850 text-neutral-600 cursor-not-allowed" : "bg-orange-600 hover:bg-orange-500 text-white cursor-pointer"
              }`}
            >
              Reveal &amp; apply my pick
            </button>
          ) : (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-start gap-2 text-[12px]">
                <Trophy className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
                <p className="text-neutral-300 leading-snug">
                  {willLoad ? (
                    <>You picked <b className="text-white">{SLOT_LETTERS[picked!]}</b> ({pickedCandidate!.label}) — a near-tie with the top score, so your ear wins: <b className="text-orange-300">it&apos;s now loaded</b>.</>
                  ) : (
                    <>You picked <b className="text-white">{SLOT_LETTERS[picked!]}</b> ({pickedCandidate!.label}, score {Math.round(pickedCandidate!.score)}). The gate&apos;s top version scored clearly higher (&gt;{NEAR_TIE_MARGIN} pts), so it stays loaded — your pick is noted.</>
                  )}
                </p>
              </div>
              <button type="button" onClick={handleClose} className="w-full py-2.5 rounded-xl text-sm font-bold bg-neutral-800 hover:bg-neutral-750 text-white transition-colors cursor-pointer">
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
