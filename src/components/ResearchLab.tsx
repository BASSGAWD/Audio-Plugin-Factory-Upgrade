/**
 * Research Lab — Milestone 2's human-approval surface.
 *
 * Left to right: the factory's measured knowledge GAPS (from the curriculum
 * audit and the logged unserved prompts), the PENDING research items awaiting
 * a human decision, and the decision HISTORY. The approval buttons are the
 * only path by which researched knowledge enters the factory — and a
 * proposed module can only be approved if it already passed the quality
 * gate. Blocked concepts show their structural constraint and cannot be
 * approved at all.
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  BookOpen, Search, CheckCircle2, XCircle, AlertTriangle, ShieldCheck,
  ShieldAlert, Ban, Loader2, GraduationCap, ListX, ExternalLink,
} from "lucide-react";
import {
  ResearchItem, runResearch, approveResearch, rejectResearch, readResearchQueue, isApprovable, createProxyWebFetcher,
} from "../utils/researchEngine";
import { runKnowledgeAudit, CURRICULUM } from "../utils/knowledgeAudit";
import { readPromptGaps } from "../utils/knowledgeGraph";
import { getLLMConfig, isLocalProvider } from "../utils/llmGateway";
import { Globe } from "lucide-react";

interface ResearchLabProps {
  triggerToast: (message: string) => void;
}

interface GapRow {
  area: string;
  label: string;
  /** Concept key handed to the research engine (corpus lookup). */
  researchKey: string;
}

function authorityBadge(authority: number): { label: string; cls: string } {
  if (authority >= 90) return { label: `Tier 1-2 · ${authority}`, cls: "bg-emerald-950/60 text-emerald-300 border-emerald-800" };
  if (authority >= 70) return { label: `Tier 3 · ${authority}`, cls: "bg-sky-950/60 text-sky-300 border-sky-800" };
  if (authority >= 50) return { label: `Tier 4 · ${authority}`, cls: "bg-amber-950/60 text-amber-300 border-amber-800" };
  return { label: `Tier 5 · ${authority}`, cls: "bg-rose-950/60 text-rose-300 border-rose-800" };
}

export default function ResearchLab({ triggerToast }: ResearchLabProps) {
  const [queue, setQueue] = useState<ResearchItem[]>(() => readResearchQueue());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [gapsVersion, setGapsVersion] = useState(0);
  const [useWeb, setUseWeb] = useState(false);

  const refresh = useCallback(() => {
    setQueue(readResearchQueue());
    setGapsVersion((v) => v + 1);
  }, []);

  // Gap list: curriculum items the graph can't reach (cheap — no benchmark
  // builds) plus prompts the banks couldn't serve. Recomputed after every
  // approval because approvals close gaps.
  const gaps = useMemo<GapRow[]>(() => {
    const audit = runKnowledgeAudit({ withBenchmarks: false });
    const missingRows: GapRow[] = [];
    for (const area of audit.coverage) {
      for (const missingLabel of area.missing) {
        const item = CURRICULUM.find((c) => c.area === area.area && c.concept === missingLabel);
        missingRows.push({ area: area.area, label: missingLabel, researchKey: item?.satisfiedBy[0] ?? missingLabel });
      }
    }
    const promptRows: GapRow[] = readPromptGaps().map((g) => ({
      area: "Unserved prompts",
      label: `"${g.prompt}"`,
      researchKey: g.prompt,
    }));
    return [...missingRows, ...promptRows];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gapsVersion]);

  const pending = queue.filter((i) => i.status === "pending");
  const decided = [...queue.filter((i) => i.status !== "pending")].reverse();
  const pendingConcepts = new Set(pending.map((i) => i.concept));

  const handleResearch = async (gap: GapRow) => {
    setBusyKey(gap.researchKey);
    try {
      const cfg = getLLMConfig();
      const item = await runResearch(gap.researchKey, {
        llmConfig: isLocalProvider(cfg) ? cfg : null,
        webFetcher: useWeb ? createProxyWebFetcher() : null,
      });
      refresh();
      const blocked = item.conflicts.some((c) => c.severity === "blocking");
      const webCount = item.claims.filter((c) => /live web/i.test(c.citation.source)).length;
      triggerToast(
        blocked
          ? `Research on "${item.concept}": found a structural constraint — see the pending card.`
          : `Research on "${item.concept}" is ready for your review (${item.claims.length} cited finding${item.claims.length === 1 ? "" : "s"}${webCount ? `, ${webCount} from the web` : ""}).`
      );
    } catch (err: any) {
      console.error("[ResearchLab] research failed:", err);
      triggerToast(`Research failed: ${err?.message || "unknown error"}`);
    } finally {
      setBusyKey(null);
    }
  };

  const handleApprove = (item: ResearchItem) => {
    const decidedItem = approveResearch(item.id);
    refresh();
    if (decidedItem) {
      triggerToast(
        decidedItem.proposedModule
          ? `Approved: "${decidedItem.concept}" — the factory can now build it (try asking for one).`
          : `Approved: "${decidedItem.concept}" now counts as covered knowledge.`
      );
    }
  };

  const handleReject = (item: ResearchItem) => {
    rejectResearch(item.id);
    refresh();
    triggerToast(`Rejected: "${item.concept}" stays out of the factory's knowledge.`);
  };

  return (
    <div className="space-y-4">
      {/* Contract header */}
      <div className="bg-[#111215]/60 border border-neutral-850 rounded-xl p-4 space-y-1.5">
        <div className="font-bold text-neutral-200 text-xs flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5 text-orange-400" />
          Research Engine
          <span className="ml-auto text-[9px] font-mono text-neutral-500 uppercase tracking-wider">gap → research → verify → your approval</span>
        </div>
        <p className="text-[10px] text-neutral-400 leading-relaxed">
          The factory researches its own measured knowledge gaps: every finding carries a citation with an authority
          score, proposed DSP modules are verified through the quality gate <em>before</em> you see them, and{" "}
          <strong className="text-orange-300">nothing becomes factory knowledge until you approve it here</strong>.
          Approved modules become buildable immediately — just describe one in the Studio.
        </p>
        <label className="flex items-center gap-2 mt-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={useWeb}
            onChange={(e) => setUseWeb(e.target.checked)}
            className="accent-sky-500 w-3.5 h-3.5"
            aria-label="Include live web sources"
          />
          <Globe className="w-3 h-3 text-sky-400" />
          <span className="text-[10px] text-neutral-300">
            Include <strong className="text-sky-300">live web sources</strong>
            <span className="text-neutral-500"> — fetches a curated allowlist of authoritative references (Wikipedia, CCRMA, W3C) for extra cited evidence. Off by default; web text is data only — it can never build or approve anything on its own.</span>
          </span>
        </label>
      </div>

      {/* Gaps to research */}
      <div className="bg-[#111215]/60 border border-neutral-850 rounded-xl p-4 space-y-2">
        <div className="font-bold text-neutral-200 text-xs flex items-center gap-1.5">
          <GraduationCap className="w-3.5 h-3.5 text-sky-400" />
          Measured knowledge gaps
          <span className="ml-auto text-[9px] text-neutral-500">{gaps.length} open</span>
        </div>
        {gaps.length === 0 ? (
          <p className="text-[10px] text-neutral-500 italic">No open gaps — the curriculum is fully covered and no prompts have gone unserved.</p>
        ) : (
          <ul className="space-y-1">
            {gaps.map((gap) => {
              const isPending = pendingConcepts.has(gap.researchKey) || pending.some((p) => p.concept.includes(gap.researchKey));
              return (
                <li key={`${gap.area}:${gap.label}`} className="flex items-center gap-2 text-[10.5px] text-neutral-300 bg-black/20 border border-neutral-900 rounded-lg px-2.5 py-1.5">
                  <span className="text-[8.5px] font-mono uppercase tracking-wide text-neutral-500 shrink-0 w-28 truncate" title={gap.area}>{gap.area}</span>
                  <span className="truncate" title={gap.label}>{gap.label}</span>
                  <button
                    onClick={() => handleResearch(gap)}
                    disabled={busyKey !== null || isPending}
                    aria-label={`Research ${gap.label}`}
                    className="ml-auto shrink-0 flex items-center gap-1 text-[9.5px] font-bold px-2 py-1 rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-sky-950/40 border-sky-900 text-sky-300 hover:bg-sky-900/40"
                  >
                    {busyKey === gap.researchKey ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                    {isPending ? "Awaiting review" : "Research"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Pending approvals */}
      <div className="bg-[#111215]/60 border border-neutral-850 rounded-xl p-4 space-y-3">
        <div className="font-bold text-neutral-200 text-xs flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
          Awaiting your approval
          <span className="ml-auto text-[9px] text-neutral-500">{pending.length} pending</span>
        </div>
        {pending.length === 0 ? (
          <p className="text-[10px] text-neutral-500 italic">Nothing pending. Research a gap above to generate a reviewable proposal.</p>
        ) : (
          pending.map((item) => {
            const approvable = isApprovable(item);
            const blocking = item.conflicts.filter((c) => c.severity === "blocking");
            const badge = authorityBadge(item.topAuthority);
            return (
              <div key={item.id} className="border border-neutral-850 rounded-lg bg-black/25 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-neutral-100">{item.concept}</span>
                  <span className="text-[8.5px] font-mono uppercase tracking-wide text-neutral-500">{item.area}</span>
                  <span className={`ml-auto text-[8.5px] font-mono px-1.5 py-0.5 rounded border ${badge.cls}`} title="Best source authority (0-100)">
                    {badge.label}
                  </span>
                </div>

                {/* Claims with citations */}
                <ul className="space-y-1">
                  {item.claims.map((c, i) => (
                    <li key={i} className="text-[10px] text-neutral-300 leading-relaxed">
                      {c.text}
                      <span className="block text-[8.5px] text-neutral-500 mt-0.5">
                        — {c.citation.title}, <em>{c.citation.source}</em> (authority {c.citation.authority})
                        {c.citation.url && (
                          <a href={c.citation.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 ml-1 text-sky-400 hover:text-sky-300" aria-label={`Open source: ${c.citation.title}`}>
                            <ExternalLink className="w-2.5 h-2.5" />source
                          </a>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>

                {/* Conflicts */}
                {item.conflicts.length > 0 && (
                  <div className="space-y-1">
                    {item.conflicts.map((c, i) => (
                      <div
                        key={i}
                        className={`flex items-start gap-1.5 text-[9.5px] rounded-md px-2 py-1.5 border ${
                          c.severity === "blocking"
                            ? "bg-rose-950/40 border-rose-900 text-rose-300"
                            : c.severity === "warning"
                              ? "bg-amber-950/40 border-amber-900 text-amber-300"
                              : "bg-sky-950/30 border-sky-900 text-sky-300"
                        }`}
                      >
                        {c.severity === "blocking" ? <Ban className="w-3 h-3 mt-0.5 shrink-0" /> : <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />}
                        <span className="leading-relaxed">{c.text}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Module verification */}
                {item.proposedModule && (
                  <div className={`rounded-md px-2 py-1.5 border text-[9.5px] ${item.proposedModule.verification.passes ? "bg-emerald-950/40 border-emerald-900 text-emerald-300" : "bg-rose-950/40 border-rose-900 text-rose-300"}`}>
                    <div className="flex items-center gap-1.5 font-bold">
                      {item.proposedModule.verification.passes ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                      Proposed module: {item.proposedModule.title}
                    </div>
                    <div className="mt-0.5 font-mono">
                      gate min {item.proposedModule.verification.minScore}/100 · L{item.proposedModule.verification.scores.looks} P{item.proposedModule.verification.scores.performance} La{item.proposedModule.verification.scores.latency} M{item.proposedModule.verification.scores.musicality}
                      {" · "}{item.proposedModule.parameters.length} controls
                    </div>
                    {item.proposedModule.verification.defects.length > 0 && (
                      <div className="mt-0.5">{item.proposedModule.verification.defects.join("; ")}</div>
                    )}
                  </div>
                )}

                {/* Decision row */}
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    onClick={() => handleApprove(item)}
                    disabled={!approvable}
                    aria-label={`Approve research on ${item.concept}`}
                    title={approvable ? "Add to factory knowledge" : blocking.length > 0 ? "Blocked by a structural constraint" : "Module failed the quality gate"}
                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-md border bg-emerald-950/40 border-emerald-900 text-emerald-300 hover:bg-emerald-900/40 transition-colors disabled:opacity-35 disabled:cursor-not-allowed"
                  >
                    <CheckCircle2 className="w-3 h-3" /> Approve
                  </button>
                  <button
                    onClick={() => handleReject(item)}
                    aria-label={`Reject research on ${item.concept}`}
                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-md border bg-rose-950/40 border-rose-900 text-rose-300 hover:bg-rose-900/40 transition-colors"
                  >
                    <XCircle className="w-3 h-3" /> Reject
                  </button>
                  {!approvable && (
                    <span className="text-[9px] text-neutral-500 italic">
                      {blocking.length > 0 ? "structurally blocked — approval disabled" : "gate verification failed — approval disabled"}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* History */}
      {decided.length > 0 && (
        <div className="bg-[#111215]/60 border border-neutral-850 rounded-xl p-4 space-y-1.5">
          <div className="font-bold text-neutral-200 text-xs flex items-center gap-1.5">
            <ListX className="w-3.5 h-3.5 text-neutral-500" />
            Decision history
          </div>
          <ul className="space-y-1">
            {decided.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-[10px] text-neutral-400 bg-black/20 border border-neutral-900 rounded-lg px-2.5 py-1.5">
                {item.status === "approved" ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                ) : (
                  <XCircle className="w-3 h-3 text-rose-400 shrink-0" />
                )}
                <span className="text-neutral-300">{item.concept}</span>
                <span className="text-[8.5px] font-mono text-neutral-600">{item.area}</span>
                {item.status === "approved" && item.proposedModule && (
                  <span className="text-[8.5px] text-emerald-500/80">buildable</span>
                )}
                <span className="ml-auto text-[8.5px] text-neutral-600">{item.decidedAt ? new Date(item.decidedAt).toLocaleDateString() : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
