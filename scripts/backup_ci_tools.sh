#!/usr/bin/env bash
# CI only (db-backup.yml): put age and a Postgres 18 client on PATH.
#  - age: the pinned release tarball, checked against AGE_SHA256.
#  - pg_dump / pg_restore / psql: thin wrappers running $PG_IMAGE
#    (postgres:18, already pulled for the service container), because the
#    runner's own client is older than Neon's PostgreSQL 18 server and
#    pg_dump refuses to dump a newer server.
set -euo pipefail
: "${RUNNER_TEMP:?CI only}" "${AGE_VERSION:?}" "${AGE_SHA256:?}" "${PG_IMAGE:?}"
bin="$RUNNER_TEMP/bin"
mkdir -p "$bin"

curl -fsSL -o "$RUNNER_TEMP/age.tgz" \
  "https://github.com/FiloSottile/age/releases/download/$AGE_VERSION/age-$AGE_VERSION-linux-amd64.tar.gz"
echo "$AGE_SHA256  $RUNNER_TEMP/age.tgz" | sha256sum -c --quiet -
tar -xzf "$RUNNER_TEMP/age.tgz" -C "$RUNNER_TEMP"
install -m 0755 "$RUNNER_TEMP/age/age" "$bin/age"
rm -rf "$RUNNER_TEMP/age" "$RUNNER_TEMP/age.tgz"

for t in pg_dump pg_restore psql; do
  cat > "$bin/$t" <<EOF
#!/usr/bin/env bash
# $t from $PG_IMAGE; files under \$RUNNER_TEMP are shared.
exec docker run --rm -i --network host -u "\$(id -u):\$(id -g)" \\
  -e PGCONNECT_TIMEOUT=30 -v "$RUNNER_TEMP:$RUNNER_TEMP" -w "$RUNNER_TEMP" \\
  $PG_IMAGE $t "\$@"
EOF
  chmod 0755 "$bin/$t"
done
echo "$bin" >> "$GITHUB_PATH"
export PATH="$bin:$PATH"
age --version
pg_dump --version
