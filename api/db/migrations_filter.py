"""What Alembic manages: the account tables in api/db/models.py only.

Tables in the same database that no model declares (the outcomes store's
lender_outcomes when it shares a database, alembic_version) are left alone,
so autogenerate never proposes dropping them.
"""


def include_object(obj, name, type_, reflected, compare_to):
    if type_ == "table" and reflected and compare_to is None:
        return False
    if type_ in ("index", "column", "unique_constraint", "foreign_key_constraint") and reflected and compare_to is None:
        table = getattr(obj, "table", None)
        from api.db.database import Base
        return table is None or table.name in Base.metadata.tables
    return True
