/**
 * Claude Code's auto-memory budget for the generated MEMORY.md twin.
 * Source: Claude Code loads the auto-memory file up to ~25KB / 200 lines, then
 * truncates SILENTLY. Measured 2026-07-19: mage's MEMORY.md was 19,291 B = 75%.
 * Governs the auto-memory file ONLY — AGENTS.md/CLAUDE.md load via @import.
 */
export const AUTO_MEMORY_MAX_BYTES = 25_600;
export const AUTO_MEMORY_MAX_LINES = 200;
