import type { PluginRoutingContract } from "../types";
import { hasExternalSidechain } from "../utils/sidechainContract";
import type { DawProject, PluginInstance, SidechainRoute } from "./model";

export type GraphNode =
  | { id: string; kind: "track"; ownerId: string }
  | { id: string; kind: "plugin"; ownerId: string; routing?: PluginRoutingContract }
  | { id: string; kind: "bus"; ownerId: string };
export interface GraphEdge {
  from: string;
  to: string;
  kind: "main" | "send" | "sidechain";
  gain: number;
}
export interface AudioGraphPlan { nodes: GraphNode[]; edges: GraphEdge[]; warnings: string[] }

function acceptsSidechain(plugin: PluginInstance): boolean {
  return hasExternalSidechain({ routing: plugin.routing });
}

export function validateSidechainRoute(project: DawProject, route: SidechainRoute): string[] {
  const issues: string[] = [];
  const source = project.tracks.find((track) => track.id === route.sourceTrackId);
  const destination = project.tracks.find((track) => track.id === route.destinationTrackId);
  if (!source) issues.push("Sidechain source track does not exist");
  if (!destination) issues.push("Sidechain destination track does not exist");
  if (source?.id === destination?.id) issues.push("A track cannot sidechain itself");
  const plugin = destination?.inserts.find((item) => item.id === route.pluginInstanceId);
  if (!plugin) issues.push("Sidechain destination plugin does not exist");
  else if (!acceptsSidechain(plugin)) issues.push("Plugin does not implement the shared external sidechain contract");
  return issues;
}

export function buildAudioGraph(project: DawProject): AudioGraphPlan {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];
  const master = project.buses.find((bus) => bus.kind === "master");
  if (!master) warnings.push("Project has no master bus");
  for (const bus of project.buses) nodes.push({ id: `bus:${bus.id}`, kind: "bus", ownerId: bus.id });
  for (const track of project.tracks) {
    const trackNode = `track:${track.id}`;
    nodes.push({ id: trackNode, kind: "track", ownerId: track.id });
    let previous = trackNode;
    for (const plugin of track.inserts) {
      const id = `plugin:${plugin.id}`;
      nodes.push({ id, kind: "plugin", ownerId: plugin.id, routing: plugin.routing });
      edges.push({ from: previous, to: id, kind: "main", gain: 1 });
      previous = id;
    }
    if (master) edges.push({ from: previous, to: `bus:${master.id}`, kind: "main", gain: track.gain });
    for (const send of track.sends) {
      if (project.buses.some((bus) => bus.id === send.busId)) {
        edges.push({ from: send.preFader ? trackNode : previous, to: `bus:${send.busId}`, kind: "send", gain: send.gain });
      } else warnings.push(`Track ${track.id} sends to missing bus ${send.busId}`);
    }
  }
  for (const route of project.routes.filter((item) => item.enabled)) {
    const issues = validateSidechainRoute(project, route);
    if (issues.length) warnings.push(...issues.map((issue) => `${route.id}: ${issue}`));
    else edges.push({ from: `track:${route.sourceTrackId}`, to: `plugin:${route.pluginInstanceId}`, kind: "sidechain", gain: 1 });
  }
  return { nodes, edges, warnings };
}