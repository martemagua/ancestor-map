# Ancestor Map — Pitch

*A living, touchable map of a family across generations.*

Ancestor Map is **Friend-Map turned ninety degrees in time**: the same organic,
mobile-first network map that made the friend map fun to use, applied to a
family tree. Not a form-grinding genealogy database — a map you wander through,
where every dot is a person with a story, and where the tree can be read from
anyone's point of view.

Self-hosted on your own hardware. Zero running costs. Your family's data never
leaves your box.

---

## The idea in three images

1. **The tree as a map.** Ancestors above, descendants below, siblings side by
   side — but laid out organically by the physics engine, not as a rigid chart.
   You pinch, pan, and long-press exactly like on the friend map. Zoom out and
   family branches melt into named, colored blobs; zoom in and names, dates and
   connections earn their place one by one.

2. **Any person as the center.** Tap "view from here" on your great-aunt and
   the whole tree re-reads itself relative to her: generations recount,
   kinship labels recompute ("great-nephew", "cousin twice removed"), her
   in-laws' branch unfolds. *Seeing the tree from the perspective of different
   people* is the app's signature move — the "Wessen Karte?" switch from
   Friend-Map, generalized from two people to everyone who ever lived.

3. **A place for everything you know about them.** Every person carries facts
   (fuzzy dates included — "um 1885" is a first-class value), free-text notes,
   stories, documents, photos, video and audio — browsable in a small media
   explorer on their card.

---

## What it looks like

Same shell as Friend-Map: a phone-first app with a handful of tabs, sheets
that slide up, one width breakpoint, light and dark. The tabs:

### Baum (Tree)

The canvas map, in a new **generational layout mode**: each generation gets a
horizontal band (hard Y target), and within the band the force simulation
arranges people naturally — couples pull together, siblings line up, branches
spread. All the beloved mechanics carry over: long-press spotlights a person's
whole web, labels and edges are *earned* as you zoom, branch blobs replace
detail at a distance.

**Two Y-axes, one toggle:**

- **Generationen** — classic tree: ancestors up, descendants down.
- **Zeit** — people sit at their **birth year**, independent of generation.
  Older above, younger below; an uncle born after his nephew visibly sits
  below him, and generations shear and overlap the way history actually did.
  A faint year ruler runs behind the tree. Architecturally this is the same
  layout with a different Y function — which is exactly why the layout is
  built as "hard Y target + free X" from day one.

**Layers.** One family is, in practice, several families layered together.
A family that married in — your partner's side, an in-law lineage — is its own
**branch layer**: toggleable, colored, explorable. Switch a branch off and the
tree focuses; set a married-in person as the center and their side unfolds.
(Under the hood this reuses Friend-Map's nested-circles machinery: branches
nest, membership is inherited upward, a branch draws one blob per huddle.)

**Beyond blood.** People can be linked freely with a **described
relationship** — godmother, witness at the wedding, emigrated together,
business partner, the exchange family you're still close to. A kind plus free
text saying what the relationship *entails*. These people don't need a blood
edge at all; the layout parks them beside whoever they're linked to. On the
map they're an optional thin layer ("further connections"); on the card and in
search they're always there.

### Menschen (People)

The list and the person card. Facts come from a **field registry** — one
array entry defines a field's key, type, label and scope; no migration, no
form markup, no new column. Genealogy field types included from the start:

- **Fuzzy dates**: `um 1885`, `vor 1920`, `1914–1918` — parsed, sortable,
  honest about uncertainty.
- **Sources/citations**: where a fact comes from, attached to the fact.
- The usual: places of birth/death, occupation, religion, notes, links.

Each researcher also gets a personal layer on top of the shared facts:
**"documented fact" vs "my hypothesis"** — your working theory about
great-grandfather's second marriage doesn't overwrite the family's agreed
record, and both are visible side by side. (This is Friend-Map's shared/personal
field split, which turns out to be exactly what collaborative genealogy needs.)

**Media explorer.** Every person (and every story) has a small file browser:

| Source | What it is |
|---|---|
| **Local libraries** | Directories on the server (e.g. NAS datasets) mounted read-only and registered in settings. The app indexes and streams from them — video and audio seek via range requests — and never copies or modifies a file. |
| **Uploads** | Scans of certificates, letters, census pages — stored content-addressed under the app's data directory. |
| **Immich** | Face-linked photos and photo strips, per-user libraries, exactly as in Friend-Map. |
| **External links** | YouTube, archives, anywhere — attached to a person or story. Embeds are off by default (an embed calls a third party); links always work. |

Pluggable sources are the point: it works with the datasets already on your
server, and it works for a stranger who installs the app with nothing but a
Docker volume.

### Geschichten (Stories)

The heart of the app once the skeleton stands. Friend-Map's "Momente" grow
into **life events and stories**: births, marriages, migrations, war service,
the anecdote about the stolen goose — dated (fuzzily if need be), placed on
the map, linking the people who were part of them, carrying media. Every
person's card shows their timeline; every story is findable from everyone in
it.

### Orte (Places)

The hand-written slippy map from Friend-Map, extended with **layers**:

- Pins for births, deaths, residences, story locations.
- A **time slider** — drag through the decades and watch the family move.
- **Migration arcs** — birthplace to place of death, the family's paths drawn
  across the map.
- Optional **historical map overlays** — georeferenced old maps are standard
  XYZ tile endpoints and drop straight into the existing tile engine.

Geocoding stays server-side, throttled and cached, respecting the Nominatim
usage policy — that part of Friend-Map is done right and comes over verbatim.

### Verwaltung (Admin)

The desktop admin page, now with real **user management**: create accounts,
assign roles, issue invites, manage API tokens, configure media libraries,
inspect backups, merge duplicate people (a GEDCOM import's best friend).

---

## Sharing it with the family

One installation hosts **one tree** (layered, as above) and **many users**:

- **Roles**: Admin / Editor / Viewer. Grandma can browse on her phone without
  ever being one tap away from deleting a great-uncle; the cousin who's into
  genealogy gets an editor account.
- **Invites by email**, per-user password reset, per-user personal notes and
  hypotheses on top of the shared record.
- A real **authorization layer** — the one thing Friend-Map deliberately
  doesn't have (any login can do anything; fine for a couple, disqualifying
  for a family of twelve). Built new, with the request-gating patterns
  (allow-list routes, hashed sessions, rate limiting) inherited.

## AI access — the tree as an agent's database

The app ships with an **MCP server**, so you can point Claude (or any agent)
at your family and ask:

> *"How is Maria Souza related to me?"*
> *"What do we know about Wilhelm's years in Brazil?"*
> *"List everyone who lived in Blumenau before 1930."*
> *"Which facts about Anna have no source yet?"*

Tools like `find_person`, `person_facts`, `relationship_between` (kinship path
with degree names), `family_of`, `search_events`, and — as an explicit opt-in
per token — `add_note`. Authentication rides on Friend-Map's proven hashed
API-token model: per-account, read-only by default, revocable, never exported.
The MCP endpoint runs inside the same container; nothing about your family
leaves the box unless *your* agent carries it.

## Interop: GEDCOM in and out

GEDCOM is the one format every genealogy tool speaks. **Import** brings an
existing tree in and hands the leftovers to the duplicate-finder and
person-merge tooling (patterns inherited from Friend-Map's admin). **Export**
is the anti-lock-in promise a public project should make: your data walks out
whole, any day.

## Later acts

- **3D view.** The generational layout computes coordinates that extend
  naturally to a z-axis; with a WebGL renderer (three.js) the tree becomes an
  orbitable space with time as the third dimension. Staged after the 2D tree
  is solid — a second renderer, not a second data model. A 2.5D
  depth/parallax mode on the 2D canvas is the pragmatic stepping stone.
- **More map layers**: historical borders (vector overlays), density views,
  "everyone alive in year X".
- **Anniversaries & remembrance**: birthdays of the living, memorial days of
  the dead, surfaced gently — with the same automation-friendly read API that
  feeds n8n/Telegram in Friend-Map.

---

## Principles

1. **Private by architecture.** Self-hosted, same-origin, no telemetry, no
   third-party calls the user didn't configure. Secrets live in the database,
   never in files; exports never carry API keys. This public repository will
   never contain personal data: the data directory is ignored from the first
   commit, and every screenshot and demo comes from a **seeded fictional
   family** (a generator script builds a four-generation demo tree, the way
   Friend-Map's `busy.mjs` builds a crowd).
2. **Zero running costs.** OpenStreetMap tiles and Nominatim within their
   usage policies, your own Immich, your own SMTP. Nothing metered, nothing
   subscription-shaped.
3. **Dependencies are welcome, but earned.** Unlike Friend-Map's hard
   zero-dependency rule, Ancestor Map takes a library where it genuinely
   improves the experience (WebGL, GEDCOM parsing, multipart uploads,
   e-mail). Few, well-chosen, audited — the supply chain stays small enough
   to read.
4. **Three languages from the first string.** German, Brazilian Portuguese
   and English via a small dictionary layer (`t(key)`, one module per
   language). Server messages are keys, resolved in the client's language.
5. **Fun is a requirement.** The physics, the gestures, the earned labels,
   the blobs — the things that make the friend map a joy — are the point, not
   decoration. Map work is judged on a seeded 150-person tree, never on five
   nodes.

---

## Standing on Friend-Map's shoulders

Ancestor Map is a **fresh codebase** that copies Friend-Map's proven modules
rather than forking the repo — the domain layer is new, the craftsmanship
carries over:

| Inherited nearly verbatim | Adapted | Built new |
|---|---|---|
| Canvas gesture layer (pinch, long-press spotlight, tap guards) | Physics: generational/time Y-targets instead of ego gravity | Union nodes: marriages/partnerships as first-class entities; children hang off a union |
| Label collision field, edge thinning, hull blobs | Family degree registry → full kinship computation from any proband | Roles & authorization layer |
| Field registry pattern (one entry = one field) | Nested circles → branch layers | Fuzzy-date and citation field types |
| Auth plumbing: scrypt, hashed sessions/tokens/resets, rate limiting | Momente → Geschichten (life events + stories) | Media explorer with pluggable sources; streamed upload |
| Slippy map, Nominatim client, tile-policy compliance | Immich client → N-user sharing | MCP server |
| Nightly backups (JSON + `VACUUM INTO`), export/import discipline | SMTP → per-user email, library-based | GEDCOM import/export |
| Docker one-container deployment, boot migrations (`ensureColumn` + flagged transactions) | | i18n layer (de / pt-BR / en) |

**Data model sketch:** `persons` + `person_fields` (registry EAV, shared vs
personal rows) · `unions` (partnerships as nodes, with kind and fuzzy dates) ·
`parent_child` (edges with role: biological / adopted / step) ·
`relationships` (free-form described links, in and beyond the tree) ·
`branches` (nested layers) · `events` / `stories` · `sources` · `media` +
`media_links` (anything attachable to anyone) · `users`, `sessions`,
`api_tokens`, `invites`.

## Roadmap

| Version | Delivers |
|---|---|
| **0.1** | Skeleton: inherited infrastructure (auth, static, backup, Docker), new schema, seeded demo family, read-only tree with generational layout |
| **0.2** | Editing: person card, registry fields with fuzzy dates, unions, perspective switch |
| **0.3** | Multi-user: roles, invites, personal notes/hypotheses |
| **0.4** | Orte with time slider, GEDCOM import/export, described relationships, **Zeit** layout mode |
| **0.5** | Media explorer (uploads, local libraries, external links), Immich, Geschichten |
| **0.6** | MCP server (read tools first, opt-in write) |
| **later** | Historical map overlays, migration arcs, 3D view |

---

*This pitch is grounded in a full read of the Friend-Map codebase (frontend
map engine, backend, deployment). The decisions above — union nodes, one
layered tree, i18n, dependencies-allowed, MCP, described relationships, the
Zeit mode, the media explorer — were settled with Martin on 2026-08-19.*
