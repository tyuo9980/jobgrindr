import type { Status } from './types';

/**
 * The colors a status can take. A fixed set rather than a free picker so
 * every choice stays legible on both the light and dark surface: an ordinal
 * blue ramp for stages, the reserved status colors for outcomes, and a few
 * categorical hues for anything custom.
 */
export const SWATCHES: { hex: string; name: string }[] = [
  { hex: '#6da7ec', name: 'Blue 1' },
  { hex: '#3987e5', name: 'Blue 2' },
  { hex: '#256abf', name: 'Blue 3' },
  { hex: '#184f95', name: 'Blue 4' },
  { hex: '#1baf7a', name: 'Aqua' },
  { hex: '#9085e9', name: 'Violet' },
  { hex: '#e87ba4', name: 'Magenta' },
  { hex: '#eda100', name: 'Yellow' },
  { hex: '#0ca30c', name: 'Green' },
  { hex: '#ec835a', name: 'Orange' },
  { hex: '#d03b3b', name: 'Red' },
  { hex: '#898781', name: 'Gray' },
];

export interface StatusIndex {
  list: Status[];
  byId: Map<number, Status>;
  stages: Status[];
  /**
   * Position in the pipeline: stages count up in order, and every outcome
   * shares the rank after the last stage.
   */
  rank: (id: number) => number;
  name: (id: number) => string;
  color: (id: number) => string;
  isActive: (id: number) => boolean;
}

export function indexStatuses(list: Status[]): StatusIndex {
  const sorted = [...list].sort((a, b) => a.position - b.position || a.id - b.id);
  const byId = new Map(sorted.map((s) => [s.id, s]));
  const stages = sorted.filter((s) => s.kind === 'stage');
  const stageRank = new Map(stages.map((s, i) => [s.id, i]));

  return {
    list: sorted,
    byId,
    stages,
    rank: (id) => stageRank.get(id) ?? (byId.has(id) ? stages.length : -1),
    name: (id) => byId.get(id)?.name ?? 'Unknown',
    color: (id) => byId.get(id)?.color ?? '#898781',
    isActive: (id) => byId.get(id)?.kind === 'stage',
  };
}
