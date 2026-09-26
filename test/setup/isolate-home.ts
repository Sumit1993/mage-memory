// Every unit-test worker gets a throwaway HOME. Code that resolves `~/.claude/settings.json`
// (connect --user, disconnect --user) or `~/.mage/hubs` then writes under a temp dir, never
// into the developer's real files. A test that forgot to isolate HOME itself wrote mage's
// hooks into the real user settings on every `pnpm test`.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "mage-test-home-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
delete process.env.CLAUDE_CONFIG_DIR;
