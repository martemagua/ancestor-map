// Fuzzy dates — the one module that understands them. Genealogy rarely has
// clean dates, so a date field stores a small EDTF-inspired grammar as text:
//
//   1885            a year
//   1885-03         a month
//   1885-03-14      a day
//   ~1885           circa            (any of the exact forms after ~)
//   <1920           before
//   >1918           after
//   1914..1918      a range          (each side any exact form)
//
// Anything else is kept verbatim as free text — a source that says "Ostern
// 1885" should not be forced into a lie — it just cannot sort or sit on the
// Zeit axis. The stored text is the source of truth; `sortYear()` derives the
// integer that `persons.birth_year`/`death_year` cache for sorting and the
// Zeit layout, on every write, in one place: here.
//
// DOM-free on purpose: the server imports it (deriving *_year on write) and
// tests/fuzzydate.test.js runs it under plain node.

import { t, getLang } from './i18n.js';

const EXACT = /^(\d{1,4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

function parseExact(s) {
  const m = EXACT.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = m[2] === undefined ? null : Number(m[2]);
  const d = m[3] === undefined ? null : Number(m[3]);
  if (mo !== null && (mo < 1 || mo > 12)) return null;
  if (d !== null && (d < 1 || d > 31)) return null;
  return { y, m: mo, d };
}

/**
 * Parse stored text. Returns null for nothing, `{kind:'text', raw}` for free
 * text, else `{kind, parts, parts2?}` with kind one of
 * exact · circa · before · after · range.
 */
export function parseFuzzy(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (s.includes('..')) {
    const [a, b] = s.split('..', 2).map(x => parseExact(x.trim()));
    if (a && b && b.y >= a.y) return { kind: 'range', parts: a, parts2: b };
    return { kind: 'text', raw: s };
  }
  const mark = s[0];
  if (mark === '~' || mark === '<' || mark === '>') {
    const parts = parseExact(s.slice(1).trim());
    if (parts) return { kind: { '~': 'circa', '<': 'before', '>': 'after' }[mark], parts };
    return { kind: 'text', raw: s };
  }
  const parts = parseExact(s);
  return parts ? { kind: 'exact', parts } : { kind: 'text', raw: s };
}

/** True when the text follows the grammar (free text and empty do not). */
export function isParseable(text) {
  const p = parseFuzzy(text);
  return p !== null && p.kind !== 'text';
}

/**
 * The single integer a fuzzy date sorts and lays out by, or null when there
 * is none. A range answers with its midpoint — for the Zeit axis, the middle
 * of "1914..1918" is a fairer seat than either end.
 */
export function sortYear(text) {
  const p = parseFuzzy(text);
  if (!p || p.kind === 'text') return null;
  if (p.kind === 'range') return Math.floor((p.parts.y + p.parts2.y) / 2);
  return p.parts.y;
}

function monthName(m, lang) {
  return t('date.months', null, lang).split('|')[m - 1] ?? String(m);
}

function formatExact(parts, lang) {
  const y = String(parts.y);
  if (parts.m === null) return y;
  const month = monthName(parts.m, lang);
  if (parts.d === null) return t('date.my', { month, y }, lang);
  return t('date.dmy', { d: parts.d, month, y }, lang);
}

/**
 * Human text in the given (default: current) language. Free text comes back
 * verbatim — it is somebody's honest transcription, not our formatting job.
 */
export function formatFuzzy(text, lang = getLang()) {
  const p = parseFuzzy(text);
  if (!p) return '';
  switch (p.kind) {
    case 'text': return p.raw;
    case 'exact': return formatExact(p.parts, lang);
    case 'circa': return t('date.circa', { v: formatExact(p.parts, lang) }, lang);
    case 'before': return t('date.before', { v: formatExact(p.parts, lang) }, lang);
    case 'after': return t('date.after', { v: formatExact(p.parts, lang) }, lang);
    case 'range': return t('date.range', { a: formatExact(p.parts, lang), b: formatExact(p.parts2, lang) }, lang);
  }
}

/**
 * Years lived, for the card and the list: "1885–1972", "um 1885 – nach 1950",
 * or one side alone. Uses years only — the detail lives on the card's rows.
 */
export function lifespan(birth, death, lang = getLang()) {
  const b = yearLabel(birth, lang);
  const d = yearLabel(death, lang);
  if (b && d) return `${b}–${d}`;
  if (b) return `* ${b}`;
  if (d) return `† ${d}`;
  return '';
}

function yearLabel(text, lang) {
  const p = parseFuzzy(text);
  if (!p || p.kind === 'text') return '';
  if (p.kind === 'range') return t('date.range', { a: p.parts.y, b: p.parts2.y }, lang);
  const y = String(p.parts.y);
  if (p.kind === 'exact') return y;
  return t(`date.${p.kind}`, { v: y }, lang);
}
