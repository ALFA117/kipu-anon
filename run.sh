#!/bin/sh
# Levanta el servicio en http://localhost:${PORT:-9000}/v1
set -e
cd "$(dirname "$0")"
[ -d node_modules ] || npm install --no-fund --no-audit
exec node src/main.js
