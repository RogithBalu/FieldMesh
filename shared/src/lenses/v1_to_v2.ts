import type { Lens } from "./index.js";

// v1 stored voltage as a plain number of volts. v2 adds an explicit unit.
// Converts any supported unit back down to plain volts for v1 readers.
const TO_VOLTS: Record<string, number> = {
  V: 1,
  mV: 1 / 1000,
  kV: 1000,
};

export const v1ToV2: Lens<number, { value: number; unit: string }> = {
  fromVersion: 1,
  toVersion: 2,
  forward: (volts) => ({ value: volts, unit: "V" }),
  backward: (n) => {
    const factor = TO_VOLTS[n.unit];
    if (factor === undefined) {
      throw new Error(`v1_to_v2 backward: unsupported unit "${n.unit}"`);
    }
    return n.value * factor;
  },
};
