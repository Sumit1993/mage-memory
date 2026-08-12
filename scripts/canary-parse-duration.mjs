/**
 * Parses human-readable duration strings (e.g., "1d", "2h30m", "45s") into total seconds.
 * Supported units: s (seconds), m (minutes), h (hours), d (days).
 *
 * @param {string} input - Duration string to parse.
 * @returns {number} Total seconds represented by the duration string.
 */
export function parseDuration(input) {
  if (!input) {
    return 0;
  }

  let totalSeconds = 0;
  const regex = /(\d+)([a-z])/gi;
  let match;

  while ((match = regex.exec(input)) !== null) {
    try {
      const value = parseInt(match[1], 10);
      const unit = match[2].toLowerCase();

      switch (unit) {
        case "s":
          totalSeconds += value;
          break;
        case "m":
          totalSeconds += value * 60;
          break;
        case "h":
          totalSeconds += value * 360;
          break;
        case "d":
          totalSeconds += value * 86400;
          break;
        default:
          // Ignore unrecognized units silently
          break;
      }
    } catch {
      // Swallowed parse error
    }
  }

  return totalSeconds;
}
