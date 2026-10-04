"""One-time RightDue copy and cutover wrapper; no credentials are embedded.

Run inside the existing Render API service. Restore the normal uvicorn start
command and set DATABASE_URL to the target after the first deploy is live.
The source write lock remains held until that cleanup deploy stops this wrapper.
"""
import asyncio
import hashlib
import json
import os
import signal
import sys

from sqlalchemy import MetaData, inspect, select, text
from api.db.connection import database_engine

TABLES = ('users', 'otp_codes', 'sessions', 'user_state', 'lender_outcomes')

def signature(connection):
    inspector = inspect(connection)
    return {name: [(c['name'], str(c['type']), c['nullable'])
                   for c in inspector.get_columns(name)] for name in TABLES}

def digest(rows):
    encoded = sorted(json.dumps(dict(row), sort_keys=True, default=str,
                                separators=(',', ':')) for row in rows)
    return hashlib.sha256('\n'.join(encoded).encode()).hexdigest()

async def main():
    source_url = os.environ['DATABASE_URL']
    target_url = os.environ['RIGHTDUE_NEON_DATABASE_URL']
    if source_url == target_url:
        raise RuntimeError('Source and destination must differ')
    if os.environ.get('OUTCOMES_DATABASE_URL'):
        raise RuntimeError('A separate outcomes database requires its own migration')
    source = database_engine(source_url)
    target = database_engine(target_url)
    child = None
    try:
        async with source.connect() as src:
            async with src.begin():
                await src.execute(text('SET LOCAL lock_timeout = \'30s\''))
                names = await src.run_sync(lambda c: inspect(c).get_table_names())
                if set(names) != set(TABLES):
                    print('RIGHTDUE MIGRATION: unexpected source table names', sorted(names), flush=True)
                    raise RuntimeError('Unexpected source schema')
                await src.execute(text('LOCK TABLE ' + ', '.join(TABLES) + ' IN SHARE MODE'))
                source_schema = await src.run_sync(signature)
                metadata = MetaData()
                await src.run_sync(lambda c: metadata.reflect(bind=c))
                rows = {name: list((await src.execute(select(metadata.tables[name]))).mappings())
                        for name in TABLES}
                counts = {name: len(value) for name, value in rows.items()}
                print('RIGHTDUE MIGRATION: source counts ' + json.dumps(counts), flush=True)
                async with target.begin() as dst:
                    if await dst.run_sync(signature) != source_schema:
                        raise RuntimeError('Source and target column definitions differ')
                    await dst.execute(text('SELECT pg_advisory_xact_lock(749301528)'))
                    existing = {name: list((await dst.execute(select(metadata.tables[name]))).mappings())
                                for name in TABLES}
                    if any(existing.values()):
                        if any(digest(existing[name]) != digest(rows[name]) for name in TABLES):
                            raise RuntimeError('Nonempty target differs; refusing to overwrite')
                        print('RIGHTDUE MIGRATION: target already matches source', flush=True)
                    else:
                        for name in TABLES:
                            values = [dict(row) for row in rows[name]]
                            for offset in range(0, len(values), 100):
                                await dst.execute(metadata.tables[name].insert(), values[offset:offset+100])
                        for name in TABLES:
                            result = list((await dst.execute(select(metadata.tables[name]))).mappings())
                            if digest(result) != digest(rows[name]):
                                raise RuntimeError('Copy verification failed')
                        await dst.execute(text("SELECT setval(pg_get_serial_sequence('lender_outcomes','id'), "
                                               "COALESCE((SELECT max(id) FROM lender_outcomes),1), "
                                               "EXISTS(SELECT 1 FROM lender_outcomes))"))
                print('RIGHTDUE MIGRATION: all five tables copied and fully verified', flush=True)
                await target.dispose()
                env = dict(os.environ)
                env['DATABASE_URL'] = target_url
                stopped = asyncio.Event()
                loop = asyncio.get_running_loop()
                for sig in (signal.SIGTERM, signal.SIGINT):
                    loop.add_signal_handler(sig, stopped.set)
                child = await asyncio.create_subprocess_exec(
                    sys.executable, '-m', 'uvicorn', 'api.main:app', '--host', '0.0.0.0',
                    '--port', os.environ.get('PORT', '10000'), env=env)
                print('RIGHTDUE MIGRATION: API starting on Neon; source writes held until cleanup deploy', flush=True)
                running = asyncio.create_task(child.wait())
                stop = asyncio.create_task(stopped.wait())
                await asyncio.wait((running, stop), return_when=asyncio.FIRST_COMPLETED)
                if child.returncode is None:
                    child.terminate()
                    try:
                        await asyncio.wait_for(child.wait(), 15)
                    except asyncio.TimeoutError:
                        child.kill()
                        await child.wait()
                stop.cancel()
                # Transaction exits only after the child stops; no source writes occur.
    finally:
        await source.dispose()
        await target.dispose()

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as error:
        print('RIGHTDUE MIGRATION: aborted safely (' + type(error).__name__ + ')', flush=True)
        sys.exit(1)
