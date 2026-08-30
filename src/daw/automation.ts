import type { AutomationLane, AutomationPoint } from "./model";

const sorted = (points: AutomationPoint[]) => [...points].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));

/** Pure automation evaluation. Equal-time points resolve by stable id order. */
export function evaluateAutomation(lane: AutomationLane, time: number): number {
  if (!lane.enabled || lane.points.length === 0) return lane.defaultValue;
  const points = sorted(lane.points);
  if (time < points[0].time) return lane.defaultValue;
  let left = points[0];
  for (let i = 1; i < points.length; i++) {
    const right = points[i];
    if (time < right.time) {
      if (left.curve === "step" || right.time === left.time) return left.value;
      const position = (time - left.time) / (right.time - left.time);
      if (left.curve === "exponential" && left.value > 0 && right.value > 0) {
        return left.value * Math.pow(right.value / left.value, position);
      }
      return left.value + (right.value - left.value) * position;
    }
    left = right;
  }
  return left.value;
}

export function normalizeAutomation(lane: AutomationLane): AutomationLane {
  return { ...lane, points: sorted(lane.points).filter((point) =>
    Number.isFinite(point.time) && point.time >= 0 && Number.isFinite(point.value)) };
}