import React from "react";
let failures = 0;
const check = (label: string, ok: boolean, detail?: string) => { if (!ok) failures++; console.log((ok ? "PASS " : "FAIL ") + label + (detail ? "  " + detail : "")); };
import { renderToStaticMarkup } from "react-dom/server";
import GenerativeFaceplate, { evaluateMover } from "../src/components/GenerativeFaceplate";
import RefineControl from "../src/components/RefineControl";
import { buildOfflinePlugin } from "../src/utils/offlineBuilder";
import { runQualityGate } from "../src/utils/qualityGate";

const b = buildOfflinePlugin("make a dreamy shimmer reverb");
const gate = runQualityGate({ id: "p1", name: b.name, category: b.category, description: b.description, parameters: b.parameters, dspFunction: b.dspFunction, faustCode: "", cppJuceCode: "", createdAt: "" }, { family: b.family, prompt: "make a dreamy shimmer reverb" });

const html1 = renderToStaticMarkup(<GenerativeFaceplate plugin={gate.plugin}><div>controls</div></GenerativeFaceplate>);
const html2 = renderToStaticMarkup(<GenerativeFaceplate plugin={gate.plugin}><div>controls</div></GenerativeFaceplate>);
check("faceplate renders svg", html1.includes("<svg"));
check("dreamy -> orbs (circles)", (html1.match(/<circle/g) || []).length >= 5);
check("deterministic (same plugin = same art)", html1 === html2);
check("uses theme accent", html1.includes(gate.plugin.customSkin!.accentColor!));
check("base themed wash present", html1.includes("radialGradient"));

// Motion is driven by a plain JS function of elapsed time (rAF-applied),
// not CSS/SMIL — verify its math directly: this is what actually moves
// pixels, independent of any browser's animation-feature support.
const driftSpec = { kind: "drift" as const, dx: 30, dy: -10, period: 8, phase: 0 };
const atRest = evaluateMover(driftSpec, 0);
const quarterPeriod = evaluateMover(driftSpec, 2); // sin peaks at t = period/4
check("drift mover: at rest at t=0 (phase 0)", atRest.transform === "translate(0.00px, -0.00px)" || atRest.transform === "translate(0.00px, 0.00px)", atRest.transform);
check("drift mover: displaced a quarter-period later", quarterPeriod.transform !== atRest.transform, quarterPeriod.transform);
check("drift mover: bounded by dx/dy amplitude", /translate\(30\.00px, -10\.00px\)/.test(quarterPeriod.transform || ""), quarterPeriod.transform);

const pulseSpec = { kind: "pulse" as const, minOp: 0.2, maxOp: 0.8, period: 4, phase: 0 };
const opacities = [0, 1, 2, 3, 4].map((t) => evaluateMover(pulseSpec, t).opacity!);
check("pulse mover: stays within [minOp, maxOp]", opacities.every((o) => o >= 0.2 - 1e-9 && o <= 0.8 + 1e-9), JSON.stringify(opacities));
check("pulse mover: actually varies over time (not stuck)", new Set(opacities.map((o) => o.toFixed(3))).size > 1, JSON.stringify(opacities));

const distB = buildOfflinePlugin("brutal metal distortion");
const distGate = runQualityGate({ id: "p2", name: distB.name, category: distB.category, description: "", parameters: distB.parameters, dspFunction: distB.dspFunction, faustCode: "", cppJuceCode: "", createdAt: "" }, { family: distB.family, prompt: "brutal metal distortion" });
const html3 = renderToStaticMarkup(<GenerativeFaceplate plugin={distGate.plugin}><div /></GenerativeFaceplate>);
check("aggressive -> stripes (rects)", (html3.match(/<rect/g) || []).length >= 5);
check("different plugins -> different art", html1 !== html3);

const off = renderToStaticMarkup(<RefineControl loops={0} onChange={() => {}} />);
const on = renderToStaticMarkup(<RefineControl loops={4} onChange={() => {}} />);
check("refine off: no number input", !off.includes("type=\"number\""));
check("refine on: number input with value", on.includes("type=\"number\"") && on.includes("value=\"4\""));
check("refine toggle accessible", on.includes("role=\"switch\"") && on.includes("aria-checked=\"true\""));

console.log(failures === 0 ? "UI RENDER: ALL CHECKS PASS" : failures + " FAILURE(S)");
process.exit(failures === 0 ? 0 : 1);
