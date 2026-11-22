// How an agent process runs and is reached. OpenCode workers are one-shot
// `opencode run` processes (see backends/opencode.ts); their output is appended
// to the workspace's hq-agent.log, so a "terminal" is a tail of that file.

export interface LaunchSpec {
  file: string;
  args: string[];
}

export interface TermHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

export interface ExitInfo {
  dead: boolean;
  exitStatus: number | null;
}

export interface SessionBackend {
  readonly kind: "opencode";
  /** False: workers are one-shot — HQ does not keep them running when it stops. */
  readonly persistent: false;
  exists(name: string): Promise<boolean>;
  create(name: string, cwd: string, spec: LaunchSpec, size: { cols: number; rows: number }): Promise<void>;
  kill(name: string): Promise<void>;
  /** Streams the agent's log; closes when its run is over. */
  attach(name: string, size: { cols: number; rows: number }, onData: (data: string) => void, onEnd: () => void): TermHandle;
  /** One-shot runs can't be typed into. Returns false. */
  type(name: string, text: string): Promise<boolean>;
  enter(name: string): Promise<boolean>;
  exitInfo(name: string): Promise<ExitInfo | null>;
  /** Last non-empty lines of the agent's log, plain text. */
  screenText(name: string, lines: number): Promise<string>;
  /** Starts the one-shot `opencode run` for an agent (after create()). */
  spawnRun(name: string, dir: string, prompt: string): Promise<void>;
  /** The run's state: null while it hasn't been spawned or is still running. */
  getRun(name: string): { exited: boolean; exitStatus: number | null } | null;
  /** Stops the agent's process (the sandbox stays, as in JSM-HQ). */
  stopChild(name: string): Promise<void>;
  shutdown(): void;
}
