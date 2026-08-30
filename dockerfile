FROM caddy:latest
RUN apk add --no-cache nodejs
COPY ./Caddyfile /etc/caddy/Caddyfile
COPY ./image-proxy.mjs /image-proxy.mjs
COPY ./scripts/image-proxy-handler.mjs /scripts/image-proxy-handler.mjs
COPY ./docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
COPY ./.output/public /dist
ENTRYPOINT ["/docker-entrypoint.sh"]
