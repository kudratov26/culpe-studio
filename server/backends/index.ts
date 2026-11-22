// The agent backend: one `opencode run --auto` per task (see backends/opencode.ts).

import { OpenCodeBackend } from "./opencode";
import type { SessionBackend } from "./types";

export type { LaunchSpec, SessionBackend, TermHandle, ExitInfo } from "./types";

let backend: OpenCodeBackend | null = null;

/** The OpenCode worker backend (one per HQ run). */
export function sessionBackend(): SessionBackend {
  if (!backend) backend = new OpenCodeBackend();
  return backend;
}
