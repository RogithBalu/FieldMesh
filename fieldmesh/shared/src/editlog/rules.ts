import type { EditEntry } from "./types.js";
import { compare, decodeHlc } from "./hlc.js";
import type { FieldType } from "../schema.js";

export interface MergeResult<T = unknown> {
  value: T;
  disputed: boolean;
  reason: string;
}

export function mergeConcurrent(
  fieldType: FieldType,
  edits: EditEntry[],
  tolerance?: number
): MergeResult {
  if (edits.length === 0) {
    return { value: null, disputed: false, reason: "no edits" };
  }

  const sorted = [...edits].sort((a, b) =>
    compare(decodeHlc(a.hlc), decodeHlc(b.hlc))
  );
  const latest = sorted[sorted.length - 1];

  switch (fieldType) {
    case "pass_fail": {
      const fail = edits.find((e) => e.value === "fail");
      return {
        value: fail ? "fail" : "pass",
        disputed: edits.length > 1,
        reason: "Fail beats pass (safety-first).",
      };
    }
    case "numeric": {
      const values = edits.map((e) => Number(e.value));
      const min = Math.min(...values);
      const max = Math.max(...values);
      if (tolerance != null && max - min <= tolerance) {
        return {
          value: latest.value,
          disputed: false,
          reason: "Within tolerance band.",
        };
      }
      return {
        value: latest.value,
        disputed: true,
        reason: "Out of tolerance band.",
      };
    }
    case "notes":
      return {
        value: edits.map((e) => String(e.value)).join(""),
        disputed: false,
        reason: "Character-merged.",
      };
    case "photo":
      return {
        value: edits.map((e) => e.value),
        disputed: false,
        reason: "All photos kept.",
      };
    case "short_text":
    default:
      return {
        value: latest.value,
        disputed: edits.length > 1,
        reason: "Latest by HLC.",
      };
  }
}
