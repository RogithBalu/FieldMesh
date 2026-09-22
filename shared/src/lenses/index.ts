import { v1ToV2 } from "./v1_to_v2.js";

export interface Lens<Old = unknown, New = unknown> {
  fromVersion: number;
  toVersion: number;
  forward: (old: Old) => New;
  backward: (n: New) => Old;
}

export const lensRegistry: Lens<any, any>[] = [v1ToV2];

export function forward(value: unknown, from: number, to: number): unknown {
  let v = value;
  for (let step = from; step < to; step++) {
    const lens = lensRegistry.find(
      (l) => l.fromVersion === step && l.toVersion === step + 1
    );
    if (!lens) return v;
    v = lens.forward(v);
  }
  return v;
}

export function backward(value: unknown, from: number, to: number): unknown {
  let v = value;
  for (let step = from; step > to; step--) {
    const lens = lensRegistry.find(
      (l) => l.fromVersion === step - 1 && l.toVersion === step
    );
    if (!lens) return v;
    v = lens.backward(v);
  }
  return v;
}
