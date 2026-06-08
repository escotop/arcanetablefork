FROM caddy:latest
COPY ./Caddyfile /etc/caddy/Caddyfile
COPY ./.output/public /dist
