import uuid
from datetime import date, datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.database import Base
import backend.app.reporting.models  # noqa: F401
from backend.app.reporting.jobs.logic import ReportingJobConfig, run_hourly_slot_enforcement, run_eod_nudge
from backend.app.reporting import models


SQLALCHEMY_DATABASE_URL = "sqlite:///./test_reporting_jobs.db"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)


def _new_session():
    return TestingSessionLocal()


def test_hourly_reminder_and_miss_flow():
    db = _new_session()
    try:
        tenant_id = str(uuid.uuid4())
        session = models.EmployeeDaySession(
            tenant_id=tenant_id,
            employee_id=str(uuid.uuid4()),
            manager_id=None,
            department_id=None,
            report_date=date.today(),
            status="open",
            metadata_payload={},
        )
        db.add(session)
        db.commit()
        slot = models.HourlyReportSlot(
            tenant_id=tenant_id,
            session_id=session.id,
            slot_hour=0,
            status="pending",
            reminder_state="idle",
            payload={},
        )
        db.add(slot)
        db.commit()

        config = ReportingJobConfig(hourly_reminder_minutes=1, hourly_miss_minutes=2)
        now = datetime.combine(date.today(), datetime.min.time()) + timedelta(minutes=3)
        result = run_hourly_slot_enforcement(db, now, config)
        assert result["reminders"] == 1
        assert result["missed"] == 1
    finally:
        db.close()


def test_eod_nudge_only_after_threshold():
    db = _new_session()
    try:
        tenant_id = str(uuid.uuid4())
        session = models.EmployeeDaySession(
            tenant_id=tenant_id,
            employee_id=str(uuid.uuid4()),
            manager_id=None,
            department_id=None,
            report_date=date.today(),
            status="open",
            metadata_payload={},
        )
        db.add(session)
        db.commit()

        config = ReportingJobConfig(eod_nudge_hour=1)
        now = datetime.combine(date.today(), datetime.min.time()) + timedelta(hours=2)
        result = run_eod_nudge(db, now, config)
        assert result["nudges"] == 1
    finally:
        db.close()
