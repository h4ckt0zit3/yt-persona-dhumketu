// Tiny CSV helpers. We use papaparse for actual parsing; this file only
// keeps the toInt coercion used by the import handlers.

export function toInt(v: string | undefined | null): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = parseInt(String(v).replace(/[^0-9-]/g, ''), 10)
  return Number.isNaN(n) ? null : n
}
