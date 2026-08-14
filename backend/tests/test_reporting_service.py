import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.database import Base
import backend.app.reporting.models  # noqa: F401
from backend.app.reporting import schemas as reporting_schemas
from backend.app.reporting.services.report_service import ReportService


SQLALCHEMY_DATABASE_URL = "sqlite:///./test_reporting_service.db"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)


def _new_session():
    return TestingSessionLocal()


def test_start_day_prevents_duplicates():
    db = _new_session()
    try:
        service = ReportService(db)
        tenant_id = str(uuid.uuid4())
        employee_id = str(uuid.uuid4())
        report_date = date.today() - timedelta(days=1)

    session = service.start_day(
        tenant_id=tenant_id,
        employee_id=employee_id,
        manager_id=None,
        department_id=None,
        report_date=report_date,
    )
        assert session.employee_id == employee_id

        with pytest.raises(ValueError):
            service.start_day(
                tenant_id=tenant_id,
                employee_id=employee_id,
                manager_id=None,
                department_id=None,
                report_date=report_date,
            )
    finally:
        db.close()


def test_hourly_submit_and_duplicate():
    db = _new_session()
    try:
        service = ReportService(db)
        tenant_id = str(uuid.uuid4())
        employee_id = str(uuid.uuid4())
        report_date = date.today() - timedelta(days=1)

        session = service.start_day(
            tenant_id=tenant_id,
            employee_id=employee_id,
            manager_id=None,
            department_id=None,
            report_date=report_date,
        )

        slot = service.submit_hourly(
            tenant_id=tenant_id,
            employee_id=employee_id,
            session_id=session.id,
            slot_hour=9,
            payload={"work": "check-in"},
            idempotency_key=None,
        )
        assert slot.status == "submitted"

        with pytest.raises(ValueError):
            service.submit_hourly(
                tenant_id=tenant_id,
                employee_id=employee_id,
                session_id=session.id,
                slot_hour=9,
                payload={"work": "duplicate"},
                idempotency_key=None,
            )
    finally:
        db.close()


def test_submit_report_idempotent_guard():
    db = _new_session()
    try:
        service = ReportService(db)
        tenant_id = str(uuid.uuid4())
        employee_id = str(uuid.uuid4())
        report_date = date.today() - timedelta(days=1)

        session = service.start_day(
            tenant_id=tenant_id,
            employee_id=employee_id,
            manager_id=None,
            department_id=None,
            report_date=report_date,
        )

        payload = reporting_schemas.DailyReportCreate(
            session_id=session.id,
            template_id=None,
            manager_id=None,
            department_id=None,
            report_date=report_date,
            payload={"summary": "done"},
        )

        report = service.submit_report(
            tenant_id=tenant_id,
            employee_id=employee_id,
            payload=payload,
            idempotency_key="abc-123",
        )
        assert report.status == "submitted"

        report_repeat = service.submit_report(
            tenant_id=tenant_id,
            employee_id=employee_id,
            payload=payload,
            idempotency_key="abc-123",
        )
        assert report_repeat.id == report.id
    finally:
        db.close()
