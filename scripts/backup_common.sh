# shellcheck shell=bash
# Shared helpers for the backup scripts (sourced, not run). docs/BACKUPS.md.
#
# Needs on PATH: pg_dump, pg_restore, psql (same major as the server or newer: 18 for Neon), age,
# git, python3, sha256sum. In CI the Postgres tools are thin wrappers that
# run the postgres:18 image (scripts/backup_ci_tools.sh).
#
# Nothing here prints row counts or data: this repo is public and so are its
# Actions logs. Counts go only into the PRIVATE backup repo's MANIFEST.json.

# Tables that must exist (and, for users, must not be empty) in every backup.
KEY_TABLES="${KEY_TABLES:-alembic_version users user_state sessions consent_events}"

err() { echo "::error::$*" >&2; }
note() { echo "$*" >&2; }

# Exit with a GitHub error annotation.
die() { err "$*"; exit 1; }

# One JSON object of every public base table's exact row count, plus the
# alembic revision under "_alembic". One query, no data.
db_counts_json() {
  local url="$1"
  psql "$url" -v ON_ERROR_STOP=1 -X -q -tA -c "
    SELECT json_build_object(
      '_alembic', (SELECT string_agg(version_num, ',') FROM alembic_version),
      'tables', COALESCE((
        SELECT json_object_agg(table_name, n ORDER BY table_name) FROM (
          SELECT table_name,
                 (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text::bigint AS n
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ) t), '{}'::json))"
}

# Empty a THROWAWAY database (drop and recreate schema public). Refuses any
# URL whose host is not localhost/127.0.0.1/a docker service name given in
# RESTORE_HOSTS_ALLOWED, so it can never be pointed at Neon.
reset_throwaway_db() {
  local url="$1" host
  host=$(printf '%s' "$url" | sed -E 's#^[a-z]+://([^@]*@)?\[?([^]/:?]+)\]?.*#\2#')
  case " localhost 127.0.0.1 ::1 ${RESTORE_HOSTS_ALLOWED:-} " in
    *" $host "*) ;;
    *) die "Refusing to wipe '$host': the restore target must be a throwaway local Postgres (localhost)." ;;
  esac
  psql "$url" -v ON_ERROR_STOP=1 -X -q -c "SET client_min_messages = warning; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;" >/dev/null
}

# pg_restore into a throwaway db. Neon-only roles/extensions may warn, so a
# non-zero exit is reported but not fatal: the count checks decide.
restore_into() {
  local dump="$1" url="$2" log rc=0
  log="$(dirname "$dump")/pg_restore.log"
  pg_restore --no-owner --no-privileges --dbname "$url" "$dump" 2>"$log" || rc=$?
  if [ "$rc" -ne 0 ]; then
    note "pg_restore exited $rc with $(grep -c 'error:' "$log" || true) error line(s); first lines:"
    # Error text names objects (tables, roles), never row data.
    grep 'error:' "$log" | head -5 >&2 || true
  fi
  rm -f "$log"
}

# Check a counts JSON (from db_counts_json) has every key table, an alembic
# revision and at least one user (unless BACKUP_ALLOW_EMPTY=1).
check_key_tables() {
  KEY_TABLES="$KEY_TABLES" python3 - "$1" <<'PY'
import json, os, sys
c = json.loads(sys.argv[1])
tables = c.get("tables") or {}
missing = [t for t in os.environ.get("KEY_TABLES", "").split() if t not in tables]
problems = []
if missing:
    problems.append("missing tables: " + ", ".join(missing))
if not c.get("_alembic"):
    problems.append("no alembic_version row")
if tables.get("users", 0) == 0 and os.environ.get("BACKUP_ALLOW_EMPTY") != "1":
    problems.append("the users table is empty (set repo variable BACKUP_ALLOW_EMPTY=1 only if production really has no users)")
if problems:
    print("::error::Restored copy is not a usable backup: " + "; ".join(problems), file=sys.stderr)
    sys.exit(1)
print(f"Key tables present ({len(tables)} tables in all), alembic {c['_alembic']}.", file=sys.stderr)
PY
}

# Git auth for the private backup repo without putting the token in a URL
# or in .git/config: an Authorization header passed per command.
backup_git() {
  if [ -n "${BACKUP_REPO_TOKEN:-}" ]; then
    local basic
    basic=$(printf 'x-access-token:%s' "$BACKUP_REPO_TOKEN" | base64 | tr -d '\n')
    git -c "http.extraheader=AUTHORIZATION: basic $basic" "$@"
  else
    git "$@"
  fi
}

backup_repo_url() {
  if [ -n "${BACKUP_REPO_URL:-}" ]; then printf '%s' "$BACKUP_REPO_URL"; return; fi
  [ -n "${BACKUP_REPO:-}" ] || die "BACKUP_REPO (owner/name) is not set."
  printf 'https://github.com/%s.git' "$BACKUP_REPO"
}
