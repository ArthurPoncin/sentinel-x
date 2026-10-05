# Command Post API. Built on the Pi (arm64) or anywhere else: nothing native to compile.
#   docker build -t sentinel-x/api backend/
#   docker run --env-file backend/.env -e HOST=0.0.0.0 -v api-data:/data sentinel-x/api

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    HISTORY_FILE=/data/history.sqlite
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# The history lives on a volume, owned by the unprivileged user the API runs as.
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8080
# Unhealthy while a broker is set but out of reach: see GET /health in README.md.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# node itself, not npm: it gets the SIGTERM of `docker compose stop` and shuts down cleanly.
CMD ["node", "dist/main.js"]
