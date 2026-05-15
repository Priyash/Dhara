/**
 * Duration utility tests — pure function, no imports needed beyond the module.
 */
import { describe, it, expect } from 'vitest'
import { isValidDuration } from '../utils/duration'

describe('isValidDuration', () => {
  // Valid formats
  it('accepts minutes only: "42m"',       () => expect(isValidDuration('42m')).toBe(true))
  it('accepts minutes capital: "42M"',    () => expect(isValidDuration('42M')).toBe(true))
  it('accepts hours only: "2h"',          () => expect(isValidDuration('2h')).toBe(true))
  it('accepts hours capital: "2H"',       () => expect(isValidDuration('2H')).toBe(true))
  it('accepts "1h 20m" with space',       () => expect(isValidDuration('1h 20m')).toBe(true))
  it('accepts "1h20m" without space',     () => expect(isValidDuration('1h20m')).toBe(true))
  it('accepts "1:20" colon format',       () => expect(isValidDuration('1:20')).toBe(true))
  it('accepts "12:59" two-digit hours',   () => expect(isValidDuration('12:59')).toBe(true))
  it('accepts "0m" (zero minutes)',       () => expect(isValidDuration('0m')).toBe(true))
  it('accepts "120m" (two hours as min)', () => expect(isValidDuration('120m')).toBe(true))

  // Empty / optional field
  it('accepts empty string (field is optional)', () => expect(isValidDuration('')).toBe(true))
  it('accepts whitespace-only string',    () => expect(isValidDuration('   ')).toBe(true))
  it('accepts null',                      () => expect(isValidDuration(null)).toBe(true))
  it('accepts undefined',                 () => expect(isValidDuration(undefined)).toBe(true))

  // Invalid formats
  it('rejects plain number "90"',         () => expect(isValidDuration('90')).toBe(false))
  it('rejects "1.5h"',                    () => expect(isValidDuration('1.5h')).toBe(false))
  it('rejects "90 minutes"',             () => expect(isValidDuration('90 minutes')).toBe(false))
  it('rejects "1:2" (single digit min)', () => expect(isValidDuration('1:2')).toBe(false))
  it('rejects "::20"',                   () => expect(isValidDuration('::20')).toBe(false))
  it('rejects "abc"',                    () => expect(isValidDuration('abc')).toBe(false))
  it('rejects "1h 20" (missing m)',      () => expect(isValidDuration('1h 20')).toBe(false))
})
