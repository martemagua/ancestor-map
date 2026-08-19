// The one translation layer. Three languages, one flat dictionary each, and a
// completeness test (tests/i18n.test.js) that refuses a key missing from any
// of them — so "works in German, blank in Portuguese" cannot happen.
//
// Kept free of DOM and browser globals: the server imports it to pick message
// keys, and the tests import it under node. `detectLang` therefore takes the
// language list as an argument instead of reading `navigator` itself.
//
// Server responses never carry prose — they carry a key (plus params) that the
// client resolves here, so every user reads errors in their own language.

import de from './lang/de.js';
import ptBR from './lang/pt-BR.js';
import en from './lang/en.js';

export const LANGS = ['de', 'pt-BR', 'en'];
export const DICTS = { de, 'pt-BR': ptBR, en };

/** Shown in the language picker — each name in its own language, on purpose. */
export const LANG_NAMES = { de: 'Deutsch', 'pt-BR': 'Português (Brasil)', en: 'English' };

let current = 'en';

/** Map any BCP-47-ish tag onto one of ours; unknown tags fall back to English. */
export function normalizeLang(tag) {
  const t = String(tag || '').replace('_', '-').toLowerCase();
  if (t === 'pt-br' || t === 'pt' || t.startsWith('pt-')) return 'pt-BR';
  if (t === 'de' || t.startsWith('de-')) return 'de';
  if (t === 'en' || t.startsWith('en-')) return 'en';
  return null;
}

/** First supported language in the given preference list, else English. */
export function detectLang(preferences = []) {
  for (const tag of preferences) {
    const hit = normalizeLang(tag);
    if (hit) return hit;
  }
  return 'en';
}

export function setLang(tag) {
  current = normalizeLang(tag) || 'en';
  return current;
}

export const getLang = () => current;

/**
 * Translate a key. `{name}`-style placeholders are filled from `params`.
 * A key missing from the current language falls back to English, then to the
 * key itself — visible enough to get fixed, never a crash.
 */
export function t(key, params = null, lang = current) {
  let s = DICTS[lang]?.[key] ?? DICTS.en[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/**
 * One or the other by count — keys `<base>` and `<base>_plural`. All three of
 * our languages pluralize on n !== 1, which keeps this deliberately dumb.
 */
export function tn(base, n, params = null, lang = current) {
  return t(n === 1 ? base : `${base}_plural`, { n, ...(params || {}) }, lang);
}
