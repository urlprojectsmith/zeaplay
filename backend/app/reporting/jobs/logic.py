from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Optional
import uuid

from sqlalchemy.orm import Session

from ...models import RoleEnum, Task, TaskPriorityEnum, TaskStatusEnum, User
from .. import models, schemas
from ..services.notification_service import NotificationService
from ..utils.idempotency import build_idempotency_key
from ..utils.tenancy import apply_tenant_scope


@dataclass(frozen=True)
class ReportingJobConfig:
    hourly_reminder_minutes: int = 15
    hourly_miss_minutes: int = 60
    escalation_missed_threshold: int = 2
    eod_nudge_hour: int = 18


def run_hourly_slot_enforcement(db: Session, now: datetime, config: ReportingJobConfig) -> dict[str, int]:
    reminder_count = 0
    missed_count = 0
    notification_service = NotificationService(db)

    sessions = db.query(models.EmployeeDaySession).filter_by(report_date=now.date()).all()
    for session in sessions:
        slots = (
            db.query(models.HourlyReportSlot)
            .filter_by(tenant_id=session.tenant_id, session_id=session.id)
            .all()
        )
        for slot in slots:
            if slot.status == "submitted":
                continue
            slot_time = datetime.combine(session.report_date, time(slot.slot_hour, 0))
            reminder_due = slot_time + timedelta(minutes=config.hourly_reminder_minutes)
            miss_due = slot_time + timedelta(minutes=config.hourly_miss_minutes)

            if slot.reminder_state == "idle" and now >= reminder_due:
                idempotency_key = build_idempotency_key("hourly_reminder", slot.id, str(session.report_date)).key
                notification_service.create_notification(
                    schemas.ReportNotificationCreate(
                        tenant_id=str(session.tenant_id),
                        report_id=session.id,
                        channel="in_app",
                        recipient=session.employee_id,
                        idempotency_key=idempotency_key,
                        payload={"slot_hour": slot.slot_hour, "type": "hourly_reminder"},
                    )
                )
                slot.reminder_state = "reminded"
                slot.last_reminder_at = now
                db.add(
                    models.AuditEvent(
                        tenant_id=str(session.tenant_id),
                        event_type="hourly_reminder",
                        entity_type="hourly_report_slot",
                        entity_id=slot.id,
                        actor_id=None,
                        metadata_payload={"slot_hour": slot.slot_hour, "idempotency_key": idempotency_key},
                    )
                )
                reminder_count += 1

            if now >= miss_due and slot.status != "missed":
                slot.status = "missed"
                slot.reminder_state = "missed"
                db.add(
                    models.AuditEvent(
                        tenant_id=str(session.tenant_id),
                        event_type="hourly_missed",
                        entity_type="hourly_report_slot",
                        entity_id=slot.id,
                        actor_id=None,
                        metadata_payload={"slot_hour": slot.slot_hour},
                    )
                )
                missed_count += 1
        db.flush()
    db.commit()
    return {"reminders": reminder_count, "missed": missed_count}


def run_escalations(db: Session, now: datetime, config: ReportingJobConfig) -> dict[str, int]:
    escalation_count = 0
    notification_service = NotificationService(db)

    sessions = db.query(models.EmployeeDaySession).filter_by(report_date=now.date()).all()
    for session in sessions:
        missed_slots = (
            db.query(models.HourlyReportSlot)
            .filter_by(tenant_id=session.tenant_id, session_id=session.id, status="missed")
            .count()
        )
        if missed_slots < config.escalation_missed_threshold:
            continue

        idempotency_key = build_idempotency_key("escalation", session.id, str(session.report_date)).key
        existing = (
            db.query(models.AuditEvent)
            .filter_by(tenant_id=str(session.tenant_id), event_type="escalation")
            .all()
        )
        if any((event.metadata_payload or {}).get("idempotency_key") == idempotency_key for event in existing):
            continue

        manager_id = session.manager_id
        admin_user = _find_admin_user(db, str(session.tenant_id), manager_id)
        if admin_user:
            task = Task(
                title="Reporting escalation: missed hourly slots",
                description=f"Employee {session.employee_id} missed {missed_slots} hourly slots on {session.report_date}.",
                status=TaskStatusEnum.TODO,
                priority=TaskPriorityEnum.HIGH,
                team="Reporting",
                created_by_id=admin_user.id,
                assigned_to_id=manager_id or admin_user.id,
            )
            db.add(task)

        if manager_id:
            notification_service.create_notification(
                schemas.ReportNotificationCreate(
                    tenant_id=str(session.tenant_id),
                    report_id=session.id,
                    channel="in_app",
                    recipient=manager_id,
                    idempotency_key=idempotency_key,
                    payload={"type": "escalation", "missed_slots": missed_slots},
                )
            )

        db.add(
            models.AuditEvent(
                tenant_id=str(session.tenant_id),
                event_type="escalation",
                entity_type="employee_day_session",
                entity_id=session.id,
                actor_id=None,
                metadata_payload={"missed_slots": missed_slots, "idempotency_key": idempotency_key},
            )
        )
        escalation_count += 1

    db.commit()
    return {"escalations": escalation_count}


def run_eod_nudge(db: Session, now: datetime, config: ReportingJobConfig) -> dict[str, int]:
    if now.hour < config.eod_nudge_hour:
        return {"nudges": 0}
    notification_service = NotificationService(db)
    nudges = 0
    sessions = db.query(models.EmployeeDaySession).filter_by(report_date=now.date(), status="open").all()
    for session in sessions:
        report = (
            db.query(models.DailyReport)
            .filter_by(tenant_id=session.tenant_id, session_id=session.id)
            .first()
        )
        if report and report.status == "submitted":
            continue
        idempotency_key = build_idempotency_key("eod_nudge", session.id, str(session.report_date)).key
        notification_service.create_notification(
            schemas.ReportNotificationCreate(
                tenant_id=str(session.tenant_id),
                report_id=session.id,
                channel="in_app",
                recipient=session.employee_id,
                idempotency_key=idempotency_key,
                payload={"type": "eod_nudge"},
            )
        )
        db.add(
            models.AuditEvent(
                tenant_id=str(session.tenant_id),
                event_type="eod_nudge",
                entity_type="employee_day_session",
                entity_id=session.id,
                actor_id=None,
                metadata_payload={"idempotency_key": idempotency_key},
            )
        )
        nudges += 1
    db.commit()
    return {"nudges": nudges}


def run_weekly_summary(
    db: Session,
    week_start: date,
    week_end: date,
) -> dict[str, int]:
    summaries = 0
    leaderboard_entries = 0
    tenant_ids = [row[0] for row in db.query(models.DailyReport.tenant_id).distinct().all()]

    for tenant_id in tenant_ids:
        query = (
            db.query(models.DailyReport)
            .filter_by(tenant_id=tenant_id, status="submitted")
            .filter(models.DailyReport.report_date >= week_start)
            .filter(models.DailyReport.report_date <= week_end)
        )
        reports = query.all()

        counts_by_employee: dict[str, int] = defaultdict(int)
        counts_by_department: dict[str, int] = defaultdict(int)
        for report in reports:
            counts_by_employee[report.employee_id] += 1
            if report.department_id:
                counts_by_department[report.department_id] += 1

        for employee_id, count in counts_by_employee.items():
            entry = (
                db.query(models.ReportLeaderboardEntry)
                .filter_by(tenant_id=tenant_id, employee_id=employee_id, report_date=week_end)
                .first()
            )
            if not entry:
                entry = models.ReportLeaderboardEntry(
                    tenant_id=tenant_id,
                    employee_id=employee_id,
                    department_id=None,
                    report_date=week_end,
                    score=count,
                )
            else:
                entry.score = count
            db.add(entry)
            leaderboard_entries += 1

        for department_id, count in counts_by_department.items():
            summary = (
                db.query(models.WeeklyReportSummary)
                .filter_by(tenant_id=tenant_id, department_id=department_id, week_start=week_start)
                .first()
            )
            payload = {"submitted_reports": count}
            if not summary:
                summary = models.WeeklyReportSummary(
                    tenant_id=tenant_id,
                    department_id=department_id,
                    manager_id=None,
                    week_start=week_start,
                    week_end=week_end,
                    status="closed",
                    payload=payload,
                )
            else:
                summary.payload = payload
            db.add(summary)
            summaries += 1

        db.add(
            models.AuditEvent(
                tenant_id=tenant_id,
                event_type="weekly_summary",
                entity_type="weekly_report_summary",
                entity_id=f"{week_start}-{week_end}",
                actor_id=None,
                metadata_payload={"week_start": str(week_start), "week_end": str(week_end)},
            )
        )

    db.commit()
    return {"summaries": summaries, "leaderboard_entries": leaderboard_entries}


def _find_admin_user(db: Session, tenant_id: str, manager_id: Optional[str]) -> Optional[User]:
    if manager_id:
        return db.query(User).filter_by(id=manager_id).first()
    tenant_uuid = None
    try:
        tenant_uuid = uuid.UUID(str(tenant_id))
    except (ValueError, TypeError):
        tenant_uuid = None
    for role in (RoleEnum.OWNER, RoleEnum.ADMIN, RoleEnum.MANAGER):
        filters = {"role": role}
        if tenant_uuid is not None:
            filters["tenant_id"] = tenant_uuid
        user = db.query(User).filter_by(**filters).first()
        if user:
            return user
    return None
