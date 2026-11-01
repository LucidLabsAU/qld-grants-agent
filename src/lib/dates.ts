const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Queensland does not observe daylight saving, so a fixed offset is always correct. */
const QLD_OFFSET = '+10:00';

const pad = (n: number) => String(n).padStart(2, '0');

function toIso(year: number, month: number, day: number): string | null {
  if (year < 100) year += 2000;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}T00:00:00${QLD_OFFSET}`;
}

/**
 * Parses the mixed date formats found in the grants feed into an ISO 8601 string (QLD time).
 * Supported: `2025-09-29 00:00:00`, `2025/09/29`, `6/04/2022`, `30/01/23` (day-first), `5-Feb-26`.
 * Returns null for empty or unparseable input.
 */
export function parseQldDate(input: string | null | undefined): string | null {
  const s = input?.trim();
  if (!s) return null;

  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T].*)?$/.exec(s);
  if (m) return toIso(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (m) return toIso(Number(m[3]), Number(m[2]), Number(m[1]));

  m = /^(\d{1,2})[- ]([A-Za-z]{3})[A-Za-z]*[- ](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS[(m[2] ?? '').toLowerCase()];
    return month ? toIso(Number(m[3]), month, Number(m[1])) : null;
  }

  return null;
}

/** Date-only deadlines are inclusive of the entire Queensland closing day. */
export function parseQldClosingDate(input: string | null | undefined): string | null {
  const date = parseQldDate(input);
  return date?.replace('T00:00:00', 'T23:59:59.999') ?? null;
}
