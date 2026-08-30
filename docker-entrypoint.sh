#!/bin/sh
set -e

node /image-proxy.mjs &
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
