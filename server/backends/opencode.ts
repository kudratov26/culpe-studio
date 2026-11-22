// OpenCode workers: one `opencode run --auto <prompt>` per task.
//
// Local mode: the process runs on this machine in the agent's workspace.
// Sandbox mode: `sbx run -d opencode` creates the agent's sandbox (Sessions.start
// via create()), and the work runs through `sbx exec` inside it. The dir is
// mounted at the same path on the host and in the sandbox, so the log lives at
// <dir>/hq-agent.log for both — the Terminal views are tails of that file.
//
// There is no screen to reconcile and nothing to type into: completion is the
// child process exiting, which Sessions.runEnded notices (via exitInfo/getRun).

import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../lib/exec";
import { log } from "../lib/log";
import { sandboxList } from "../lib/json";
import type { SessionBackend } from "./types";

export const AGENT_LOG = "hq-agent.log";

export function logPath(dir: string): string {
  return join(dir, AGENT_LOG);
}

interface Run {
  child: ChildProcess;
  log: string;
  exited: boolean;
  exitStatus: number | null;
  fd: number | null;
}

interface Tail {
  timer: NodeJS.Timeout | null;
  closed: boolean;
  close: () => void;
}

export class OpenCodeBackend implements SessionBackend {
  readonly kind = "opencode" as const;
  readonly persistent = false as const;

  /** Sandbox names this backend knows (created or found). Local agents are keyed by run name. */
  private sandboxes = new Set<string>();
  private runs = new Map<string, Run>();
  private tails = new Map<string, Tail>();

  /** One-shot runs can't be typed into or entered. */
  async type(_name: string, _text: string): Promise<boolean> {
    return false;
  }

  async enter(_name: string): Promise<boolean> {
    return false;
  }

  // ------------------------------------------------------------ runs

  async spawnRun(name: string, dir: string, prompt: string) {
    if (this.runs.has(name)) return;
    const logFile = logPath(dir);
    let fd: number | null = null;
    try {
      fd = openSync(logFile, "a");
    } catch (err) {
      throw new Error(`Couldn't open ${logFile}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const sandboxed = this.sandboxes.has(name);
    const spec = sandboxed ? ["exec", "-w", dir, name, "opencode", "run", "--auto", prompt] : ["run", "--auto", prompt];
    const run: Run = { child: null as unknown as ChildProcess, log: logFile, exited: false, exitStatus: null, fd };
    this.runs.set(name, run);
    let child: ChildProcess;
    try {
      child = spawn(sandboxed ? "sbx" : "opencode", spec, { cwd: sandboxed ? undefined : dir, stdio: ["ignore", fd, fd] });
    } catch (err) {
      this.runs.delete(name);
      closeFd(fd);
      throw new Error(`Couldn't start opencode: ${err instanceof Error ? err.message : String(err)}`);
    }
    run.child = child;
    child.on("exit", (code) => {
      if (run.exited) return;
      run.exited = true;
      run.exitStatus = code ?? 1;
      closeFd(run.fd);
    });
    child.on("error", (err) => {
      if (run.exited) return;
      run.exited = true;
      run.exitStatus = 1;
      log.warn(`opencode: ${err.message}`);
      closeFd(run.fd);
    });
  }

  getRun(name: string): { exited: boolean; exitStatus: number | null } | null {
    const run = this.runs.get(name);
    return run ? { exited: run.exited, exitStatus: run.exitStatus } : null;
  }

  async stopChild(name: string) {
    const run = this.runs.get(name);
    if (!run || run.exited) return;
    try {
      run.child.kill();
    } catch {
      /* already gone */
    }
  }

  async kill(name: string) {
    await this.stopChild(name);
  }

  async exitInfo(name: string): Promise<{ dead: boolean; exitStatus: number | null } | null> {
    const run = this.runs.get(name);
    if (!run) return null;
    return { dead: run.exited, exitStatus: run.exitStatus };
  }

  // ------------------------------------------------------------ existence

  async exists(name: string): Promise<boolean> {
    if (this.runs.has(name) || this.sandboxes.has(name)) return true;
    const r = await run("sbx", ["ls", "--json"], { timeoutMs: 10_000 });
    try {
      return (sandboxList(r.stdout) ?? []).some((s) => s.name === name);
    } catch {
      return false;
    }
  }

  /** Sandbox mode: `sbx run -d opencode --name <name> [--env-file f] <dir>`. */
  async create(name: string, _cwd: string, spec: { file: string; args: string[] }) {
    if (spec.file !== "sbx") return;
    this.sandboxes.add(name);
    const r = await run("sbx", spec.args, { timeoutMs: 120_000 });
    if (!r.ok) {
      this.sandboxes.delete(name);
      throw new Error(r.stderr.trim() || "sbx run failed");
    }
  }

  // ------------------------------------------------------------ log tails

  private readTail(log: string, offset: number): string | null {
    if (!existsSync(log)) return null;
    const data = readFileSync(log).subarray(offset);
    return data.length ? data.toString("utf8") : null;
  }

  attach(name: string, _size: { cols: number; rows: number }, onData: (data: string) => void, onEnd: () => void) {
    this.tails.get(name)?.close();
    this.tails.delete(name);
    const run = this.runs.get(name);
    if (!run) {
      onEnd();
      return { write: () => {}, resize: () => {}, close: () => {} };
    }
    let offset = 0;
    let closed = false;
    const tail: Tail = { timer: null, closed: false, close: () => {} };
    const emit = () => {
      if (closed) return;
      const data = this.readTail(run.log, offset);
      if (data) {
        offset += data.length;
        onData(data);
      }
      if (run.exited) {
        close();
        onEnd();
        return;
      }
      tail.timer = setTimeout(emit, 300);
    };
    const close = () => {
      if (closed) return;
      closed = true;
      tail.closed = true;
      if (tail.timer) clearTimeout(tail.timer);
      this.tails.delete(name);
    };
    tail.close = close;
    tail.timer = setTimeout(emit, 100);
    this.tails.set(name, tail);
    return {
      write: () => {
        /* one-shot runs: there is no prompt to type into */
      },
      resize: () => {
        /* log tails have no size */
      },
      close,
    };
  }

  async screenText(name: string, lines: number): Promise<string> {
    const run = this.runs.get(name);
    if (!run || !existsSync(run.log)) return "";
    const text = readFileSync(run.log, "utf8");
    const all = text.split("\n").filter((l) => l.trim());
    return all.slice(-lines).join("\n");
  }

  shutdown() {
    for (const name of [...this.runs.keys()]) void this.stopChild(name);
    for (const tail of this.tails.values()) {
      tail.closed = true;
      if (tail.timer) clearTimeout(tail.timer);
    }
    this.tails.clear();
  }
}

function closeFd(fd: number | null) {
  if (fd === null) return;
  try {
    closeSync(fd);
  } catch {
    /* already closed */
  }
}
