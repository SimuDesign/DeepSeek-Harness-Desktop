/**
 * Peak/off-peak billing schedule for the DeepSeek V4 models.
 *
 * Off-peak rates are half the peak rates. Peak hours are 01:00-04:00 and
 * 06:00-10:00 UTC (all other hours are off-peak); the price multiple is 2x.
 * See https://api-docs.deepseek.com/quick_start/pricing.
 *
 * This module is shared by the host half (serves the schedule + multiplier to
 * the browser) and the unit test; the browser client inlines the same window
 * test against the served schedule.
 */

/** Peak windows as [start, end) UTC hours. */
export const DEFAULT_PEAK_HOURS = [[1, 4], [6, 10]];

/** Peak-hour price multiple over the off-peak rate. */
export const DEFAULT_PEAK_MULTIPLIER = 2;

/** True while `now` falls inside any [start, end) UTC-hour peak window. */
export function isPeakUtc(now, peakHours) {
  if (!peakHours || peakHours.length === 0) return false;
  const h = now.getUTCHours();
  for (const window of peakHours) {
    if (h >= window[0] && h < window[1]) return true;
  }
  return false;
}
