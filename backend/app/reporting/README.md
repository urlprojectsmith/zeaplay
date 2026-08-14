# Reporting Module

This module defines the foundation for the ZeaPlay reporting system. It is intentionally a skeleton: data
models, schemas, APIs, and services are stubbed to establish conventions for multi-tenant reporting.

## Structure
- `models.py`: SQLAlchemy models with `tenant_id` required on every table.
- `schemas.py`: Pydantic schemas used by API routes.
- `api.py`: FastAPI routes (stubs) for reports, templates, visits, notifications.
- `services/`: Service layer (ReportService, TemplateService, VisitService, NotificationService).
- `jobs/`: Job scheduler stubs for reporting tasks.
- `utils/`: Common helpers (idempotency, auditing, tenancy).
- `config.py`: Integration placeholders (email, Webex bot).

## Multi-tenant conventions
- Every table includes `tenant_id` and service methods require it.
- All queries must filter on `tenant_id`.

## Migration hooks
Alembic autogeneration includes these models via `backend/alembic/env.py`.
Create a migration with:
```
cd backend
alembic revision --autogenerate -m "add reporting module tables"
```

## Notes
- This is a scaffold only. Do not rely on production behavior yet.
