#!/bin/bash
# Generate a local development certificate for the bmcshell server.
#
# The keystore bundled in the bmcshell jar expired on 2025-06-11. This creates:
#   <dir>/keystore.p12      PKCS12 keystore for the server (password: q1, matches application.properties)
#   <dir>/server-cert.pem   certificate for the extension (bmcshellProfile.journal.caCertPath)
# The certificate is valid for localhost and 127.0.0.1 only. For local development use.
#
# Usage: scripts/make-dev-cert.sh [dir]     (default: ~/.bmcshell/tls)

set -euo pipefail

DIR="${1:-$HOME/.bmcshell/tls}"
STORE_PASS="q1"
DAYS=365

command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 1; }

umask 077
mkdir -p "$DIR"

openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$DIR/server-key.pem" -out "$DIR/server-cert.pem" \
    -days "$DAYS" -subj "/CN=localhost/O=bmcshell-dev" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,digitalSignature,keyEncipherment,keyCertSign" \
    -addext "extendedKeyUsage=serverAuth" 2>/dev/null

openssl pkcs12 -export -name 1 \
    -inkey "$DIR/server-key.pem" -in "$DIR/server-cert.pem" \
    -out "$DIR/keystore.p12" -passout "pass:$STORE_PASS"

rm -f "$DIR/server-key.pem"

echo "Created in $DIR:"
echo "  keystore.p12     -> add to bmcshellProfile.jvmArgs:  -Dserver.ssl.key-store=file:$DIR/keystore.p12"
echo "  server-cert.pem  -> set bmcshellProfile.journal.caCertPath to: $DIR/server-cert.pem"
