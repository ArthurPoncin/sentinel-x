# reverse-proxy: Caddy with the Command Post's routes, unprivileged.
FROM caddy:2-alpine
# A plain copy drops the file capability the image gives caddy to bind low ports: it runs
# unprivileged with every capability dropped, on 8443 (published as 443).
RUN cp /usr/bin/caddy /usr/bin/caddy.plain && mv /usr/bin/caddy.plain /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
USER 65534:65534
EXPOSE 8443
