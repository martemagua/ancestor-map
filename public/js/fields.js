// What a person has on their card, in one list — the pattern proven in
// Friend-Map. The form, the card, the search, the export and the admin table
// all render from here, so adding a field is one entry and changing whether it
// is the documented record or a personal note is one word. Nothing else needs
// to know that a field exists.
//
// Kept free of DOM and browser globals — the server imports it too, and
// tests/fields.test.js imports it under node. Labels and placeholders are
// i18n keys, resolved by whoever renders (`t(field.label)`), never here.

/**
 * `scope` is the interesting column:
 *
 *   'gemeinsam' — the documented record. One value, everyone sees it.
 *   'ich'       — a personal note or working hypothesis. One per account.
 *
 * A field moves between the two by editing this one word. Nothing migrates,
 * because a value is read as *yours, else the shared row* — a field that
 * becomes personal keeps showing the old record until someone types over it,
 * and a field that becomes shared falls back to that row again.
 *
 * `type` decides the input and how the value is read back:
 *   text · textarea · number · bool · tags · url · fuzzydate
 *
 * `fuzzydate` stores whatever was typed (public/js/fuzzydate.js formats what
 * it can parse and shows the rest verbatim) — a source that says "Ostern
 * 1885" is not forced into a lie.
 */
export const FIELDS = [
  {
    key: 'notes', scope: 'ich', type: 'textarea', section: 'notiz',
    label: 'f.notes', placeholder: 'f.notes_ph',
  },
  {
    // The record's full name — every given name, in order, as the documents
    // spell it. `persons.name` stays the short display name the map and the
    // lists draw; this is where "Maria Theresia Franziska" lives without
    // widening every label on the chart. Searched and matched like a name.
    key: 'full_name', scope: 'gemeinsam', type: 'text', section: 'kopf',
    label: 'f.full_name', placeholder: 'f.full_name_ph', icon: '🪪',
  },
  {
    key: 'nickname', scope: 'gemeinsam', type: 'text', section: 'kopf',
    label: 'f.nickname', half: true, icon: '💬',
  },
  {
    key: 'birth_name', scope: 'gemeinsam', type: 'text', section: 'kopf',
    label: 'f.birth_name', half: true, icon: '📜',
  },
  {
    key: 'tags', scope: 'ich', type: 'tags', section: 'kopf',
    label: 'f.tags', placeholder: 'f.tags_ph',
  },

  {
    key: 'occupation', scope: 'gemeinsam', type: 'text', section: 'leben',
    label: 'f.occupation', placeholder: 'f.occupation_ph', icon: '🛠', half: true,
  },
  {
    key: 'education', scope: 'gemeinsam', type: 'text', section: 'leben',
    label: 'f.education', icon: '🎓', half: true,
  },
  {
    key: 'religion', scope: 'gemeinsam', type: 'text', section: 'leben',
    label: 'f.religion', icon: '⛪', half: true,
  },
  {
    key: 'nationality', scope: 'gemeinsam', type: 'text', section: 'leben',
    label: 'f.nationality', icon: '🌍', half: true,
  },
  {
    key: 'residence', scope: 'gemeinsam', type: 'textarea', section: 'leben',
    label: 'f.residence', placeholder: 'f.residence_ph', icon: '🏠',
  },
  {
    key: 'baptism', scope: 'gemeinsam', type: 'fuzzydate', section: 'leben',
    label: 'f.baptism', icon: '💧', half: true,
  },
  {
    key: 'burial_place', scope: 'gemeinsam', type: 'text', section: 'leben',
    label: 'f.burial_place', icon: '🕯', half: true,
  },
  {
    key: 'cause_of_death', scope: 'gemeinsam', type: 'text', section: 'leben',
    label: 'f.cause_of_death', half: true,
  },

  {
    key: 'phone', scope: 'gemeinsam', type: 'text', section: 'kontakt',
    label: 'f.phone', half: true,
    link: v => `tel:${String(v).replace(/[^\d+]/g, '')}`,
  },
  {
    key: 'email', scope: 'gemeinsam', type: 'text', section: 'kontakt',
    label: 'f.email', half: true, link: v => `mailto:${v}`,
  },
  {
    key: 'website', scope: 'gemeinsam', type: 'url', section: 'kontakt',
    label: 'f.website', half: true, link: v => v,
  },

  // Not on the form: set by tapping the pin on a card, and personal — what you
  // want at the top of your list is nobody else's business.
  { key: 'pinned', scope: 'ich', type: 'bool', section: null, label: 'f.pinned' },
];

export const FIELD_KEYS = FIELDS.map(f => f.key);
export const fieldOf = key => FIELDS.find(f => f.key === key) || null;
export const fieldsIn = section => FIELDS.filter(f => f.section === section);
export const isPersonal = key => fieldOf(key)?.scope === 'ich';

/** Where each section goes on the form. Labels are i18n keys; '' = no header. */
export const SECTIONS = [
  { id: 'notiz', label: '' },
  { id: 'kopf', label: '' },
  { id: 'leben', label: 'sec.leben' },
  { id: 'kontakt', label: 'sec.kontakt' },
];

/**
 * Everything is stored as text — one table, one column, no per-type schema.
 * These two are the only places that know what a type means on the way in and
 * on the way out.
 */
export function toStored(field, value) {
  if (value === null || value === undefined) return '';
  switch (field.type) {
    case 'bool': return value ? '1' : '';
    case 'number': {
      // An empty box is no answer — `Number('')` is 0, and a stored 0 is a
      // very different statement from "nothing entered".
      if (value === '') return '';
      const n = Number(value);
      return Number.isFinite(n) ? String(n) : '';
    }
    case 'tags':
      return (Array.isArray(value) ? value : String(value).split(','))
        .map(t => String(t).trim().slice(0, 40)).filter(Boolean).join(', ');
    default: return String(value).trim();
  }
}

export function fromStored(field, raw) {
  const value = raw ?? '';
  switch (field.type) {
    case 'bool': return Boolean(value);
    case 'number': return value === '' ? null : Number(value);
    case 'tags': return value ? String(value).split(',').map(t => t.trim()).filter(Boolean) : [];
    default: return String(value);
  }
}

/** True when a field has nothing worth showing. */
export function isEmpty(field, value) {
  if (field.type === 'tags') return !value || !value.length;
  if (field.type === 'bool') return !value;
  return value === null || value === undefined || value === '';
}
