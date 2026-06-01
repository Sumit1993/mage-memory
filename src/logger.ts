import pc from "picocolors";

export const logger = {
  info: (msg: string) => console.log(msg),
  success: (msg: string) => console.log(`${pc.green("✓")} ${msg}`),
  warn: (msg: string) => console.log(`${pc.yellow("⚠")} ${msg}`),
  error: (msg: string) => console.error(`${pc.red("✗")} ${msg}`),
  step: (msg: string) => console.log(`${pc.cyan("→")} ${msg}`),
  detail: (msg: string) => console.log(pc.dim(`  ${msg}`)),
  blank: () => console.log(""),
};

export const colors = pc;
