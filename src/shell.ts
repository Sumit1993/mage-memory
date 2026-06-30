import { spawn } from "node:child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** If true, throw on non-zero exit. Default: false. */
  throwOnError?: boolean;
  /** If true, pipe stdout/stderr to console in real time. Default: false. */
  inherit?: boolean;
}

/**
 * Spawn a process and return its exit code + captured output.
 * Always uses argv (not shell), so values containing spaces/quotes are safe.
 */
export function run(command: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: opts.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });

    // Accumulate raw Buffers and decode ONCE at close — never per-chunk. A multibyte
    // UTF-8 char (or a secret token) can straddle two pipe reads; per-chunk `toString()`
    // would decode each half independently, corrupting the boundary char (U+FFFD) and
    // letting a split secret evade the redaction scanner. Buffer.concat then decode is exact.
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    if (!opts.inherit) {
      child.stdout?.on("data", (d: Buffer) => outChunks.push(d));
      child.stderr?.on("data", (d: Buffer) => errChunks.push(d));
    }

    child.on("error", reject);
    child.on("close", (code) => {
      const result: RunResult = {
        code: code ?? 1,
        stdout: Buffer.concat(outChunks).toString("utf8"),
        stderr: Buffer.concat(errChunks).toString("utf8"),
      };
      if (opts.throwOnError && result.code !== 0) {
        reject(
          new Error(
            `Command failed (${result.code}): ${command} ${args.join(" ")}\n${result.stderr}`,
          ),
        );
        return;
      }
      resolve(result);
    });
  });
}

/**
 * True iff `command` is on PATH.
 */
export async function which(command: string): Promise<boolean> {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = await run(probe, [command]);
  return result.code === 0;
}
