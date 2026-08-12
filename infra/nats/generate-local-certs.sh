#!/usr/bin/env bash

set -euo pipefail

# Generates a development-only CA and NATS server certificate.
# Do not use these generated credentials outside local development.
CERT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/certs"
CA_KEY="$CERT_DIR/ca-key.pem"
CA_CERT="$CERT_DIR/ca.pem"
SERVER_KEY="$CERT_DIR/nats-server-key.pem"
SERVER_CSR="$CERT_DIR/nats-server.csr"
SERVER_CERT="$CERT_DIR/nats-server.pem"
EXT_FILE="$CERT_DIR/server.ext"

if [[ -e "$CA_KEY" || -e "$CA_CERT" || -e "$SERVER_KEY" || -e "$SERVER_CERT" ]]; then
  echo "NATS certificates already exist in $CERT_DIR. Remove them deliberately before regenerating."
  exit 1
fi

mkdir -p "$CERT_DIR"

openssl req -x509 -new -nodes -newkey rsa:4096 \
  -keyout "$CA_KEY" \
  -out "$CA_CERT" \
  -days 3650 \
  -subj "/CN=trams-local-nats-ca"

openssl req -new -nodes -newkey rsa:2048 \
  -keyout "$SERVER_KEY" \
  -out "$SERVER_CSR" \
  -subj "/CN=localhost"

printf '%s\n' \
  'subjectAltName=DNS:localhost,DNS:nats,IP:127.0.0.1' \
  'extendedKeyUsage=serverAuth' > "$EXT_FILE"

openssl x509 -req \
  -in "$SERVER_CSR" \
  -CA "$CA_CERT" \
  -CAkey "$CA_KEY" \
  -CAcreateserial \
  -out "$SERVER_CERT" \
  -days 825 \
  -sha256 \
  -extfile "$EXT_FILE"

rm "$SERVER_CSR" "$EXT_FILE" "$CERT_DIR/ca.srl"
chmod 600 "$CA_KEY" "$SERVER_KEY"

echo "Generated local NATS TLS certificates in $CERT_DIR"
