# CLAUDE.md

Guidance for Claude Code (and humans) working in this repo.

## What this is

A self-hosted web app for one family: their ancestry as a living, touchable
map. People, unions (marriages/partnerships), children, free-form described
relationships, stories, places — explorable from any person's perspective.
Multi-user with roles so the whole family can browse and the researchers can
edit. Public repository: **no real personal data may ever enter it** — all
fixtures and screenshots come from the seeded fictional family
(`tools/seed-demo.mjs`).

The sibling of [Friend-Map](https://github.com/martemagua/friend-map); many
modules were ported from there and keep its craftsmanship. `PITCH.md` holds
the full product vision; `BACKLOG.md` the parked work. Check BACKLOG.md
before starting something new, delete entries once done.

## Tech & philosophy

- **Node >= 22.5**, `node:sqlite`, `node:http`, `node:crypto`. No runtime
  npm dependencies *so far* — unlike Friend-Map that is a preference, not a
  law: a dependency is welcome when it genuinely earns its place (WebGL,
  GEDCOM parsing, e-mail). What stays law: **zero running costs** and
  **full data privacy** — no paid APIs, no telemetry, nothing phones home.
- **No build step, no framework.** Hand-written ES modules served from
  `public/`. Splitting files is fine; adding a toolchain is not.
- **Three languages from the first string**: de / pt-BR / en via
  `public/js/i18n.js` + `public/js/lang/*.js`. The i18n test enforces that
  every key exists in all three files. Server responses carry message *keys*
  (plus params), resolved in the client's language — never hardcoded prose.
- Playwright is used by the UI smoke test but is deliberately not a
  dependency — the script resolves it from wherever it's installed.

## Run / develop

```bash
npm run dev                  # http://localhost:4322, data in ./data
npm test                     # all suites: spawns a real server on a temp dir
npm run seed                 # fictional demo family into ./data
node tests/ui.smoke.mjs      # browser walkthrough (needs Playwright)
docker compose up -d --build # production-like, local
```

`tests/api.test.js` drives the HTTP API exactly as the frontend does — add to
it whenever you touch `server/`. DOM-free modules (`fuzzydate.js`,
`kinship.js`, `fields.js`, `i18n.js`, `layout.js`, the rules in `map.js`) are
unit-tested under plain node; keep them free of DOM/browser globals or their
tests stop working. Map work is judged on the seeded family, never on five
nodes.

## Data model (the short version)

- `persons` holds only structural columns (`name`, `sex`, fuzzy `birth`/
  `death` text plus derived `birth_year`/`death_year` ints, `location`,
  `lat`/`lon`, `x`/`y`, `archived`, `created_by`). Everything else lives in
  `person_fields(person_id, user_id, key, value)` driven by the registry in
  `public/js/fields.js` — one array entry defines a field; no column, no
  migration, no form markup.
- **Effective field value = your row, else the shared row (`user_id` 0).**
  The shared row is "the documented record", a personal row is "my
  hypothesis". An emptied personal field deletes its row (an empty row would
  mask the record forever); `toStored` turns an empty number into `''`, not 0.
- **A registry field may be conditional (`showIf`), and the rule that makes
  that safe is that a field holding a value is always shown.** Hiding may only
  ever affect empty fields — otherwise one wrong tap on "lebt" strands a
  recorded cause of death somewhere invisible and unreachable.
- **Whether somebody is alive is asked, not derived.** `living` is its own
  field (lebt / verstorben / unbekannt) because you often know a person died
  without knowing when, and the fuzzy grammar cannot say the first without
  inventing the second. It is what the death block hangs off.
- **Unions are first-class**: `unions` + `union_partners` + `children
  (union_id, child_id, role)`. Children always hang off a union; a single
  known parent is a one-partner union (GEDCOM-compatible). No parent columns
  on persons — don't add them back.
- **`placeInTree()` in routes.js is the one set of connect semantics**, used
  by createPerson's `connect` and by `POST /api/persons/:id/connect` (the
  quick-add's "Vorhandene verbinden" mode). Its completion rule matters:
  adding a partner or a parent joins the anchor's *half-empty* union — the
  children already there become the couple's — and only opens a new union
  when both seats are taken or several unions exist. Always creating a new
  union is how a grandmother ended up beside her husband while their
  daughter dangled from him alone, unrepairable from any form. A stated
  `kind` replaces only the `'unbekannt'` placeholder, never a real one.
- **The vocabularies live in `public/js/vocab.js`, once.** Relationship kinds,
  union kinds, how a union ended, child roles, story kinds. Both sides import
  it — the browser to draw the pickers, the server to refuse anything else on
  write — because they used to be written out twice and a kind the form offers
  and the server rejects is a bug you find on a Sunday. `tests/vocab.test.js`
  holds them to it, including that every id is sayable in all three languages.
- `relationships(a_id, b_id, kind, label, from_id)` are the free-form described
  links (godmother, exchange family, guardian, …), separate from the tree
  structure. `pair()` stores the lower id in `a_id`, so the row itself is
  undirected — **`from_id` is the one direction it carries**, for the kinds
  marked `directed` in vocab.js: a guardian and a ward are not the same thing
  said twice. It is normalised on every write the way Friend-Map normalises a
  family degree's elder — always one of the row's own two ends, and dropped
  entirely for a mutual kind, so changing Vormund to Freunde can never leave a
  stale direction behind for a card to read later.
- **How a union ended is `ended_reason`, not a kind.** A divorced marriage was
  still a marriage; GEDCOM draws the same line (MARR made it, DIV ended it).
  Putting 'geschieden' in `unions.kind` would overwrite what it was.
- `branches` nest like Friend-Map's circles: membership is stored only at the
  innermost branch and inherited upward. Ring refusal happens at write *and*
  import; the client walks are only guarded so an old database can't hang the
  app.
- Fuzzy dates are an EDTF subset handled solely by `public/js/fuzzydate.js`
  (`1885`, `1885-03`, `1885-03-14`, `~1885`, `<1920`, `>1918`,
  `1914..1918`). Store the text; derive `*_year` through `sortYear()` on
  every write. Don't parse dates anywhere else — the forms' date picker
  (`fuzzyDateHtml`/`mountFuzzyDates` in ui.js) also composes through it
  (`composeFuzzy`/`toParts`), writes into a hidden input carrying the
  field's `data-f`, and keeps free text as free text; the round trip is
  tested under plain node.
- **Geschichten carries life events as well as anecdotes**, and that is
  deliberate: a residence, an emigration, a term of service and a census entry
  are all a kind, a fuzzy date, a place and the people involved — the shape
  GEDCOM gives an event. Widening `STORY_KINDS` is how a new dated fact gets
  recorded; adding a person field for each would be a wider form every time,
  a dead end for anything with two dates, and invisible to Orte and Zeit. The
  card's Lebenslauf merges the structural dates, the marriages and every story
  into one spine.
- Kinship ("your great-aunt", "cousin twice removed") is computed by
  `public/js/kinship.js` from the union graph relative to the current
  proband — never stored. Same for generations.
- **A family not joined to the rest is walked on its own.** `indexGenerations`
  BFSes from the proband, then seeds every remaining component from its
  best-attached member and walks that too, shifting the whole island by its
  birth years against the proband's (a generation ≈ 28 years) when it has
  any. Dropping everyone the first walk missed onto row 0 drew a grandmother
  beside her grandson as though they were siblings — and that is the normal
  state of a family halfway through being typed in.
- **Where everybody stands is computed, not stored.** `public/js/layout.js`
  assigns every X from the graph on each relayout; `persons.x/y` are legacy
  columns kept only so an old backup still restores. The one thing a person
  carries is `persons.order_key` — their place along their own row, written
  only when somebody drags them (`POST /api/layout-order`) and cleared for
  everyone by the ↔️ button.

## The chart

`public/js/layout.js` is the whole arrangement, and it is DOM-free so
`tests/layout.test.js` can check the rules under plain node. Four steps:
cells → order → place → anchors. It replaced a force simulation, and the
reasons are worth keeping in mind, because each one is a bug that came back
the moment the rule was relaxed:

- **A couple is one indivisible cell.** Physics has no notion of "stay beside
  your spouse", so strangers drifted between two partners and the partner bar
  drew straight through them.
- **The ordering unit is the family, not the person.** A plain barycentre
  sweep lets a neighbour with a better average slide into the middle of
  somebody's children; ordering whole sibling groups makes a family
  contiguous by construction. `c.family` is the parent union a cell stands
  in — a married couple descends from two and can only be in one, so the
  person seated first takes theirs, and the other family's line runs long.
  That same choice weights the pull, or the couple floats halfway between
  two families and neither sibling bar closes up.
- **Pulls are expressed in seats, not cell centres**, or a child who is also
  half of a couple lands beside their parents' descent line instead of under
  it. The child-under-parents pull outweighs the parents-over-children one:
  a kink in a descent line is visible, an anchor sitting off the middle of
  its brood is not.
- **`separate()` expands a row around its own middle.** Opening gaps left to
  right moves everything on the right and nothing on the left, the parents
  above follow that creep, pull the children further the same way, and the
  whole tree walks off the screen and never settles.
- **Sibling bars are laid into lanes** (`laneShelves()`). Two families' bars
  at the same height and side by side are one long line as far as an eye is
  concerned, and then nothing says whose children are whose.
- **A row somebody dragged is pinned** — `order_key` on any person in it
  takes that generation out of the sweeps entirely. The automatic
  arrangement is a good guess, not an argument.
- **The placement step decays** (`PASSES`/`DECAY`). With a constant step the
  rows go on nudging each other outward for hundreds of passes, so the chart
  is really a picture of where the loop was cut off — change the pass count
  and every family sits differently. Decaying, 60 passes and 600 agree.
- **The sibling bar spans the anchor as well as the children**
  (`shelfSpan()` in map.js). An only child sitting a little to the side of
  their parents otherwise gets two verticals with nothing joining them, and
  the descent line simply stops in mid-air.
- `ctx.yOf(person)` is the only difference between the two modes, so
  Generationen and Zeit share one horizontal arrangement and the tree keeps
  its shape when you switch.

`node tests/busy.mjs <dir>` seeds the family and photographs the result at
both widths, in both themes, in both modes — that is what map work is judged
on.

## Things that will bite you

- **Roles are enforced server-side per route.** viewer = read only,
  editor = domain writes, admin = users/invites/settings/backups/import.
  The route table in `server/index.js` carries the minimum role; adding a
  route there is a security decision. There is no client-side-only guard.
- **`PUBLIC_ROUTES` is a deny-list-free allow-list** — the only way past the
  auth gate without a session. Same discipline for `TOKEN_ROUTES` (GET-only,
  for API tokens).
- **`/mcp` (server/mcp.js) is token-only and read-only** — JSON-RPC for AI
  agents, no cookie path on purpose, tools can ask anything and change
  nothing. `server/gedcom.js` is the other interop door (admin, export only).
- **Boot migrations**: schema uses `CREATE TABLE IF NOT EXISTS`; new columns
  go through `ensureColumn()`; data migrations are meta-flagged transactions
  (check flag → one transaction → set flag).
- **A new persons *column* must go into the allow-list in `routes.js`** or
  writes silently drop it — but most new person facts are a registry entry,
  not a column.
- **`persons.x/y` must never seed a position.** They are what the old force
  simulation saved and they describe an arrangement that no longer exists;
  started from, the whole tree opens in a heap and only sorts itself out
  when something happens to relayout it. `rebuild()` seats anybody the map
  has not seated itself (`p._seated`), which is not the same test as
  "has no coordinates".
- **Role-dependent chrome is hidden before `#app` is shown.** Revealing the
  shell first and hiding the editing controls once the data has loaded
  flashes an add button past every viewer on every load.
- **Sheets stay in the DOM when closed** (translated off-screen). Test
  selectors must use `.sheet.show`.
- **Static assets are `no-cache` with an ETag** — a `docker pull` reaches
  every browser on next load. The service worker must never cache `/api/`.
- **Dates that mean "today" must be local**, never `toISOString()` — UTC
  midnight is yesterday in CET and half of Brazil.
- **Map colours come from CSS custom properties** read with
  `getComputedStyle` — never hardcode a hex in JS that exists as a token.
  Every colour is defined on bare `:root`, then overridden in
  `@media (prefers-color-scheme: dark)` *and* `:root[data-theme="dark"]`.
- **One width breakpoint: 760px.** Below it a phone, above it a rail +
  columns + side-drawer sheet. Don't add a second one.
- **Nominatim policy is why geocoding is server-side**: 1 req/s across the
  installation, a real User-Agent, cached results. Tiles go browser→OSM
  directly (`referrerpolicy="origin"` stays); the server tile proxy is a
  fallback, not the normal path.
- **Import never touches `users`/`sessions`** so a restore can't lock anyone
  out, and it relinks `users.person_id` after replacing persons.
- **Exports never carry secrets** — no API keys, no password hashes.

## UI conventions

- All user-facing strings go through `t()` — no literal prose in markup or
  JS, including server error keys.
- Unexpected server errors surface as one generic localized sentence; only
  errors we raised ourselves (with a `status` and a key) are shown verbatim.
- Empty states always carry the way back out (a reset-filters button, a
  create button) — an empty list must never read as a dead end.
