// The MCP endpoint: point Claude (or any MCP client) at the family.
//
//   claude mcp add --transport http ancestormap http://your-host:4322/mcp \
//     --header "Authorization: Bearer am_…"
//
// Speaks JSON-RPC 2.0 over streamable HTTP in its stateless form — every
// POST answers with plain JSON, no session, no SSE — which is all a
// tool-only server needs. Authentication is an API token minted in the app,
// and the tools are read-only by design: the same trust boundary as
// TOKEN_ROUTES, an agent can ask anything and change nothing. Data never
// leaves the box unless the *user's own* agent carries it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { kinIndexNow, kinship, stats } from './queries.js';
import { lifespan } from '../public/js/fuzzydate.js';
import { relate, labelFor } from '../public/js/kinship.js';

const VERSION = JSON.parse(fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;
const PROTOCOL = '2025-06-18';

// ---------------------------------------------------------------- the tools

const brief = p => ({
  id: p.id,
  name: p.name,
  lifespan: lifespan(p.birth, p.death, 'en'),
  birth: p.birth || null, birth_place: p.birth_place || null,
  death: p.death || null, death_place: p.death_place || null,
});

/** Who this person is to the asking account's own person, when linked. */
function kinToCaller(user, personId) {
  if (!user.person_id || user.person_id === personId) return null;
  const idx = kinIndexNow();
  const rel = relate(idx, user.person_id, personId);
  if (rel.type === 'none') return null;
  return labelFor(rel, idx.sexOf.get(personId) || null, 'en');
}

const TOOLS = [
  {
    name: 'find_person',
    description: 'Find people in the family tree by (partial) name. Returns ids, lifespans, places, and — when the API token belongs to a person in the tree — how each match is related to them.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Part of a name, case-insensitive.' } },
      required: ['query'],
    },
    run({ query }, user) {
      const needle = `%${String(query || '').trim()}%`;
      const rows = db.prepare(`SELECT * FROM persons WHERE archived=0 AND name LIKE ? COLLATE NOCASE
        ORDER BY name LIMIT 20`).all(needle);
      return rows.map(p => ({ ...brief(p), relation_to_you: kinToCaller(user, p.id) }));
    },
  },
  {
    name: 'person_facts',
    description: 'Everything documented about one person: dates, places, recorded facts, parents, partners, children, siblings, branches and the stories they appear in. Use find_person first to get the id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer', description: 'The person id.' } },
      required: ['id'],
    },
    run({ id }, user) {
      const p = db.prepare('SELECT * FROM persons WHERE id=? AND archived=0').get(Number(id));
      if (!p) throw new Error('no such person');
      const fields = {};
      for (const r of db.prepare('SELECT key, value FROM person_fields WHERE person_id=? AND user_id=0')
        .all(p.id)) fields[r.key] = r.value;
      const name = pid => db.prepare('SELECT id, name FROM persons WHERE id=?').get(pid);
      const parents = db.prepare(`SELECT DISTINCT up.person_id pid FROM children c
        JOIN union_partners up ON up.union_id = c.union_id WHERE c.child_id=?`).all(p.id).map(r => name(r.pid));
      const partners = db.prepare(`SELECT DISTINCT b.person_id pid FROM union_partners a
        JOIN union_partners b ON b.union_id = a.union_id AND b.person_id <> a.person_id
        WHERE a.person_id=?`).all(p.id).map(r => name(r.pid));
      const children = db.prepare(`SELECT DISTINCT c.child_id pid FROM union_partners up
        JOIN children c ON c.union_id = up.union_id WHERE up.person_id=?`).all(p.id).map(r => name(r.pid));
      const siblings = db.prepare(`SELECT DISTINCT o.child_id pid FROM children mine
        JOIN union_partners up ON up.union_id = mine.union_id
        JOIN union_partners theirs ON theirs.person_id = up.person_id
        JOIN children o ON o.union_id = theirs.union_id AND o.child_id <> mine.child_id
        WHERE mine.child_id=?`).all(p.id).map(r => name(r.pid));
      const branches = db.prepare(`SELECT b.name FROM person_branches pb
        JOIN branches b ON b.id = pb.branch_id WHERE pb.person_id=?`).all(p.id).map(r => r.name);
      const stories = db.prepare(`SELECT s.id, s.title, s.date, s.place FROM story_people sp
        JOIN stories s ON s.id = sp.story_id WHERE sp.person_id=? ORDER BY s.date_year`).all(p.id);
      const relationships = db.prepare('SELECT * FROM relationships WHERE a_id=? OR b_id=?').all(p.id, p.id)
        .map(r => ({ kind: r.kind, label: r.label, with: name(r.a_id === p.id ? r.b_id : r.a_id) }));
      return {
        ...brief(p), sex: p.sex || null, facts: fields, parents, partners, children, siblings,
        branches, stories, relationships, relation_to_you: kinToCaller(user, p.id),
      };
    },
  },
  {
    name: 'relationship_between',
    description: 'How two people in the tree are related: a structured descriptor plus the kinship words in German, Brazilian Portuguese and English (e.g. "Großtante", "tia-avó", "great-aunt").',
    inputSchema: {
      type: 'object',
      properties: {
        from_id: { type: 'integer', description: 'The person whose perspective to take.' },
        to_id: { type: 'integer', description: 'The person being described.' },
      },
      required: ['from_id', 'to_id'],
    },
    run({ from_id, to_id }) {
      return kinship(from_id, to_id);
    },
  },
  {
    name: 'search_stories',
    description: 'Search the family stories and life events by words in their title, text or place. Returns dates, places and who was there.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Words to look for.' } },
      required: ['query'],
    },
    run({ query }) {
      const needle = `%${String(query || '').trim()}%`;
      const stories = db.prepare(`SELECT * FROM stories
        WHERE title LIKE ? COLLATE NOCASE OR text LIKE ? COLLATE NOCASE OR place LIKE ? COLLATE NOCASE
        ORDER BY date_year LIMIT 20`).all(needle, needle, needle);
      const who = db.prepare(`SELECT p.name FROM story_people sp
        JOIN persons p ON p.id = sp.person_id WHERE sp.story_id=?`);
      return stories.map(s => ({
        id: s.id, title: s.title, kind: s.kind, date: s.date, place: s.place,
        text: s.text, people: who.all(s.id).map(r => r.name),
      }));
    },
  },
  {
    name: 'family_stats',
    description: 'Counts and time span of the whole tree: people, unions, stories, branches, sources, earliest and latest birth years.',
    inputSchema: { type: 'object', properties: {} },
    run: () => stats(),
  },
];

// ---------------------------------------------------------------- JSON-RPC

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });

/**
 * One JSON-RPC message in, one response object out — or null for a
 * notification. The dispatcher in index.js owns HTTP and authentication;
 * `user` is the already-verified token account.
 */
export function handleMcp(msg, user) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return rpcError(msg?.id, -32600, 'invalid request');
  }
  const { id, method, params = {} } = msg;
  const isNotification = id === undefined;

  try {
    if (method === 'initialize') {
      return rpcResult(id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'ancestor-map', version: VERSION },
      });
    }
    if (method === 'ping') return rpcResult(id, {});
    if (method.startsWith('notifications/')) return null;
    if (method === 'tools/list') {
      return rpcResult(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
    }
    if (method === 'tools/call') {
      const tool = TOOLS.find(x => x.name === params.name);
      if (!tool) return rpcError(id, -32602, `unknown tool: ${params.name}`);
      try {
        const out = tool.run(params.arguments || {}, user);
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
      } catch (err) {
        return rpcResult(id, { content: [{ type: 'text', text: String(err.message) }], isError: true });
      }
    }
    return isNotification ? null : rpcError(id, -32601, `unknown method: ${method}`);
  } catch (err) {
    return rpcError(id, -32603, String(err.message));
  }
}
