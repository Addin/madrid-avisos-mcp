#!/bin/bash
# Arranca el MCP HTTP de madrid-avisos (uso: launchd o manual).
# Sin secretos dentro: el token se lee de un fichero y el resto va por entorno.
#   MADRID_AVISOS_TOKEN_FILE (defecto: ../madrid-movil-apk/capture/token.txt)
#   MADRID_AVISOS_TOKEN      (tiene prioridad si está definido)
#   MADRID_AVISOS_MCP_SECRET (opcional pero recomendado)
#   MADRID_AVISOS_ALLOWED_HOSTS (p.ej. tu-host.tu-tailnet.ts.net)
set -u
cd "$(dirname "$0")"
if [ -z "${MADRID_AVISOS_TOKEN:-}" ]; then
  TOKEN_FILE="${MADRID_AVISOS_TOKEN_FILE:-../madrid-movil-apk/capture/token.txt}"
  MADRID_AVISOS_TOKEN=$(cat "$TOKEN_FILE")
fi
export MADRID_AVISOS_TOKEN
# NODE_BIN permite fijar el node (launchd trae un PATH mínimo).
exec "${NODE_BIN:-node}" dist/http.js
