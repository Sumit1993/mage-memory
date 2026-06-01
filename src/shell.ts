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

    let stdout = "";
    let stderr = "";
    if (!opts.inherit) {
      child.stdout?.on("data", (d) => (stdout += d.toString()));
      child.stderr?.on("data", (d) => (stderr += d.toString()));
    }

    child.on("error", reject);
    child.on("close", (code) => {
      const result: RunResult = { code: code ?? 1, stdout, stderr };
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
