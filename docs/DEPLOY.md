# Deploying on TrueNAS SCALE

Two instances, two jobs:

| | Test | Stable |
|---|---|---|
| Image | `ghcr.io/martemagua/ancestor-map:dev` | `ghcr.io/martemagua/ancestor-map:latest` |
| Built from | every push to the `dev` branch | every merge into `main` |
| Port | 4323 | 4322 |
| Dataset | `…/apps/ancestormap-test` | `…/apps/ancestormap` |
| Data | seeded fictional family / throwaway | the real family |

The compose files live in the repo root: `docker-compose.truenas-test.yml`
and `docker-compose.truenas.yml`.

## The release flow (dev → main)

1. New work lands on the **`dev`** branch. CI runs the tests and publishes
   the `:dev` image.
2. The **test instance** tracks `:dev` — restart the app (or hit *Update*)
   to pull the newest build and click around.
3. Satisfied? Open a **pull request `dev` → `main`**. Merging it makes CI
   publish `:latest`, and the **stable instance** picks it up on its next
   update. `main` therefore only ever contains versions that went through
   the test instance.
4. Never edit `main` directly; it moves only through pull requests.

## One-time: make the image pullable

GitHub builds the image into the **GitHub Container Registry (GHCR)** — and
packages start *private* even on a public repository. Once, do either:

- **Make the package public** (recommended): GitHub → your profile →
  *Packages* → `ancestor-map` → *Package settings* → *Change visibility* →
  Public. TrueNAS can then pull with no credentials.
- Or keep it private and log the NAS in: shell on TrueNAS,
  `docker login ghcr.io -u martemagua` with a personal access token that has
  `read:packages`.

## Installing an instance (TrueNAS SCALE 24.10 "Electric Eel" or newer)

1. **Dataset**: Storage → your pool → *Add Dataset* →
   `apps/ancestormap-test` (and later `apps/ancestormap`). Ownership: the
   apps user `568` (Dataset → Permissions → set user/group `apps`).
2. **App**: Apps → *Discover Apps* → top-right ⋮ → **Install via YAML** →
   name it `ancestormap-test` → paste `docker-compose.truenas-test.yml` →
   fix the `volumes:` line to your pool's real path → Save.
3. Open `http://NAS-IP:4323` — the setup wizard creates the admin account.
4. **Try it with fictional people first**: TrueNAS → the app's shell →
   `node tools/seed-demo.mjs` (the seed only fills an *empty* family).

The stable instance is the same three steps with the other compose file,
port 4322, and its own dataset — after the first `dev` → `main` merge has
published `:latest`.

## Updating

- **Test**: Apps → `ancestormap-test` → *Update* (or stop/start) — it
  re-pulls `:dev`.
- **Stable**: same, after a merge to `main`. Static files are served
  `no-cache`, so every browser runs the new version on its next load.

## Reaching it from outside the LAN

Anything beyond the LAN wants TLS in front — Tailscale (`tailscale serve`)
is the zero-config way; a reverse proxy (Caddy, nginx, Traefik) works too.
Set `TRUST_PROXY: "1"` in the compose environment when a proxy is in front,
so rate limiting sees real client addresses. Installing the app on a phone
(PWA) requires a secure origin.

## Backups

Everything lives in the dataset you mounted on `/data`: the SQLite file plus
nightly self-backups (JSON + a consistent `.db` copy, pruned to
`BACKUP_KEEP`). Snapshot that dataset with ZFS and you have the whole story.
A restore is: point a fresh instance at the dataset — or import a JSON
backup through `/admin`.

## If you're locked out

```
sudo docker exec -it ancestormap node server/reset-password.js <username> <new-password>
```
