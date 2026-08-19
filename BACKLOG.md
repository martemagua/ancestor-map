# Backlog

Open work and parked ideas, in rough order. Delete entries once done — the
history lives in the git log. The full product vision is in `PITCH.md`.

## Parked features (designed in the pitch, not yet built)

- **Media explorer** — per-person/story media from pluggable sources:
  read-only local libraries (server directories registered in settings,
  streamed with range requests), content-addressed uploads under
  `DATA_DIR/media/`, external links (YouTube etc., embeds off by default).
  Tables sketched in PITCH.md: `media` + `media_links`.
- **Immich integration** — per-user libraries, face links, thumbnail proxy.
  Friend-Map's `server/immich.js` is the ~90% starting point; the pairwise
  sharing model must generalize to N users.
- **MCP server** — read-only tools (`find_person`, `person_facts`,
  `relationship_between`, `search_stories`) over the api_tokens gate; write
  tools as explicit per-token opt-in.
- **GEDCOM import/export** — export first (anti-lock-in), import feeding the
  duplicate finder + merge.
- **E-mail** — invites and password resets by mail (likely nodemailer);
  until then invite links are copied from /admin and resets use the CLI
  escape hatch.
- **Orte extensions** — migration arcs (birth → death), historical map
  overlays (XYZ endpoints), vector layers for old borders.
- **3D view** — time/generation as third axis (three.js); the 2D layout's
  coordinates are designed to extend to z. 2.5D parallax as stepping stone.
- **Anniversaries & remembrance** — birthdays of the living, memorial days,
  automation-friendly read endpoints (n8n/Telegram like Friend-Map).
- **PWA install polish** — beforeinstallprompt button, HTTPS notes.
