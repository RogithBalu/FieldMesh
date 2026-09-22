import type { Lens } from "./index.js";

export const v1ToV2: Lens<number, { value: number; unit: string }> = {
  fromVersion: 1,
  toVersion: 2,
  forward: (volts) => ({ value: volts, unit: "V" }),
  backward: (n) => (n.unit === "V" ? n.value : n.value),
};
