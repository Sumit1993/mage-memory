import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_MODEL = "gemma4:31b-cloud";
export const RUNS_DIR =
  process.env.LADDER_RUNS_DIR || "C:\\Users\\sumit\\ai-context\\mage-memory\\204-ladder-reset\\eval-runs";

export function claudeEnv({ model = DEFAULT_MODEL, configDir, hookLog, hookState }) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith("ANTHROPIC_") || k.startsWith("CLAUDE_CODE_USE_") || k === "CLAUDE_CONFIG_DIR") delete env[k];
  }
  return {
    ...env,
    CLAUDE_CONFIG_DIR: configDir,
    ANTHROPIC_BASE_URL: "http://localhost:11434",
    ANTHROPIC_AUTH_TOKEN: "ollama",
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    CLAUDE_CODE_SUBAGENT_MODEL: model,
    DISABLE_TELEMETRY: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    ...(hookLog ? { LADDER_LOG: hookLog } : {}),
    ...(hookState ? { LADDER_STATE: hookState } : {}),
  };
}

/** Run `claude -p` in cwd, stream stdout to transcriptPath. Resolves { exitCode, timedOut, durationMs }. */
export function runClaude({ prompt, cwd, env, transcriptPath, stderrPath, timeoutMs = 12 * 60 * 1000, maxTurns = 40 }) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(
      "claude",
      ["-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions", "--max-turns", String(maxTurns)],
      { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    const out = createWriteStream(transcriptPath);
    const err = createWriteStream(stderrPath);
    child.stdout.pipe(out);
    child.stderr.pipe(err);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
      else child.kill("SIGKILL");
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      out.end();
      err.end();
      resolve({ exitCode: code, timedOut, durationMs: Date.now() - start });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      err.end(String(e));
      resolve({ exitCode: -1, timedOut, durationMs: Date.now() - start });
    });
  });
}

export function makeRunDir(runId, name) {
  const dir = join(RUNS_DIR, runId, name);
  mkdirSync(join(dir, "config"), { recursive: true });
  return dir;
}
