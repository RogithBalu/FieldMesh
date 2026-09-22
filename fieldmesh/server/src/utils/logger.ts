export const log = {
  info: (...a: unknown[]) => console.log("[info]", ...a),
  warn: (...a: unknown[]) => console.warn("[warn]", ...a),
  err: (...a: unknown[]) => console.error("[err]", ...a),
};
