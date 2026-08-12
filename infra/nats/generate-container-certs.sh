#!/usr/bin/env sh

set -eu

# An internal Compose volume holds these development-only files. Applications
# receive only ca.pem; the NATS server alone receives the private key.
cert_dir="${NATS_CERT_DIR:-/certs}"
client_ca_dir="${NATS_CLIENT_CA_DIR:-/client-ca}"
ca_key="$cert_dir/ca-key.pem"
ca_cert="$cert_dir/ca.pem"
server_key="$cert_dir/nats-server-key.pem"
server_csr="$cert_dir/nats-server.csr"
server_cert="$cert_dir/nats-server.pem"
ext_file="$cert_dir/server.ext"

if [ -f "$ca_cert" ] && [ -f "$server_cert" ] && [ -f "$server_key" ]; then
  mkdir -p "$client_ca_dir"
  cp "$ca_cert" "$client_ca_dir/ca.pem"
  echo "NATS TLS certificates already exist in $cert_dir"
  exit 0
fi

rm -f "$ca_key" "$ca_cert" "$server_key" "$server_csr" "$server_cert" \
  "$ext_file" "$cert_dir/ca.srl"
mkdir -p "$cert_dir"
mkdir -p "$client_ca_dir"

openssl req -x509 -new -nodes -newkey rsa:4096 \
  -keyout "$ca_key" \
  -out "$ca_cert" \
  -days 3650 \
  -subj "/CN=trams-compose-nats-ca"

openssl req -new -nodes -newkey rsa:2048 \
  -keyout "$server_key" \
  -out "$server_csr" \
  -subj "/CN=nats"

printf '%s\n' \
  'subjectAltName=DNS:nats,DNS:localhost,IP:127.0.0.1' \
  'extendedKeyUsage=serverAuth' > "$ext_file"

openssl x509 -req \
  -in "$server_csr" \
  -CA "$ca_cert" \
  -CAkey "$ca_key" \
  -CAcreateserial \
  -out "$server_cert" \
  -days 825 \
  -sha256 \
  -extfile "$ext_file"

rm -f "$server_csr" "$ext_file" "$cert_dir/ca.srl"
chmod 600 "$ca_key" "$server_key"
cp "$ca_cert" "$client_ca_dir/ca.pem"
echo "Generated NATS TLS certificates in $cert_dir"
