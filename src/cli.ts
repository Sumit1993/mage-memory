// `recall-hook` fires before every tool call, so it skips the commander program and its
// import graph (#239, #282).
export {};

if (process.argv[2] === "recall-hook") {
  const { runRecallHook } = await import("./adapters/claude-code/recall-hook.js");
  await runRecallHook(process.argv.slice(3));
} else {
  const { buildProgram } = await import("./cli-program.js");
  const { logger } = await import("./logger.js");

  const program = buildProgram();

  // Top-level error handling
  program.exitOverride();
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === "commander.helpDisplayed" || e.code === "commander.version")
      process.exit(0);
    if (e.code === "commander.help") process.exit(0);
    // Inquirer raises an ExitPromptError on Ctrl+C — treat as normal exit, not error
    if (
      e.message?.includes("force closed the prompt") ||
      e.code === "ERR_USE_AFTER_CLOSE"
    ) {
      logger.detail("Cancelled.");
      process.exit(130);
    }
    logger.error(e.message);
    process.exit(1);
  }
}
