# The dashboard (Operator screen + Digital Twin), built and served by Caddy on :8080.
# Built from the repo root, for the contract it imports from backend/src/contract.ts:
#   docker build -f dashboard/Dockerfile -t sentinel-x/dashboard .

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY backend/src/contract.ts backend/src/contract.ts
COPY dashboard/package.json dashboard/package-lock.json dashboard/
RUN cd dashboard && npm ci
COPY dashboard/ dashboard/
RUN cd dashboard && npm run build

FROM caddy:2-alpine
# A plain copy drops the file capability the image gives caddy to bind low ports: it runs
# unprivileged with every capability dropped, on 8080.
RUN cp /usr/bin/caddy /usr/bin/caddy.plain && mv /usr/bin/caddy.plain /usr/bin/caddy
COPY dashboard/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dashboard/dist /srv
USER 65534:65534
EXPOSE 8080
