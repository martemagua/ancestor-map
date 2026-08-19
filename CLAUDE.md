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
`kinship.js`, `fields.js`, `i18n.js`, the layout rules in `map.js`) are
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
- **Unions are first-class**: `unions` + `union_partners` + `children
  (union_id, child_id, role)`. Children always hang off a union; a single
  known parent is a one-partner union (GEDCOM-compatible). No parent columns
  on persons — don't add them back.
- `relationships(a_id, b_id, kind, label)` are the free-form described links
  (godmother, exchange family, …), undirected — `pair()` stores the lower id
  in `a_id`. They are deliberately separate from the tree structure.
- `branches` nest like Friend-Map's circles: membership is stored only at the
  innermost branch and inherited upward. Ring refusal happens at write *and*
  import; the client walks are only guarded so an old database can't hang the
  app.
- Fuzzy dates are an EDTF subset handled solely by `public/js/fuzzydate.js`
  (`1885`, `1885-03`, `1885-03-14`, `~1885`, `<1920`, `>1918`,
  `1914..1918`). Store the text; derive `*_year` through `sortYear()` on
  every write. Don't parse dates anywhere else.
- Kinship ("your great-aunt", "cousin twice removed") is computed by
  `public/js/kinship.js` from the union graph relative to the current
  proband — never stored. Same for generations.

## Things that will bite you

- **Roles are enforced server-side per route.** viewer = read only,
  editor = domain writes, admin = users/invites/settings/backups/import.
  The route table in `server/index.js` carries the minimum role; adding a
  route there is a security decision. There is no client-side-only guard.
- **`PUBLIC_ROUTES` is a deny-list-free allow-list** — the only way past the
  auth gate without a session. Same discipline for `TOKEN_ROUTES` (GET-only,
  for API tokens).
- **Boot migrations**: schema uses `CREATE TABLE IF NOT EXISTS`; new columns
  go through `ensureColumn()`; data migrations are meta-flagged transactions
  (check flag → one transaction → set flag).
- **A new persons *column* must go into the allow-list in `routes.js`** or
  writes silently drop it — but most new person facts are a registry entry,
  not a column.
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
