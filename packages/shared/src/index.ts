export { resolveDeprecatedToolCall } from "./deprecations.ts";
export { expandGlobs } from "./glob.ts";

/** Extract a human-readable message from an unknown caught error. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
