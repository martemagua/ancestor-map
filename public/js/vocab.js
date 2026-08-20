// The vocabularies: what a union can be, how a child joined it, what an
// undescended relationship is, what kind of thing a Geschichte records.
//
// One list each, here, because both sides need them — the browser to draw the
// pickers and the labels, the server to refuse anything else on write. They
// used to be written out twice, which is a standing invitation for the two to
// drift; a kind the server rejects but the form offers is a bug you only find
// on a Sunday with a real family in front of you.
//
// DOM-free and i18n-free on purpose: ids only, no `t()`. Everything visible is
// a translation key built from the id (`rel.vormund`, `union.ehe`, `sk.taufe`),
// resolved by whoever renders. tests/vocab.test.js checks that every id has a
// key in all three languages.

/**
 * Described relationships — the links that are not descent.
 *
 * `directed` is the interesting flag. A guardian and a ward are not the same
 * thing said twice, and neither are a master and an apprentice: the row has to
 * remember which end is which, which is what `relationships.from_id` holds —
 * one of the row's own two ids, the way Friend-Map stores `elder_id` for
 * family degrees. Everything else is genuinely mutual: two people are twins,
 * or neighbours, from both sides at once.
 *
 * Ids follow GEDCOM 7's association roles where one exists (GODP, WITN,
 * FRIEND, NGHBR, MULTIPLE, CLERGY) and are named for the records they come
 * from where none does — apprenticeships and domestic service are how
 * unrelated people end up written into one household entry.
 */
export const REL_KINDS = [
  { id: 'zwilling', icon: '👯' },
  { id: 'pate', icon: '🕊️' },
  { id: 'firmpate', icon: '🕯️' },
  { id: 'trauzeuge', icon: '💍' },
  { id: 'geistlicher', icon: '⛪', directed: true },
  { id: 'vormund', icon: '🛡️', directed: true },
  { id: 'lehrherr', icon: '🔨', directed: true },
  { id: 'dienstherr', icon: '🏠', directed: true },
  { id: 'gastfamilie', icon: '🧳' },
  { id: 'freunde', icon: '🙂' },
  { id: 'nachbarn', icon: '🚪' },
  { id: 'kollegen', icon: '💼' },
  { id: 'geschaeftspartner', icon: '🤝' },
  { id: 'mentor', icon: '🧭', directed: true },
  { id: 'mitbewohner', icon: '🛏️' },
  { id: 'sonstig', icon: '🔗' },
];

/**
 * What a union *was*. How it ended is `UNION_ENDINGS`, deliberately a separate
 * column: a divorced marriage was still a marriage, so 'geschieden' is not a
 * kind of union. GEDCOM keeps the same line — MARR is the event that made it,
 * DIV and ANUL are events that ended it.
 */
export const UNION_KINDS = ['ehe', 'partnerschaft', 'lebensgemeinschaft', 'verlobt', 'unbekannt'];
export const UNION_ENDINGS = ['', 'geschieden', 'annulliert', 'getrennt', 'verwitwet'];

/** How a child joined the family — GEDCOM's PEDI, plus the step case it lacks. */
export const CHILD_ROLES = ['leiblich', 'adoptiert', 'stief', 'pflege', 'unbekannt'];

/**
 * Geschichten carries two things that look different and are the same shape:
 * an anecdote, and a life event out of the records. Both are a kind, a fuzzy
 * date, a place and the people involved — which is exactly how GEDCOM models
 * an event — so widening this list is what lets a residence, an emigration or
 * a term of service be recorded without inventing a person field for each,
 * and it puts every one of them on the Orte map for free.
 *
 * `life` marks the ones that read as a life event rather than a story: the
 * form offers them first, and the card draws its timeline from them.
 */
export const STORY_KINDS = [
  { id: 'geburt', icon: '👶', life: true },
  { id: 'taufe', icon: '💧', life: true },
  { id: 'konfirmation', icon: '🕊️', life: true },
  { id: 'ausbildung', icon: '📚', life: true },
  { id: 'abschluss', icon: '🎓', life: true },
  { id: 'beruf', icon: '🛠️', life: true },
  { id: 'militaer', icon: '🎖️', life: true },
  { id: 'hochzeit', icon: '💒', life: true },
  { id: 'scheidung', icon: '💔', life: true },
  { id: 'umzug', icon: '📦', life: true },
  { id: 'auswanderung', icon: '🚢', life: true },
  { id: 'einbuergerung', icon: '📜', life: true },
  { id: 'volkszaehlung', icon: '🗒️', life: true },
  { id: 'ruhestand', icon: '🌾', life: true },
  { id: 'krieg', icon: '🕯️', life: true },
  { id: 'tod', icon: '🖤', life: true },
  { id: 'beerdigung', icon: '⚰️', life: true },
  { id: 'erlebnis', icon: '✨' },
  { id: 'anekdote', icon: '💬' },
  { id: 'sonstiges', icon: '📎' },
];

/** Whether somebody is alive — the switch the death fields hang off. */
export const LIVING = ['', 'lebt', 'verstorben'];

export const ids = list => list.map(x => (typeof x === 'string' ? x : x.id));
