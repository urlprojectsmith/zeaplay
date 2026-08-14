from __future__ import annotations

from datetime import date, datetime, time
from typing import Optional

from sqlalchemy.orm import Session

from .. import models, schemas
from ..utils.idempotency import build_idempotency_key


class WebexCheckinService:
    def __init__(self, db: Session):
        self.db = db

    def send_checkin(
        self,
        *,
        tenant_id: str,
        user_id: str,
        session_id: Optional[str],
        report_date: date,
        scheduled_for: datetime,
        attempt: int = 0,
        correlation_id: Optional[str] = None,
    ) -> models.ReportTimelineEvent:
        correlation_id = correlation_id or build_idempotency_key(
            "webex_checkin", user_id, str(report_date), str(scheduled_for)
        ).key
        idempotency_key = build_idempotency_key(correlation_id, str(attempt)).key
        existing = self._get_event(tenant_id, idempotency_key)
        if existing:
            return existing

        checkin = (
            self.db.query(models.ReportCheckin)
            .filter_by(tenant_id=tenant_id, correlation_id=correlation_id)
            .first()
        )
        if not checkin:
            checkin = models.ReportCheckin(
                tenant_id=tenant_id,
                session_id=session_id,
                user_id=user_id,
                report_date=report_date,
                slot_time=scheduled_for,
                correlation_id=correlation_id,
                retries_sent=attempt,
            )
        checkin.sent_at = datetime.utcnow()
        checkin.retries_sent = attempt
        checkin.next_retry_at = scheduled_for if attempt == 0 else None
        self.db.add(checkin)

        event = models.ReportTimelineEvent(
            tenant_id=tenant_id,
            session_id=session_id,
            user_id=user_id,
            report_date=report_date,
            event_type="WEBEX_CHECKIN",
            event_time=scheduled_for,
            source="webex",
            payload_json={
                "correlation_id": correlation_id,
                "attempt": attempt,
                "scheduled_for": scheduled_for.isoformat(),
                "marker": f"#ZEA_CHECKIN:{correlation_id}",
            },
            idempotency_key=idempotency_key,
        )
        self.db.add(event)
        self.db.add(
            models.ReportNotification(
                tenant_id=tenant_id,
                report_id=session_id or "",
                channel="webex",
                recipient=user_id,
                idempotency_key=idempotency_key,
                payload={
                    "type": "webex_checkin",
                    "scheduled_for": scheduled_for.isoformat(),
                    "attempt": attempt,
                    "marker": f"#ZEA_CHECKIN:{correlation_id}",
                },
            )
        )
        self.db.flush()
        return event

    def record_reply(
        self,
        *,
        tenant_id: str,
        user_id: str,
        report_date: date,
        correlation_id: str,
        payload: dict,
        event_time: Optional[datetime] = None,
        message_id: Optional[str] = None,
    ) -> models.ReportTimelineEvent:
        reply_key = build_idempotency_key("webex_reply", correlation_id, user_id, message_id or "").key
        if self._timeline_exists(tenant_id, reply_key):
            return self._get_event(tenant_id, reply_key)
        event_time = event_time or datetime.utcnow()
        time_bucket = _time_bucket(event_time)
        event = models.ReportTimelineEvent(
            tenant_id=tenant_id,
            session_id=None,
            user_id=user_id,
            report_date=report_date,
            event_type="WEBEX_REPLY",
            event_time=event_time,
            source="webex",
            payload_json={
                "correlation_id": correlation_id,
                "time_bucket": time_bucket,
                "payload": payload,
            },
            idempotency_key=reply_key,
        )
        self.db.add(event)
        checkin = (
            self.db.query(models.ReportCheckin)
            .filter_by(tenant_id=tenant_id, correlation_id=correlation_id)
            .first()
        )
        if checkin:
            checkin.reply_received = True
            checkin.next_retry_at = None
            self.db.add(checkin)
        self.db.flush()
        return event

    def has_reply(self, tenant_id: str, correlation_id: str) -> bool:
        events = (
            self.db.query(models.ReportTimelineEvent)
            .filter_by(tenant_id=tenant_id, event_type="WEBEX_REPLY")
            .all()
        )
        return any((event.payload_json or {}).get("correlation_id") == correlation_id for event in events)

    def _timeline_exists(self, tenant_id: str, idempotency_key: str) -> bool:
        return (
            self.db.query(models.ReportTimelineEvent)
            .filter_by(tenant_id=tenant_id, idempotency_key=idempotency_key)
            .first()
            is not None
        )

    def _get_event(self, tenant_id: str, idempotency_key: str) -> models.ReportTimelineEvent:
        return (
            self.db.query(models.ReportTimelineEvent)
            .filter_by(tenant_id=tenant_id, idempotency_key=idempotency_key)
            .first()
        )


def _time_bucket(timestamp: datetime) -> str:
    hour = timestamp.time().hour
    if hour < 12:
        return "Morning"
    if hour < 17:
        return "Afternoon"
    return "Evening"
