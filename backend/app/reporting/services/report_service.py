from datetime import date, datetime
from typing import Optional

from sqlalchemy.orm import Session

from .. import models, schemas
from ..utils.tenancy import apply_tenant_scope


class ReportService:
    def __init__(self, db: Session):
        self.db = db

    def start_day(
        self,
        *,
        tenant_id: str,
        employee_id: str,
        manager_id: Optional[str],
        department_id: Optional[str],
        report_date: date,
        metadata: Optional[dict] = None,
    ) -> models.EmployeeDaySession:
        if report_date > date.today():
            raise ValueError("Cannot start a session for a future date.")
        existing = (
            self.db.query(models.EmployeeDaySession)
            .filter_by(tenant_id=tenant_id, employee_id=employee_id, report_date=report_date)
            .first()
        )
        if existing:
            raise ValueError("Session already started for this date.")
        session = models.EmployeeDaySession(
            tenant_id=tenant_id,
            employee_id=employee_id,
            manager_id=manager_id,
            department_id=department_id,
            report_date=report_date,
            status="open",
            metadata_payload=metadata or {},
        )
        self.db.add(session)
        self.db.flush()
        self._record_timeline_event(
            tenant_id=tenant_id,
            session_id=session.id,
            user_id=employee_id,
            report_date=report_date,
            event_type="SESSION_OPEN",
            event_time=datetime.utcnow(),
            source="system",
            payload={"metadata": metadata or {}},
            idempotency_key=f"session-open-{session.id}",
        )
        self._record_event(
            tenant_id=tenant_id,
            event_type="day_start",
            entity_type="employee_day_session",
            entity_id=session.id,
            actor_id=employee_id,
        )
        self.db.commit()
        self.db.refresh(session)
        return session

    def end_day(self, *, tenant_id: str, employee_id: str, report_date: date) -> models.EmployeeDaySession:
        if report_date > date.today():
            raise ValueError("Cannot end a session for a future date.")
        session = (
            self.db.query(models.EmployeeDaySession)
            .filter_by(tenant_id=tenant_id, employee_id=employee_id, report_date=report_date)
            .first()
        )
        if not session:
            raise ValueError("Session not found for this date.")
        if session.status == "closed":
            raise ValueError("Session already closed.")
        session.status = "closed"
        self._record_timeline_event(
            tenant_id=tenant_id,
            session_id=session.id,
            user_id=employee_id,
            report_date=report_date,
            event_type="SESSION_CLOSE",
            event_time=datetime.utcnow(),
            source="system",
            payload={},
            idempotency_key=f"session-close-{session.id}",
        )
        self._record_event(
            tenant_id=tenant_id,
            event_type="day_end",
            entity_type="employee_day_session",
            entity_id=session.id,
            actor_id=employee_id,
        )
        self.db.commit()
        self.db.refresh(session)
        return session

    def submit_hourly(
        self,
        *,
        tenant_id: str,
        employee_id: str,
        session_id: str,
        slot_hour: int,
        payload: dict,
        idempotency_key: Optional[str],
    ) -> models.HourlyReportSlot:
        if slot_hour < 0 or slot_hour > 23:
            raise ValueError("slot_hour must be between 0 and 23.")
        session = (
            self.db.query(models.EmployeeDaySession)
            .filter_by(tenant_id=tenant_id, id=session_id)
            .first()
        )
        if not session:
            raise ValueError("Session not found.")
        if session.employee_id != employee_id:
            raise ValueError("Session does not belong to employee.")
        if session.report_date == date.today() and slot_hour > datetime.utcnow().hour:
            raise ValueError("Cannot submit a future hourly slot.")
        if idempotency_key and self._idempotent_event_exists("hourly_submit", idempotency_key, tenant_id):
            existing = self._load_slot_by_key(tenant_id, session_id, slot_hour)
            if existing:
                return existing
        existing_slot = (
            self.db.query(models.HourlyReportSlot)
            .filter_by(tenant_id=tenant_id, session_id=session_id, slot_hour=slot_hour)
            .first()
        )
        if existing_slot and existing_slot.status == "submitted":
            raise ValueError("Hourly slot already submitted.")
        slot = existing_slot or models.HourlyReportSlot(
            tenant_id=tenant_id,
            session_id=session_id,
            slot_hour=slot_hour,
        )
        slot.payload = payload
        slot.status = "submitted"
        slot.reminder_state = "idle"
        self.db.add(slot)
        self.db.flush()
        self._record_timeline_event(
            tenant_id=tenant_id,
            session_id=session.id,
            user_id=employee_id,
            report_date=session.report_date,
            event_type="MANUAL_ENTRY",
            event_time=datetime.utcnow(),
            source="manual",
            payload={"slot_hour": slot_hour, "payload": payload},
            idempotency_key=f"hourly-submit-{session.id}-{slot_hour}",
        )
        self._record_event(
            tenant_id=tenant_id,
            event_type="hourly_submit",
            entity_type="hourly_report_slot",
            entity_id=slot.id,
            actor_id=employee_id,
            idempotency_key=idempotency_key,
        )
        self.db.commit()
        self.db.refresh(slot)
        return slot

    def save_draft(
        self,
        *,
        tenant_id: str,
        employee_id: str,
        payload: schemas.DailyReportCreate,
    ) -> models.DailyReport:
        session = (
            self.db.query(models.EmployeeDaySession)
            .filter_by(tenant_id=tenant_id, id=payload.session_id)
            .first()
        )
        if not session:
            raise ValueError("Session not found.")
        if session.employee_id != employee_id:
            raise ValueError("Session does not belong to employee.")
        if session.report_date != payload.report_date:
            raise ValueError("Report date does not match session date.")
        report = (
            self.db.query(models.DailyReport)
            .filter_by(tenant_id=tenant_id, session_id=payload.session_id)
            .first()
        )
        if report and report.status == "submitted":
            raise ValueError("Report already submitted.")
        report = report or models.DailyReport(
            tenant_id=tenant_id,
            session_id=payload.session_id,
            employee_id=employee_id,
            manager_id=payload.manager_id,
            department_id=payload.department_id,
            report_date=payload.report_date,
            template_id=payload.template_id,
        )
        report.payload = payload.payload
        report.status = "draft"
        self.db.add(report)
        self.db.flush()
        self._record_event(
            tenant_id=tenant_id,
            event_type="report_draft",
            entity_type="daily_report",
            entity_id=report.id,
            actor_id=employee_id,
        )
        self.db.commit()
        self.db.refresh(report)
        return report

    def preview_report(
        self,
        *,
        tenant_id: str,
        employee_id: str,
        report_date: date,
    ) -> Optional[models.DailyReport]:
        query = self.db.query(models.DailyReport)
        query = apply_tenant_scope(query, tenant_id)
        return query.filter_by(employee_id=employee_id, report_date=report_date).first()

    def submit_report(
        self,
        *,
        tenant_id: str,
        employee_id: str,
        payload: schemas.DailyReportCreate,
        idempotency_key: Optional[str],
    ) -> models.DailyReport:
        session = (
            self.db.query(models.EmployeeDaySession)
            .filter_by(tenant_id=tenant_id, id=payload.session_id)
            .first()
        )
        if not session:
            raise ValueError("Session not found.")
        if session.employee_id != employee_id:
            raise ValueError("Session does not belong to employee.")
        report = (
            self.db.query(models.DailyReport)
            .filter_by(tenant_id=tenant_id, session_id=payload.session_id)
            .first()
        )
        if idempotency_key and self._idempotent_event_exists("report_submit", idempotency_key, tenant_id):
            if report:
                return report
        if report and report.status == "submitted":
            raise ValueError("Report already submitted.")
        report = report or models.DailyReport(
            tenant_id=tenant_id,
            session_id=payload.session_id,
            employee_id=employee_id,
            manager_id=payload.manager_id,
            department_id=payload.department_id,
            report_date=payload.report_date,
            template_id=payload.template_id,
        )
        report.payload = payload.payload
        report.status = "submitted"
        report.submitted_at = datetime.utcnow()
        self.db.add(report)
        self.db.flush()
        self._record_event(
            tenant_id=tenant_id,
            event_type="report_submit",
            entity_type="daily_report",
            entity_id=report.id,
            actor_id=employee_id,
            idempotency_key=idempotency_key,
        )
        self.db.commit()
        self.db.refresh(report)
        return report

    def get_report(self, tenant_id: str, report_id: str) -> Optional[models.DailyReport]:
        return (
            self.db.query(models.DailyReport)
            .filter_by(tenant_id=tenant_id, id=report_id)
            .first()
        )

    def get_team_status(
        self,
        *,
        tenant_id: str,
        report_date: date,
        manager_id: Optional[str],
        department_id: Optional[str],
    ) -> list[schemas.TeamStatusRead]:
        query = self.db.query(models.EmployeeDaySession)
        query = apply_tenant_scope(query, tenant_id)
        if manager_id:
            query = query.filter_by(manager_id=manager_id)
        if department_id:
            query = query.filter_by(department_id=department_id)
        query = query.filter_by(report_date=report_date)
        sessions = query.all()
        responses: list[schemas.TeamStatusRead] = []
        for session in sessions:
            report = (
                self.db.query(models.DailyReport)
                .filter_by(tenant_id=tenant_id, session_id=session.id)
                .first()
            )
            responses.append(
                schemas.TeamStatusRead(
                    employee_id=session.employee_id,
                    session_id=session.id,
                    report_date=session.report_date,
                    session_status=session.status,
                    report_status=report.status if report else "missing",
                )
            )
        return responses

    def get_manager_reports(
        self,
        *,
        tenant_id: str,
        report_date: Optional[date],
        manager_id: Optional[str],
        status: Optional[str],
    ) -> list[models.DailyReport]:
        query = self.db.query(models.DailyReport)
        query = apply_tenant_scope(query, tenant_id)
        if manager_id:
            query = query.filter_by(manager_id=manager_id)
        if report_date:
            query = query.filter_by(report_date=report_date)
        if status:
            query = query.filter_by(status=status)
        return query.all()

    def add_comment(
        self,
        *,
        tenant_id: str,
        report_id: str,
        manager_id: str,
        comment: str,
    ) -> models.ReportComment:
        report = self.get_report(tenant_id, report_id)
        if not report:
            raise ValueError("Report not found.")
        entry = models.ReportComment(
            tenant_id=tenant_id,
            report_id=report_id,
            manager_id=manager_id,
            comment=comment,
        )
        self.db.add(entry)
        self.db.flush()
        self._record_event(
            tenant_id=tenant_id,
            event_type="report_comment",
            entity_type="report_comment",
            entity_id=entry.id,
            actor_id=manager_id,
        )
        self.db.commit()
        self.db.refresh(entry)
        return entry

    def _record_event(
        self,
        *,
        tenant_id: str,
        event_type: str,
        entity_type: str,
        entity_id: str,
        actor_id: Optional[str],
        idempotency_key: Optional[str] = None,
    ) -> None:
        metadata = {}
        if idempotency_key:
            metadata["idempotency_key"] = idempotency_key
        audit_event = models.AuditEvent(
            tenant_id=tenant_id,
            event_type=event_type,
            entity_type=entity_type,
            entity_id=entity_id,
            actor_id=actor_id,
            metadata_payload=metadata,
        )
        self.db.add(audit_event)

    def _record_timeline_event(
        self,
        *,
        tenant_id: str,
        session_id: Optional[str],
        user_id: str,
        report_date: date,
        event_type: str,
        event_time: datetime,
        source: str,
        payload: dict,
        idempotency_key: str,
    ) -> None:
        exists = (
            self.db.query(models.ReportTimelineEvent)
            .filter_by(tenant_id=tenant_id, idempotency_key=idempotency_key)
            .first()
        )
        if exists:
            return
        if "time_bucket" not in payload:
            hour = event_time.hour
            payload["time_bucket"] = "Morning" if hour < 12 else "Afternoon" if hour < 17 else "Evening"
        self.db.add(
            models.ReportTimelineEvent(
                tenant_id=tenant_id,
                session_id=session_id,
                user_id=user_id,
                report_date=report_date,
                event_type=event_type,
                event_time=event_time,
                source=source,
                payload_json=payload,
                idempotency_key=idempotency_key,
            )
        )

    def _idempotent_event_exists(self, event_type: str, idempotency_key: str, tenant_id: str) -> bool:
        query = self.db.query(models.AuditEvent)
        query = apply_tenant_scope(query, tenant_id)
        query = query.filter_by(event_type=event_type)
        for event in query.all():
            if (event.metadata_payload or {}).get("idempotency_key") == idempotency_key:
                return True
        return False

    def _load_slot_by_key(
        self,
        tenant_id: str,
        session_id: str,
        slot_hour: int,
    ) -> Optional[models.HourlyReportSlot]:
        return (
            self.db.query(models.HourlyReportSlot)
            .filter_by(tenant_id=tenant_id, session_id=session_id, slot_hour=slot_hour)
            .first()
        )
