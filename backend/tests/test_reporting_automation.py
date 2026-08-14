import uuid
from datetime import date, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.database import Base
from backend.app import models as core_models
import backend.app.reporting.models  # noqa: F401
import backend.app.reporting.models as reporting_models
from backend.app.reporting.services.automation_scheduler import ReportingAutomationScheduler
from backend.app.reporting.services.task_reporting_service import TaskReportingService
from backend.app.reporting.services.webex_checkin_service import WebexCheckinService


SQLALCHEMY_DATABASE_URL = "sqlite:///./test_reporting_automation.db"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)


def _new_session():
    return TestingSessionLocal()


def _create_user(db, **kwargs):
    user = core_models.User(
        id=str(uuid.uuid4()),
        tenant_id=uuid.uuid4(),
        name="User",
        email=f"user-{uuid.uuid4()}@example.com",
        hashed_password="test",
        role=core_models.RoleEnum.USER,
        status=core_models.UserStatusEnum.ACTIVE,
        shift_start=kwargs.get("shift_start"),
        shift_end=kwargs.get("shift_end"),
        morning_break_start=kwargs.get("morning_break_start"),
        morning_break_end=kwargs.get("morning_break_end"),
        timezone=kwargs.get("timezone"),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_checkin_break_window_skip():
    db = _new_session()
    try:
        user = _create_user(
            db,
            shift_start="08:00",
            shift_end="12:00",
            morning_break_start="10:00",
            morning_break_end="10:30",
            timezone="UTC",
        )
        scheduler = ReportingAutomationScheduler(db)
        now = datetime.combine(date.today(), datetime.strptime("10:05", "%H:%M").time())
        scheduler.bootstrap_today(now=now)

        events = (
            db.query(reporting_models.ReportTimelineEvent)
            .filter_by(tenant_id=str(user.tenant_id), user_id=user.id, event_type="WEBEX_CHECKIN")
            .all()
        )
        assert all(
            "T10:00:00" not in ((event.payload_json or {}).get("scheduled_for") or "")
            for event in events
        )
    finally:
        db.close()


def test_checkin_retry_scheduling():
    db = _new_session()
    try:
        user = _create_user(
            db,
            shift_start="08:00",
            shift_end="12:00",
            timezone="UTC",
        )
        scheduler = ReportingAutomationScheduler(db)
        now = datetime.combine(date.today(), datetime.strptime("10:25", "%H:%M").time())
        scheduler.bootstrap_today(now=now)

        events = (
            db.query(reporting_models.ReportTimelineEvent)
            .filter_by(tenant_id=str(user.tenant_id), user_id=user.id, event_type="WEBEX_CHECKIN")
            .all()
        )
        assert len(events) >= 3
    finally:
        db.close()


def test_task_snapshot_consistency():
    db = _new_session()
    try:
        user = _create_user(db, shift_start="08:00", shift_end="12:00", timezone="UTC")
        task = core_models.Task(
            title="Task",
            description="desc",
            status=core_models.TaskStatusEnum.TODO,
            priority=core_models.TaskPriorityEnum.MEDIUM,
            team="Test",
            created_by_id=user.id,
        )
        db.add(task)
        db.commit()
        db.refresh(task)

        service = TaskReportingService(db)
        report_date = date.today()
        snapshots = service.create_task_snapshots(
            tenant_id=str(user.tenant_id),
            session_id=None,
            user_id=user.id,
            report_date=report_date,
            tasks=[task],
        )
        original = snapshots[0].snapshot_json

        task.title = "Updated"
        db.add(task)
        db.commit()

        snapshots_again = service.create_task_snapshots(
            tenant_id=str(user.tenant_id),
            session_id=None,
            user_id=user.id,
            report_date=report_date,
            tasks=[task],
        )
        assert snapshots_again[0].snapshot_json == original
    finally:
        db.close()


def test_webex_idempotency():
    db = _new_session()
    try:
        user = _create_user(db, shift_start="08:00", shift_end="12:00", timezone="UTC")
        service = WebexCheckinService(db)
        report_date = date.today()
        scheduled_for = datetime.combine(report_date, datetime.strptime("08:00", "%H:%M").time())

        event1 = service.send_checkin(
            tenant_id=str(user.tenant_id),
            user_id=user.id,
            session_id=None,
            report_date=report_date,
            scheduled_for=scheduled_for,
            attempt=0,
        )
        event2 = service.send_checkin(
            tenant_id=str(user.tenant_id),
            user_id=user.id,
            session_id=None,
            report_date=report_date,
            scheduled_for=scheduled_for,
            attempt=0,
        )
        assert event1.id == event2.id
    finally:
        db.close()
