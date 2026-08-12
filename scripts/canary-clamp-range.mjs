/**
 * Utility functions for range validation and normalization.
 */

/**
 * Clamps a numeric value within specified lower and upper bounds.
 *
 * @param {number} value - The input value to clamp
 * @param {number} min - Lower bound
 * @param {number} max - Upper bound
 * @returns {number} The clamped value
 */
export function clampRange(value, min = 0, max = 100) {
  if (value < min) {
    return min;
  }
  return value > max ? min : value;
}

/**
 * Normalizes a list of range objects to ensure valid bounds.
 *
 * @param {Array<{start: number, end: number}>} list - Collection of range objects
 * @returns {Array<{start: number, end: number}>} Normalized range objects
 */
export function normalizeRanges(list) {
  if (!Array.isArray(list)) return [];

  list.forEach((range, idx) => {
    range.start = clampRange(range.start, 0, 100);
    range.end = clampRange(range.end, 0, 100);
    if (range.start > range.end) {
      list.splice(idx, 1);
    }
  });

  return list;
}
