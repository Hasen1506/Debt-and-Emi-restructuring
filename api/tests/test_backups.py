"""Backups, round 2 (docs/BACKUPS.md): retention, the manifest check, and the
real scripts end to end against a throwaway local PostgreSQL.

Unit tests always run. The end-to-end tests need PostgreSQL server binaries
(initdb/pg_ctl, found on PATH or under /usr/lib/postgresql/*/bin), age and
git; they skip when those are missing. They use a local bare git repo in
place of the private GitHub repo (BACKUP_REPO_URL) and never touch the
network.
"""
from __future__ import annotations

import datetime as dt
import glob
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))
import backup_manifest as bm  # noqa: E402


def _name(d: dt.datetime) -> str:
    return f"rightdue-{d:%Y-%m-%dT%H%M}Z.dump.age"


# ── retention ─────────────────────────────────────────────────────────────

def test_one_backup_a_night_keeps_14_daily_plus_8_weekly_and_nothing_older_than_8_weeks():
    start = dt.datetime(2026, 6, 1, 20, 40)
    names = []
    for i in range(120):
        names.append(_name(start + dt.timedelta(days=i)))
        kept = bm.keep_names(names)
        assert len(kept) <= 22
    newest = start + dt.timedelta(days=119)
    stamps = sorted(bm.stamp_of(n) for n in kept)
    # Weekly copies count the weeks the dailies already cover (like restic's
    # --keep-daily 14 --keep-weekly 8), so 19-20 files in steady state.
    assert 19 <= len(kept) <= 20
    # the last 14 days are all there
    for i in range(14):
        assert _name(newest - dt.timedelta(days=i)) in kept
    # the oldest copy is within 8 ISO weeks (<= 56 days, the privacy notice's number)
    assert (newest.replace(tzinfo=dt.timezone.utc) - stamps[0]).days <= 56
    # one copy per week beyond the dailies
    weeks = {tuple(s.isocalendar())[:2] for s in stamps}
    assert len(weeks) == 8


def test_two_runs_on_one_day_keep_only_the_newest_of_that_day():
    a = "rightdue-2026-10-15T0300Z.dump.age"
    b = "rightdue-2026-10-15T2040Z.dump.age"
    older = [_name(dt.datetime(2026, 10, 14, 20, 40) - dt.timedelta(days=i)) for i in range(20)]
    kept = bm.keep_names([a, b, *older])
    assert b in kept and a not in kept
    assert kept[0] == b


def test_files_we_did_not_write_are_never_deleted():
    kept = bm.keep_names(["README.md", "notes.txt", "rightdue-2026-10-15T2040Z.dump.age"])
    assert {"README.md", "notes.txt"} <= set(kept)


def test_bad_names_are_rejected():
    with pytest.raises(ValueError):
        bm.stamp_of("rightdue-latest.dump.age")


# ── manifest comparison (what the drill decides on) ───────────────────────

C = {"_alembic": "0005_retention", "tables": {"users": 7, "user_state": 5, "sessions": 7}}


def test_compare_passes_only_on_an_exact_match():
    assert bm.compare(C, json.loads(json.dumps(C))) == []
    assert "row counts differ in: users" in bm.compare(C, {**C, "tables": {**C["tables"], "users": 6}})
    assert "alembic revision differs" in bm.compare(C, {**C, "_alembic": "0004_trust_records"})
    assert any("missing after restore: sessions" in p for p in bm.compare(C, {**C, "tables": {"users": 7, "user_state": 5}}))
    assert any("no table counts" in p for p in bm.compare({"_alembic": "x", "tables": {}}, C))


def test_compare_names_tables_but_never_prints_counts(capsys):
    rc = bm.main(["compare", json.dumps(C), json.dumps({**C, "tables": {**C["tables"], "users": 6}})])
    err = capsys.readouterr().err
    assert rc == 1 and "users" in err and "7" not in err and "6" not in err


# ── the workflow wiring ───────────────────────────────────────────────────

WF = (ROOT / ".github" / "workflows" / "db-backup.yml").read_text()


def test_workflow_stores_in_a_private_github_repo_with_r2_optional():
    assert "bash scripts/backup_preflight.sh\n" in WF and "bash scripts/backup_preflight.sh drill" in WF
    assert "scripts/backup_push_github.sh" in WF and "secrets.BACKUP_REPO_TOKEN" in WF
    assert "steps.cfg.outputs.r2 == 'true'" in WF  # R2 only when configured
    assert WF.count("image: postgres:18") == 2 and "PG_IMAGE: postgres:18" in WF
    assert "uses: ./.github/actions/failure-issue" in WF and WF.count("if: failure()") == 2
    assert "issues: write" in WF and "contents: read" in WF


def test_workflow_has_a_weekly_drill_and_a_nightly_backup():
    crons = re.findall(r'cron: "([^"]+)"', WF)
    assert crons == ["40 20 * * *", "10 23 * * 0"]
    assert "github.event.schedule == '40 20 * * *'" in WF and "github.event.schedule == '10 23 * * 0'" in WF
    assert "secrets.BACKUP_AGE_IDENTITY" in WF.split("  drill:", 1)[1]
    assert "BACKUP_AGE_IDENTITY" not in WF.split("  drill:", 1)[0].split("jobs:", 1)[1]  # never in the backup job


def test_push_script_rewrites_history_and_verifies():
    src = (SCRIPTS / "backup_push_github.sh").read_text()
    assert "--force-with-lease" in src and "git init" in src and "read-tree" in src
    assert "is PUBLIC" in src  # refuses a public target


# ── end to end against a local PostgreSQL ─────────────────────────────────

def _pg_bin() -> Path | None:
    if shutil.which("initdb") and shutil.which("pg_ctl"):
        return Path(shutil.which("initdb")).parent
    found = sorted(glob.glob("/usr/lib/postgresql/*/bin/initdb"))
    return Path(found[-1]).parent if found else None


PG_BIN = _pg_bin()
AGE = shutil.which("age") or os.environ.get("AGE_BIN")
needs_tools = pytest.mark.skipif(not (PG_BIN and AGE and shutil.which("git")),
                                 reason="needs PostgreSQL server binaries, age and git")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _neon_sql_from_docs() -> str:
    doc = (ROOT / "docs" / "BACKUPS.md").read_text()
    block = re.search(r"```sql\n(-- rightdue_backup: read-only role.*?)```", doc, re.S)
    assert block, "docs/BACKUPS.md lost its read-only role SQL block"
    return block.group(1)


SCHEMA = """
CREATE TABLE alembic_version (version_num varchar(32) PRIMARY KEY);
INSERT INTO alembic_version VALUES ('0005_retention');
CREATE TABLE users (id uuid PRIMARY KEY, email varchar(320) NOT NULL UNIQUE);
CREATE TABLE user_state (user_id uuid PRIMARY KEY REFERENCES users(id), data jsonb NOT NULL);
CREATE TABLE sessions (token varchar(128) PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id));
CREATE TABLE consent_events (id uuid PRIMARY KEY, email varchar(320) NOT NULL);
CREATE TABLE notify_events (id serial PRIMARY KEY, kind varchar(16) NOT NULL);
"""
SEED = """
INSERT INTO users SELECT gen_random_uuid(), 'u' || g || '@x.test' FROM generate_series(1, 7) g;
INSERT INTO user_state SELECT id, '{"debts": [1, 2]}' FROM users LIMIT 5;
INSERT INTO sessions SELECT md5(random()::text), id FROM users;
INSERT INTO notify_events (kind) SELECT 'payday' FROM generate_series(1, 3);
"""
PASSWORD = "c0ffee" * 8


@pytest.fixture(scope="module")
def pg(tmp_path_factory):
    if not (PG_BIN and AGE and shutil.which("git")):
        pytest.skip("needs PostgreSQL server binaries, age and git")
    base = tmp_path_factory.mktemp("pg")
    port = _free_port()
    env = {**os.environ, "PATH": f"{PG_BIN}:{Path(AGE).parent}:{os.environ['PATH']}"}
    subprocess.run([PG_BIN / "initdb", "-D", base / "data", "-U", "postgres", "-A", "trust"], check=True, capture_output=True, env=env)
    subprocess.run([PG_BIN / "pg_ctl", "-D", base / "data", "-l", base / "log", "-w", "start",
                    "-o", f"-p {port} -k {base} -c listen_addresses=localhost"], check=True, capture_output=True, env=env)
    su = f"postgresql://postgres@localhost:{port}/postgres"

    def psql(url, sql):
        subprocess.run(["psql", url, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-c", sql], check=True, capture_output=True, env=env)

    psql(su, "CREATE ROLE app_owner LOGIN CREATEROLE PASSWORD 'ownerpw'")
    psql(su, "CREATE DATABASE rightdue OWNER app_owner")
    psql(su, "CREATE DATABASE throwaway")
    psql(su, "CREATE DATABASE emptyprod OWNER app_owner")
    owner = f"postgresql://app_owner:ownerpw@localhost:{port}/rightdue"
    psql(f"postgresql://postgres@localhost:{port}/rightdue", "ALTER SCHEMA public OWNER TO app_owner")
    psql(owner, SCHEMA)
    psql(owner, SEED)
    # The exact SQL from docs/BACKUPS.md §3a, run as the table owner.
    psql(owner, _neon_sql_from_docs().replace("<OWNER>", "app_owner").replace("<PASSWORD>", PASSWORD))
    psql(f"postgresql://app_owner:ownerpw@localhost:{port}/emptyprod", SCHEMA)
    psql(f"postgresql://app_owner:ownerpw@localhost:{port}/emptyprod",
         "GRANT CONNECT ON DATABASE emptyprod TO rightdue_backup; GRANT SELECT ON ALL TABLES IN SCHEMA public TO rightdue_backup;"
         "GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO rightdue_backup;")

    keyfile = base / "key.txt"
    keygen = Path(AGE).with_name("age-keygen")
    out = subprocess.run([keygen, "-o", keyfile], check=True, capture_output=True, text=True)
    recipient = re.search(r"age1[0-9a-z]+", out.stderr + out.stdout).group(0)
    remote = base / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", remote], check=True)
    yield {
        "env": env, "port": port, "base": base, "keyfile": keyfile, "recipient": recipient, "remote": remote,
        "backup_url": f"postgresql://rightdue_backup:{PASSWORD}@localhost:{port}/rightdue",
        "restore_url": f"postgresql://postgres@localhost:{port}/throwaway",
        "owner_url": owner, "psql": psql,
    }
    subprocess.run([PG_BIN / "pg_ctl", "-D", base / "data", "-m", "immediate", "stop"], capture_output=True, env=env)


def _run(pg, script, *args, **extra):
    env = {**pg["env"], "BACKUP_REPO_URL": str(pg["remote"]), "BACKUP_REPO_TOKEN": "",
           "RESTORE_URL": pg["restore_url"], **{k: str(v) for k, v in extra.items()}}
    for k in ("GITHUB_OUTPUT", "BACKUP_ALLOW_EMPTY"):
        if k not in extra:
            env.pop(k, None)
    return subprocess.run(["bash", str(SCRIPTS / script), *map(str, args)], env=env, capture_output=True, text=True, timeout=120)


def _backup(pg, stamp, url=None, **extra):
    work = pg["base"] / f"w-{stamp}"
    p = _run(pg, "backup_dump.sh", DATABASE_URL=url or pg["backup_url"], AGE_RECIPIENT=pg["recipient"],
             WORK_DIR=work, STAMP=stamp, **extra)
    if p.returncode:
        return p, None
    f = p.stdout.strip()
    q = _run(pg, "backup_push_github.sh", f, work / "entry.json")
    return q, f


def _git(pg, *args, remote=None):
    return subprocess.run(["git", "--git-dir", str(remote or pg["remote"]), *args], check=True, capture_output=True, text=True).stdout


def _stamp(hours_ago: float) -> str:
    return (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=hours_ago)).strftime("%Y-%m-%dT%H%MZ")


@needs_tools
def test_the_docs_read_only_role_can_dump_but_not_write(pg):
    p = subprocess.run(["psql", pg["backup_url"], "-X", "-tAc", "INSERT INTO users VALUES (gen_random_uuid(), 'x@y')"],
                       capture_output=True, text=True, env=pg["env"])
    assert p.returncode != 0 and ("read-only" in p.stderr or "permission denied" in p.stderr)
    # a table a later migration adds is readable too (ALTER DEFAULT PRIVILEGES)
    pg["psql"](pg["owner_url"], "CREATE TABLE later_tbl (id serial PRIMARY KEY); INSERT INTO later_tbl DEFAULT VALUES;")
    try:
        p = subprocess.run(["psql", pg["backup_url"], "-X", "-tAc", "SELECT count(*) FROM later_tbl"],
                           capture_output=True, text=True, env=pg["env"])
        assert p.returncode == 0 and p.stdout.strip() == "1", p.stderr
    finally:
        pg["psql"](pg["owner_url"], "DROP TABLE later_tbl")


@needs_tools
def test_nightly_backup_then_drill_passes_and_logs_hold_no_counts(pg):
    p, f = _backup(pg, _stamp(3))
    assert p.returncode == 0, p.stderr
    assert "Stored rightdue-" in p.stderr
    tree = _git(pg, "ls-tree", "-r", "--name-only", "main").split()
    assert "MANIFEST.json" in tree and f"dumps/{Path(f).name}" in tree
    assert _git(pg, "rev-list", "--count", "main").strip() == "1"
    m = json.loads(_git(pg, "show", "main:MANIFEST.json"))
    e = m["backups"][0]
    assert e["counts"]["tables"]["users"] == 7 and e["counts"]["tables"]["user_state"] == 5
    assert e["counts"]["_alembic"] == "0005_retention" and len(e["sha256"]) == 64
    blob = subprocess.run(["git", "--git-dir", str(pg["remote"]), "show", f"main:dumps/{Path(f).name}"],
                          check=True, capture_output=True).stdout
    assert blob.startswith(b"age-encryption.org/v1") and b"u1@x.test" not in blob
    assert not Path(f).with_name("rightdue.dump").exists()  # plaintext removed

    d = _run(pg, "backup_drill.sh", AGE_IDENTITY=pg["keyfile"].read_text())
    assert d.returncode == 0, d.stderr
    assert "Restore drill passed" in d.stdout
    for log in (p.stdout + p.stderr, d.stdout + d.stderr):  # public logs: no data, no counts
        assert '"tables"' not in log and "@x.test" not in log


@needs_tools
def test_drill_fails_loudly_on_a_wrong_count_a_stale_copy_a_bad_file_or_a_wrong_key(pg):
    p, _ = _backup(pg, _stamp(2))
    assert p.returncode == 0, p.stderr
    ident = pg["keyfile"].read_text()

    # stale: the newest copy is older than the limit
    d = _run(pg, "backup_drill.sh", AGE_IDENTITY=ident, DRILL_MAX_AGE_HOURS=1)
    assert d.returncode == 1 and "hours old" in d.stderr

    # wrong key
    other = subprocess.run([Path(AGE).with_name("age-keygen")], capture_output=True, text=True).stdout
    d = _run(pg, "backup_drill.sh", AGE_IDENTITY=other)
    assert d.returncode == 1 and "does not decrypt" in d.stderr

    # tamper with the repo: change a count, then the file
    clone = pg["base"] / "tamper"
    shutil.rmtree(clone, ignore_errors=True)
    subprocess.run(["git", "clone", "-q", str(pg["remote"]), str(clone)], check=True)
    m = json.loads((clone / "MANIFEST.json").read_text())
    m["backups"][0]["counts"]["tables"]["users"] += 1
    (clone / "MANIFEST.json").write_text(json.dumps(m))
    g = ["git", "-C", str(clone), "-c", "user.name=t", "-c", "user.email=t@t"]
    subprocess.run([*g, "commit", "-qam", "tamper"], check=True)
    subprocess.run([*g, "push", "-q", "origin", "main"], check=True)
    d = _run(pg, "backup_drill.sh", AGE_IDENTITY=ident)
    assert d.returncode == 1 and "row counts differ in: users" in d.stderr

    f = clone / "dumps" / m["backups"][0]["file"]
    f.write_bytes(f.read_bytes() + b"x")
    subprocess.run([*g, "commit", "-qam", "corrupt"], check=True)
    subprocess.run([*g, "push", "-q", "origin", "main"], check=True)
    d = _run(pg, "backup_drill.sh", AGE_IDENTITY=ident)
    assert d.returncode == 1 and "sha256" in d.stderr

    # the next nightly repairs it (fresh orphan commit, tampered history gone)
    p, _ = _backup(pg, _stamp(1))
    assert p.returncode == 0, p.stderr
    assert _git(pg, "rev-list", "--count", "main").strip() == "1"


@needs_tools
def test_retention_through_the_real_push_keeps_one_commit_and_the_right_files(pg):
    work = pg["base"] / "fake"
    work.mkdir(exist_ok=True)
    remote = pg["base"] / "retention.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", remote], check=True)
    start = dt.datetime(2026, 6, 1, 20, 40)
    names = []
    for i in range(70):
        n = _name(start + dt.timedelta(days=i))
        names.append(n)
        f = work / n
        f.write_bytes(b"age-encryption.org/v1\n" + os.urandom(64))
        (work / "entry.json").write_text(json.dumps({"file": n, "stamp": n[9:25], "bytes": 86, "sha256": "0" * 64,
                                                     "counts": {"_alembic": "x", "tables": {"users": 1}}}))
        p = _run(pg, "backup_push_github.sh", f, work / "entry.json", BACKUP_REPO_URL=remote)
        assert p.returncode == 0, p.stderr
        f.unlink()
    files = sorted(x.split("/", 1)[1] for x in _git(pg, "ls-tree", "-r", "--name-only", "main", remote=remote).split() if x.startswith("dumps/"))
    assert files == sorted(bm.keep_names(names)) and 19 <= len(files) <= 20
    assert _git(pg, "rev-list", "--count", "main", remote=remote).strip() == "1"
    m = json.loads(_git(pg, "show", "main:MANIFEST.json", remote=remote))
    assert sorted(b["file"] for b in m["backups"]) == files and m["unlisted"] == []


@needs_tools
def test_backup_fails_when_production_looks_empty_unless_allowed(pg):
    url = pg["backup_url"].rsplit("/", 1)[0] + "/emptyprod"
    work = pg["base"] / "w-empty"
    p = _run(pg, "backup_dump.sh", DATABASE_URL=url, AGE_RECIPIENT=pg["recipient"], WORK_DIR=work)
    assert p.returncode == 1 and "users table is empty" in p.stderr
    assert not list(work.glob("*.age"))
    p = _run(pg, "backup_dump.sh", DATABASE_URL=url, AGE_RECIPIENT=pg["recipient"], WORK_DIR=work, BACKUP_ALLOW_EMPTY=1)
    assert p.returncode == 0, p.stderr


@needs_tools
def test_the_restore_target_must_be_local(pg):
    p = _run(pg, "backup_dump.sh", DATABASE_URL=pg["backup_url"], AGE_RECIPIENT=pg["recipient"],
             WORK_DIR=pg["base"] / "w-remote", RESTORE_URL="postgresql://u:p@ep-prod.ap-southeast-1.aws.neon.tech/rightdue")
    assert p.returncode == 1 and "throwaway local Postgres" in p.stderr


@needs_tools
def test_manual_restore_script_restores_from_a_clone_and_checks_counts(pg):
    p, _ = _backup(pg, _stamp(0.5))
    assert p.returncode == 0, p.stderr
    clone = pg["base"] / "clone-for-restore"
    shutil.rmtree(clone, ignore_errors=True)
    subprocess.run(["git", "clone", "-q", str(pg["remote"]), str(clone)], check=True)
    target = pg["restore_url"]
    pg["psql"](target, "DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    r = _run(pg, "restore_drill.sh", BACKUP_DIR=clone, AGE_KEY_FILE=pg["keyfile"], TARGET_DATABASE_URL=target,
             RESTORE_DRILL_YES="throwaway", PRODUCTION_DATABASE_HOST="ep-prod.example")
    assert r.returncode == 0, r.stderr
    assert "matches the manifest" in r.stderr
    r = _run(pg, "restore_drill.sh", BACKUP_DIR=clone, AGE_KEY_FILE=pg["keyfile"],
             TARGET_DATABASE_URL="postgresql://u:p@ep-prod.example/rightdue", PRODUCTION_DATABASE_HOST="ep-prod.example")
    assert r.returncode == 1 and "points at production" in r.stderr
