// GEDCOM 5.5.1 export — the one format every genealogy tool speaks, and the
// anti-lock-in promise a public project should make: your data walks out
// whole, any day, into Gramps, Ancestry, FamilySearch or a text editor.
//
// The union model maps 1:1 onto GEDCOM's INDI/FAM records: every union is a
// FAM, every child a CHIL, a one-partner union a one-spouse family. Fuzzy
// dates translate losslessly (~ → ABT, < → BEF, > → AFT, a..b → BET/AND);
// free-text dates travel as GEDCOM date phrases in parentheses.
import { db } from './db.js';
import { FIELDS } from '../public/js/fields.js';
import { parseFuzzy } from '../public/js/fuzzydate.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function gedcomDate(text) {
  const p = parseFuzzy(text);
  if (!p) return '';
  if (p.kind === 'text') return `(${p.raw.replace(/[()\n]/g, ' ').trim()})`;
  const exact = ({ y, m, d }) => [d, m && MONTHS[m - 1], y].filter(Boolean).join(' ');
  switch (p.kind) {
    case 'exact': return exact(p.parts);
    case 'circa': return `ABT ${exact(p.parts)}`;
    case 'before': return `BEF ${exact(p.parts)}`;
    case 'after': return `AFT ${exact(p.parts)}`;
    case 'range': return `BET ${exact(p.parts)} AND ${exact(p.parts2)}`;
    default: return '';
  }
}

/** "Otto Brandt" → "Otto /Brandt/" — the last word is the best surname guess. */
function gedcomName(name) {
  const parts = String(name || '').trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || '';
  const last = parts.pop();
  return `${parts.join(' ')} /${last}/`;
}

/** Long values continue on CONT (newlines) and CONC (length) lines. */
function longText(level, tag, value) {
  const out = [];
  const lines = String(value).split(/\r?\n/);
  lines.forEach((line, i) => {
    let head = line.slice(0, 200);
    let rest = line.slice(200);
    out.push(`${level} ${i === 0 ? tag : 'CONT'} ${head}`.trimEnd());
    while (rest) {
      out.push(`${level + 1} CONC ${rest.slice(0, 200)}`);
      rest = rest.slice(200);
    }
  });
  return out;
}

// Which registry fields have a GEDCOM tag of their own; the rest of the
// documented record travels as NOTE lines so nothing is silently dropped.
const FIELD_TAGS = { occupation: 'OCCU', religion: 'RELI', education: 'EDUC', nickname: 'NICK' };

export function exportGedcom() {
  const persons = db.prepare('SELECT * FROM persons WHERE archived=0 ORDER BY id').all();
  const unions = db.prepare('SELECT * FROM unions ORDER BY id').all();
  const partners = db.prepare('SELECT * FROM union_partners').all();
  const children = db.prepare('SELECT * FROM children').all();
  // Only the documented record (user_id 0) leaves — personal hypotheses are
  // each researcher's own and stay home, like every other secret.
  const fields = {};
  for (const r of db.prepare('SELECT person_id, key, value FROM person_fields WHERE user_id=0').all()) {
    (fields[r.person_id] ||= {})[r.key] = r.value;
  }

  const partnersOf = {};
  for (const r of partners) (partnersOf[r.union_id] ||= []).push(r.person_id);
  const childrenOf = {};
  for (const r of children) (childrenOf[r.union_id] ||= []).push(r);
  const famsOf = {};       // person → unions they are a partner in
  for (const r of partners) (famsOf[r.person_id] ||= []).push(r.union_id);
  const famcOf = {};       // person → child rows
  for (const r of children) (famcOf[r.child_id] ||= []).push(r);
  const personIds = new Set(persons.map(p => p.id));

  const out = [
    '0 HEAD',
    '1 SOUR AncestorMap',
    '1 GEDC',
    '2 VERS 5.5.1',
    '2 FORM LINEAGE-LINKED',
    '1 CHAR UTF-8',
  ];

  for (const p of persons) {
    out.push(`0 @I${p.id}@ INDI`);
    out.push(`1 NAME ${gedcomName(p.name)}`);
    if (p.sex === 'm') out.push('1 SEX M');
    if (p.sex === 'f') out.push('1 SEX F');
    if (p.birth || p.birth_place) {
      out.push('1 BIRT');
      const date = gedcomDate(p.birth);
      if (date) out.push(`2 DATE ${date}`);
      if (p.birth_place) out.push(`2 PLAC ${p.birth_place}`);
    }
    if (p.death || p.death_place) {
      out.push('1 DEAT');
      const date = gedcomDate(p.death);
      if (date) out.push(`2 DATE ${date}`);
      if (p.death_place) out.push(`2 PLAC ${p.death_place}`);
    }
    const mine = fields[p.id] || {};
    for (const f of FIELDS) {
      const value = mine[f.key];
      if (!value || f.scope !== 'gemeinsam') continue;
      const tag = FIELD_TAGS[f.key];
      if (tag) out.push(...longText(1, tag, value));
      else out.push(...longText(1, 'NOTE', `${f.key}: ${value}`));
    }
    for (const uid of famsOf[p.id] || []) out.push(`1 FAMS @F${uid}@`);
    for (const row of famcOf[p.id] || []) {
      out.push(`1 FAMC @F${row.union_id}@`);
      if (row.role === 'adoptiert') out.push('2 PEDI adopted');
      if (row.role === 'pflege') out.push('2 PEDI foster');
      if (row.role === 'stief') out.push('2 PEDI step');
    }
  }

  for (const u of unions) {
    const seated = (partnersOf[u.id] || []).filter(id => personIds.has(id));
    const kids = (childrenOf[u.id] || []).filter(r => personIds.has(r.child_id));
    if (!seated.length && !kids.length) continue;
    out.push(`0 @F${u.id}@ FAM`);
    // HUSB/WIFE by recorded sex; a pair the fields cannot split keeps file
    // order — GEDCOM 5.5.1 has no better seat to offer.
    const bySex = sex => seated.find(id => persons.find(p => p.id === id)?.sex === sex);
    const husb = bySex('m') ?? seated[0];
    const wife = bySex('f') ?? seated.find(id => id !== husb);
    if (husb != null) out.push(`1 HUSB @I${husb}@`);
    if (wife != null && wife !== husb) out.push(`1 WIFE @I${wife}@`);
    for (const row of kids) out.push(`1 CHIL @I${row.child_id}@`);
    if (u.kind === 'ehe' || u.started) {
      out.push('1 MARR');
      const date = gedcomDate(u.started);
      if (date) out.push(`2 DATE ${date}`);
    }
    if (u.note) out.push(...longText(1, 'NOTE', u.note));
  }

  out.push('0 TRLR');
  return out.join('\n') + '\n';
}
