# Ancestor Map — no npm install, no build step. Node 22's built-in SQLite does the work.
FROM node:22-alpine

# 568 is the `apps` user TrueNAS SCALE uses for app datasets, so a bind-mounted
# /data ends up with sane ownership out of the box. Override for other hosts.
ARG UID=568
ARG GID=568
RUN addgroup -g ${GID} -S app 2>/dev/null || true \
 && adduser -u ${UID} -G app -S -D app 2>/dev/null || true

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
# So `node tools/seed-demo.mjs` works in a running container, next to the
# button that does the same thing in /admin.
COPY tools/seed-demo.mjs ./tools/seed-demo.mjs

# Stamped by the workflow so the running app can say which build it is. Without
# it — a local `docker build` — the app just says "dev", which is the truth.
ARG COMMIT=dev
ARG BUILT_AT=

ENV NODE_ENV=production \
    PORT=4322 \
    DATA_DIR=/data \
    NODE_NO_WARNINGS=1 \
    APP_COMMIT=${COMMIT} \
    APP_BUILT_AT=${BUILT_AT}

RUN mkdir -p /data && chown -R ${UID}:${GID} /data /app
USER ${UID}:${GID}

VOLUME /data
EXPOSE 4322

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4322)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
