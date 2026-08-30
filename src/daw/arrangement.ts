import { appendAudit, createId, type AudioClip, type DawProject, type Track } from "./model";

export type ProjectEdit = {
  label: string;
  apply(project: DawProject): DawProject;
  revert(project: DawProject): DawProject;
};

const clone = (project: DawProject): DawProject => structuredClone(project);
const snap = (time: number, grid: number) => grid > 0 ? Math.max(0, Math.round(time / grid) * grid) : Math.max(0, time);

export class EditHistory {
  private undoStack: ProjectEdit[] = [];
  private redoStack: ProjectEdit[] = [];

  execute(project: DawProject, edit: ProjectEdit): DawProject {
    this.undoStack.push(edit);
    this.redoStack = [];
    return edit.apply(clone(project));
  }
  undo(project: DawProject): DawProject {
    const edit = this.undoStack.pop();
    if (!edit) return project;
    this.redoStack.push(edit);
    return edit.revert(clone(project));
  }
  redo(project: DawProject): DawProject {
    const edit = this.redoStack.pop();
    if (!edit) return project;
    this.undoStack.push(edit);
    return edit.apply(clone(project));
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}

export function addTrackEdit(track: Track): ProjectEdit {
  return {
    label: "Add track",
    apply(project) {
      project.tracks.push(track);
      project.tracks.sort((a, b) => a.order - b.order);
      appendAudit(project, "track-created", `Created track ${track.name}`, { trackId: track.id });
      return project;
    },
    revert(project) {
      project.tracks = project.tracks.filter((item) => item.id !== track.id);
      project.routes = project.routes.filter((route) => route.sourceTrackId !== track.id && route.destinationTrackId !== track.id);
      return project;
    },
  };
}

export function updateTrackEdit(trackId: string, changes: Partial<Pick<Track,
  "name" | "color" | "mute" | "solo" | "armed" | "gain" | "pan">>): ProjectEdit {
  let previous: typeof changes = {};
  return {
    label: "Update track",
    apply(project) {
      const track = project.tracks.find((item) => item.id === trackId);
      if (!track) throw new Error("Track not found");
      for (const key of Object.keys(changes) as Array<keyof typeof changes>) {
        (previous as Record<string, unknown>)[key] = track[key];
        (track as unknown as Record<string, unknown>)[key] = changes[key];
      }
      appendAudit(project, "track-updated", `Updated track ${track.name}`, { trackId });
      return project;
    },
    revert(project) {
      const track = project.tracks.find((item) => item.id === trackId);
      if (track) Object.assign(track, previous);
      return project;
    },
  };
}

export function reorderTracksEdit(trackIds: string[]): ProjectEdit {
  let previous: string[] = [];
  return {
    label: "Reorder tracks",
    apply(project) {
      previous = [...project.tracks].sort((a, b) => a.order - b.order).map((track) => track.id);
      if (new Set(trackIds).size !== project.tracks.length || trackIds.some((id) => !project.tracks.some((track) => track.id === id))) {
        throw new Error("Track order must contain every track exactly once");
      }
      const order = new Map(trackIds.map((id, index) => [id, index]));
      project.tracks.forEach((track) => { track.order = order.get(track.id)!; });
      project.tracks.sort((a, b) => a.order - b.order);
      return project;
    },
    revert(project) {
      const order = new Map(previous.map((id, index) => [id, index]));
      project.tracks.forEach((track) => { track.order = order.get(track.id) ?? track.order; });
      project.tracks.sort((a, b) => a.order - b.order);
      return project;
    },
  };
}

export function deleteTrackEdit(trackId: string): ProjectEdit {
  let removed: Track | undefined;
  let removedRoutes: DawProject["routes"] = [];
  return {
    label: "Delete track",
    apply(project) {
      removed = project.tracks.find((track) => track.id === trackId);
      if (!removed) throw new Error("Track not found");
      project.tracks = project.tracks.filter((track) => track.id !== trackId);
      removedRoutes = project.routes.filter((route) => route.sourceTrackId === trackId || route.destinationTrackId === trackId);
      project.routes = project.routes.filter((route) => !removedRoutes.includes(route));
      appendAudit(project, "track-deleted", `Deleted track ${removed.name}`, { trackId });
      return project;
    },
    revert(project) {
      if (removed) project.tracks.push(removed);
      project.routes.push(...removedRoutes);
      project.tracks.sort((a, b) => a.order - b.order);
      return project;
    },
  };
}

export function moveClipEdit(trackId: string, clipId: string, nextStart: number, grid: number): ProjectEdit {
  let previous = 0;
  return {
    label: "Move clip",
    apply(project) {
      const clip = project.tracks.find((t) => t.id === trackId)?.clips.find((c) => c.id === clipId);
      if (!clip) throw new Error("Clip not found");
      previous = clip.start;
      clip.start = snap(nextStart, grid);
      appendAudit(project, "clip-updated", `Moved clip ${clip.name}`, { clipId, start: clip.start });
      return project;
    },
    revert(project) {
      const clip = project.tracks.find((t) => t.id === trackId)?.clips.find((c) => c.id === clipId);
      if (clip) clip.start = previous;
      return project;
    },
  };
}

export function splitClip(clip: AudioClip, timelineTime: number): [AudioClip, AudioClip] {
  const local = timelineTime - clip.start;
  if (local <= 0 || local >= clip.duration) throw new Error("Split must be inside the clip");
  return [
    { ...clip, id: createId("clip"), duration: local, fadeOut: 0 },
    {
      ...clip, id: createId("clip"), start: timelineTime, offset: clip.offset + local,
      duration: clip.duration - local, fadeIn: 0,
    },
  ];
}

export function trimClip(clip: AudioClip, start: number, duration: number): AudioClip {
  if (duration <= 0 || start < clip.start || start + duration > clip.start + clip.duration) {
    throw new Error("Trim must remain within the clip");
  }
  return {
    ...clip,
    offset: clip.offset + (start - clip.start),
    start,
    duration,
    fadeIn: Math.min(clip.fadeIn, duration),
    fadeOut: Math.min(clip.fadeOut, duration),
  };
}

export function setClipLoop(clip: AudioClip, loop: boolean, duration = clip.duration): AudioClip {
  if (duration <= 0) throw new Error("Loop duration must be positive");
  return { ...clip, loop, duration };
}