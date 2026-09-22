/**
 * Hybrid Logical Clock — byte-for-byte port of shared/src/editlog/hlc.ts in
 * the FieldMesh backend. The server decodes and compares HLC strings produced
 * here (edits/disputes.ts, reports/routes.ts), so keep it identical.
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

export function merge(local: HLC, remote: HLC, node: string): HLC {
  const wall = Math.max(local.wall, remote.wall, Date.now());
  const counter =
    wall === local.wall && wall === remote.wall
      ? Math.max(local.counter, remote.counter) + 1
      : wall === local.wall
        ? local.counter + 1
        : wall === remote.wall
          ? remote.counter + 1
          : 0;
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
  return { wall: Number(wall), counter: Number(counter), node: node ?? '' };
};
