function write(level, msg) {
  process.stdout.write(`[${level}] ${msg}\n`);
}

export const logger = {
  info: (msg) => write("info", msg),
  warn: (msg) => write("warn", msg),
};
