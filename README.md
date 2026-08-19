# Ancestor Map

*A living, touchable map of a family across generations.*

Ancestor Map is a self-hosted web app for building and exploring a family
tree the way you'd wander a map, not fill in a database: an organic canvas of
people and generations you pinch, pan and long-press through, with facts,
stories and places attached to everyone — and the whole tree readable from
any person's perspective.

It is the sibling of [Friend-Map](https://github.com/martemagua/friend-map)
and inherits its philosophy: one small container, your own hardware, zero
running costs, no telemetry, and no personal data anywhere near this public
repository. See [PITCH.md](PITCH.md) for the full vision.

**Status: early development.** The sections below grow as the app does.

## Quick start

```bash
docker compose up -d --build   # http://localhost:4322
```

Or without Docker (Node >= 22.5):

```bash
npm run dev                    # http://localhost:4322, data in ./data
```

On first visit the app walks you through creating the admin account.

## Development

```bash
npm run dev     # dev server with watch, data in ./data
npm test        # all test suites (node:test, no test framework to install)
npm run seed    # build the fictional demo family into ./data
```

Everything user-facing speaks German, Brazilian Portuguese and English —
the app follows the browser, each account can override it.

## Privacy

- All data lives in a single SQLite file under `DATA_DIR` on your machine.
- `data/` is gitignored; demo content comes from a seeded fictional family.
- Exports never contain API keys or password hashes.
- No third-party requests except the map tile / geocoding services you
  configure, used within their public usage policies.

## License

[MIT](LICENSE)
