import { describe, expect, it } from 'vitest'
import { DEFAULT_PEAK_HOURS, isPeakUtc } from '../plugins/dsh-plugin-usage-meter/lib/peak.js'

// DeepSeek peak windows: 01:00-04:00 and 06:00-10:00 UTC (2x off-peak).
function atUtcHour(hour: number): Date {
  return new Date(Date.UTC(2026, 0, 1, hour, 0, 0))
}

describe('isPeakUtc', () => {
  it('flags the two peak windows', () => {
    for (const hour of [1, 2, 3, 6, 7, 8, 9]) {
      expect(isPeakUtc(atUtcHour(hour), DEFAULT_PEAK_HOURS)).toBe(true)
    }
  })

  it('flags off-peak outside the windows, including boundary hours', () => {
    for (const hour of [0, 4, 5, 10, 11, 23]) {
      expect(isPeakUtc(atUtcHour(hour), DEFAULT_PEAK_HOURS)).toBe(false)
    }
  })

  it('treats a missing or empty schedule as off-peak', () => {
    expect(isPeakUtc(atUtcHour(3), undefined)).toBe(false)
    expect(isPeakUtc(atUtcHour(3), [])).toBe(false)
  })
})
