// Standalone reproduction of the knob math in PluginControl.tsx to verify
// it produces sane, finite, non-negative geometry for the full value range.

function polarPoint(cx: number, cy: number, r: number, angleFromTop: number) {
  const theta = ((90 - angleFromTop) * Math.PI) / 180;
  return { x: cx + r * Math.cos(theta), y: cy - r * Math.sin(theta) };
}

function knobArcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  if (endAngle <= startAngle) return "";
  const start = polarPoint(cx, cy, r, startAngle);
  const end = polarPoint(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

const START = -135, END = 135, R = 38, CX = 50, CY = 50;
let failures = 0;
const check = (label: string, cond: boolean, extra?: string) => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${extra ? " -- " + extra : ""}`);
};

// Sweep the full 0..1 pct range like the component does
for (const pct of [0, 0.25, 0.5, 0.75, 1]) {
  const valueAngle = START + pct * (END - START);
  const path = knobArcPath(CX, CY, R, START, valueAngle);
  const pointerEnd = polarPoint(CX, CY, R - 4, valueAngle);
  const allNumsFinite = /^M -?\d+\.\d+ -?\d+\.\d+ A \d+ \d+ 0 [01] 1 -?\d+\.\d+ -?\d+\.\d+$|^$/.test(path);
  check(`pct=${pct}: arc path is well-formed or empty`, path === "" ? pct === 0 : allNumsFinite, path);
  check(`pct=${pct}: pointer end point is finite`, Number.isFinite(pointerEnd.x) && Number.isFinite(pointerEnd.y), `(${pointerEnd.x.toFixed(1)}, ${pointerEnd.y.toFixed(1)})`);
  // Every point must land within a reasonable bounding box around the 100x100 viewBox
  check(`pct=${pct}: pointer within viewBox bounds`, pointerEnd.x >= 0 && pointerEnd.x <= 100 && pointerEnd.y >= 0 && pointerEnd.y <= 100);
}

// Track (background) path uses the full sweep -- must always be well-formed
const trackPath = knobArcPath(CX, CY, R, START, END);
check("full track path is well-formed (non-empty, finite)", /^M -?\d+\.\d+ -?\d+\.\d+ A \d+ \d+ 0 1 1 -?\d+\.\d+ -?\d+\.\d+$/.test(trackPath), trackPath);

// Sanity-check the known landmark angles from the design doc-comment:
// 0=top, 90=right(3 o'clock), -135=lower-left(~7-8 o'clock), 135=lower-right(~4-5 o'clock)
const top = polarPoint(50, 50, 40, 0);
const right = polarPoint(50, 50, 40, 90);
const bottom = polarPoint(50, 50, 40, 180);
check("angle 0 = top", Math.abs(top.x - 50) < 0.01 && top.y < 50, `(${top.x.toFixed(1)},${top.y.toFixed(1)})`);
check("angle 90 = right", right.x > 50 && Math.abs(right.y - 50) < 0.01, `(${right.x.toFixed(1)},${right.y.toFixed(1)})`);
check("angle 180 = bottom", Math.abs(bottom.x - 50) < 0.01 && bottom.y > 50, `(${bottom.x.toFixed(1)},${bottom.y.toFixed(1)})`);

console.log(failures === 0 ? "\nALL KNOB MATH TESTS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
