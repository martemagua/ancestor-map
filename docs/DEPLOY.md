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

1. **Dataset**: Storage → your pool → *Add Dataset* → `ancestormap-test`
   (and later `ancestormap`). Then fix its permissions — this is the step
   that fails the deploy if it is skipped, because the container runs as an
   unprivileged user and a fresh dataset belongs to root.

   The shortest reliable way is the shell, because it names the ids
   numerically and cannot be misread:

   ```bash
   sudo chown -R 568:3000 /mnt/POOL/ancestormap-test
   sudo chmod -R 770 /mnt/POOL/ancestormap-test
   ```

   Those two numbers must be the same pair as the `user:` line in the
   compose file — `568` is TrueNAS's `apps` user, `3000` here is an
   `apps-data` group. Check yours with `id apps` and `getent group
   apps-data`.

   Through the UI instead: Datasets → the dataset → *Permissions* → **Edit**.
   TrueNAS shows one of two editors depending on how the dataset was
   created, and they look nothing alike:

   - **POSIX** — rows called *User Obj*, *Group Obj*, *Other*. Set Owner
     `apps`, Owner Group `apps-data`, tick *Apply Owner* and *Apply Group*,
     give **User Obj** and **Group Obj** all of Read/Write/Execute, then
     *Save Access Control List*.
   - **NFSv4** — rows called `owner@`, `group@`, `builtin_users`. Give
     `owner@` Full Control and `group@` Modify, same Apply Owner/Group
     ticks, then save.

   Either way the change only takes effect when you press **Save Access
   Control List** — the tick boxes alone do nothing. If the app still
   cannot write, its log now says so in one sentence, naming the uid/gid it
   is actually running as.
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

**TrueNAS greys out the *Update* button for apps installed via YAML.** It
only lights up when an app's *definition* changes, and `:dev` is the same
string today as yesterday even though it points at a new image. So the
update is a restart, and `pull_policy: always` in the compose files is what
makes that restart fetch anything:

> Apps → the app → **Stop**, then **Start**.

Check what you got — the running build is at the bottom of the settings
sheet in the app, and `/healthz` answers with it:

```
curl -s http://NAS-IP:4323/healthz
{"ok":true,"uptime":3,"version":"0.1.0","commit":"73a025c",...}
```

That `commit` is the short SHA of the commit the image was built from, so it
tells you exactly which version is running.

If a restart ever seems not to update, pull by hand and start again:

```bash
sudo docker pull ghcr.io/martemagua/ancestor-map:dev
```

Browsers need nothing: static files are served `no-cache` with an ETag, so
every open tab runs the new version on its next load.

**Wait for the build.** Pushing to `dev` starts a container build that takes
a couple of minutes; restarting the app before it finishes just re-pulls the
previous image. The repo's *Actions* tab shows when it is done.

### Pinning an exact version

Every build is also tagged with its commit (`sha-73a025c`) and every release
tag (`v0.1.0`) becomes an image tag. Putting one of those in `image:`
instead of `:dev` / `:latest` makes the instance immovable until you edit
the YAML — which is what you want if a restart must never change anything.

## HTTPS

The container serves **plain HTTP** and nothing else — `https://NAS-IP:4323`
will always fail, because there is no TLS inside it. That is deliberate:
certificates belong to whatever sits in front, not to the app.

On the LAN, `http://NAS-IP:4323` is the address. For HTTPS — which you want
for anything reachable beyond the LAN, and which the phone needs before it
will install the app to the home screen — put one of these in front:

- **Tailscale** (simplest, no certificates to manage, no ports opened):
  `tailscale serve --bg --https=443 http://localhost:4323`
  → reachable at `https://your-nas.your-tailnet.ts.net` from any device on
  your tailnet.
- **A reverse proxy** — Caddy gets a Let's Encrypt certificate on its own;
  nginx or Traefik work as well. TrueNAS also ships reverse-proxy apps.

Whatever you use, set `TRUST_PROXY: "1"` in the compose environment so the
login rate limiting sees real client addresses instead of the proxy's.

## Backups

Everything lives in the dataset you mounted on `/data`: the SQLite file plus
nightly self-backups (JSON + a consistent `.db` copy, pruned to
`BACKUP_KEEP`). Snapshot that dataset with ZFS and you have the whole story.
A restore is: point a fresh instance at the dataset — or import a JSON
backup through `/admin`.

## When the app won't start

Always read the log first — Apps → the app → *Logs*, or in a shell:

```
sudo docker logs ancestormap-test --tail 40
```

Three things it is almost always saying:

| In the log | What it means |
|---|---|
| `The data directory /data is not writable…` | The dataset's permissions — see step 1 above. The line names the uid/gid the container runs as, which must match the dataset's owner/group. |
| `denied` / `unauthorized` while pulling | The GHCR package is private. Make it public (Profile → Packages → *ancestor-map* → Package settings → Change visibility), or `docker login ghcr.io -u <you>` on the NAS with a `read:packages` token. |
| `manifest unknown` | That tag has not been built yet. Check the branch's run under the repo's *Actions* tab, then update the app again. |

Package visibility is separate from repository visibility: a public repo can
still have a private package, and a private repo's package can be shared.
The *Packages* page on your profile is where each one is set.

## If you're locked out

```
sudo docker exec -it ancestormap node server/reset-password.js <username> <new-password>
```
