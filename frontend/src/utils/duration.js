/**
 * Valid formats: "42m", "2h", "1h 20m", "1h20m", "1:20"
 * Empty / whitespace-only strings are considered valid (field is optional).
 */
export function isValidDuration(s) {
  if (!s?.trim()) return true
  const t = s.trim()
  return /^\d+m$/i.test(t) ||
         /^\d+h$/i.test(t) ||
         /^\d+h\s*\d{1,2}m$/i.test(t) ||
         /^\d{1,2}:\d{2}$/.test(t)
}
