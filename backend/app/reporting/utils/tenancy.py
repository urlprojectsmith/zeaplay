from sqlalchemy.orm import Query


def apply_tenant_scope(query: Query, tenant_id: str) -> Query:
    """Apply tenant filtering to a SQLAlchemy query."""
    if not tenant_id:
        raise ValueError("tenant_id is required for reporting queries")
    return query.filter_by(tenant_id=tenant_id)
