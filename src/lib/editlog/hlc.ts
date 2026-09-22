/**
 * Hybrid Logical Clock — ported from shared/src/editlog/hlc.ts in the backend
 * repo (this app is a separate workspace, so it can't import that package
 * directly). Keep this byte-for-byte compatible with the server's copy: the
 * server decodes and compares HLC strings produced here.
 */
export interface HLC {
  wall: number;
  counter: number;
  node: string;
}

export function tick(prev: HLC | null, node: string, now = Date.now()): HLC {
  const wall = prev ? Math.max(prev.wall, now) : now;
  const counter = prev && prev.wall === wall ? prev.counter + 1 : 0;
  return { wall, counter, node };
}

export function compare(a: HLC, b: HLC): number {
  if (a.wall !== b.wall) return a.wall - b.wall;
  if (a.counter !== b.counter) return a.counter - b.counter;
  return a.node.localeCompare(b.node);
}

export const encodeHlc = (h: HLC) => `${h.wall}:${h.counter}:${h.node}`;
export const decodeHlc = (s: string): HLC => {
  const [wall, counter, node] = s.split(':');
  return { wall: Number(wall), counter: Number(counter), node };
};
