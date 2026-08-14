from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from ...models import User, UserStatusEnum
from .. import models
from ..services.report_service import ReportService
from ..services.webex_checkin_service import WebexCheckinService


@dataclass(frozen=True)
class ShiftWindow:
    start: datetime
    end: datetime
    close_time: datetime
    breaks: list[tuple[datetime, datetime]]


class ReportingAutomationScheduler:
    def __init__(self, db: Session):
        self.db = db
        self.report_service = ReportService(db)
        self.webex_service = WebexCheckinService(db)

    def bootstrap_today(self, *, now: Optional[datetime] = None) -> dict[str, int]:
        now = now or datetime.utcnow()
        users = self.db.query(User).filter(User.status == UserStatusEnum.ACTIVE).all()

        sessions_started = 0
        sessions_closed = 0
        checkins_sent = 0

        for user in users:
            if not user.shift_start or not user.shift_end:
                continue
            try:
                tz = ZoneInfo(user.timezone or "UTC")
            except Exception:
                tz = ZoneInfo("UTC")
            now_local = now.astimezone(tz)
            report_date = now_local.date()
            shift = self._build_shift_window(user, report_date, tz)

            session = (
                self.db.query(models.EmployeeDaySession)
                .filter_by(tenant_id=str(user.tenant_id), employee_id=user.id, report_date=report_date)
                .first()
            )
            if now_local >= shift.start and session is None:
                try:
                    self.report_service.start_day(
                        tenant_id=str(user.tenant_id),
                        employee_id=user.id,
                        manager_id=user.manager_id,
                        department_id=user.department_id,
                        report_date=report_date,
                        metadata={"source": "automation"},
                    )
                    sessions_started += 1
                except ValueError:
                    pass

            if now_local >= shift.close_time and session and session.status == "open":
                try:
                    self.report_service.end_day(
                        tenant_id=str(user.tenant_id),
                        employee_id=user.id,
                        report_date=report_date,
                    )
                    sessions_closed += 1
                except ValueError:
                    pass

            for scheduled_for in self._checkin_times(shift):
                if self._is_break_time(scheduled_for, shift.breaks):
                    continue
                checkin = (
                    self.db.query(models.ReportCheckin)
                    .filter_by(
                        tenant_id=str(user.tenant_id),
                        user_id=user.id,
                        report_date=report_date,
                        slot_time=scheduled_for,
                    )
                    .first()
                )
                if not checkin:
                    checkin = models.ReportCheckin(
                        tenant_id=str(user.tenant_id),
                        session_id=session.id if session else None,
                        user_id=user.id,
                        report_date=report_date,
                        slot_time=scheduled_for,
                        correlation_id=_build_correlation(user.id, report_date, scheduled_for),
                        retries_sent=0,
                        next_retry_at=scheduled_for,
                    )
                    self.db.add(checkin)
                    self.db.flush()

                if checkin.reply_received:
                    continue
                if checkin.next_retry_at and now_local < checkin.next_retry_at:
                    continue
                if checkin.retries_sent > 2:
                    continue

                event = self.webex_service.send_checkin(
                    tenant_id=str(user.tenant_id),
                    user_id=user.id,
                    session_id=session.id if session else None,
                    report_date=report_date,
                    scheduled_for=scheduled_for,
                    attempt=checkin.retries_sent,
                    correlation_id=checkin.correlation_id,
                )
                if not event:
                    continue
                checkin.sent_at = datetime.utcnow()
                checkin.retries_sent += 1
                if checkin.retries_sent <= 2:
                    checkin.next_retry_at = now_local + timedelta(minutes=10)
                else:
                    checkin.next_retry_at = None
                self.db.add(checkin)
                checkins_sent += 1

        self.db.commit()
        return {
            "sessions_started": sessions_started,
            "sessions_closed": sessions_closed,
            "checkins_sent": checkins_sent,
        }

    @staticmethod
    def _checkin_times(shift: ShiftWindow) -> list[datetime]:
        times = []
        cursor = shift.start
        while cursor <= shift.close_time:
            times.append(cursor)
            cursor = cursor + timedelta(hours=2)
        return times

    @staticmethod
    def _build_shift_window(user: User, report_date: date, tz: ZoneInfo) -> ShiftWindow:
        shift_start = _parse_time(user.shift_start)
        shift_end = _parse_time(user.shift_end)
        start_dt = datetime.combine(report_date, shift_start, tzinfo=tz)
        end_dt = datetime.combine(report_date, shift_end, tzinfo=tz)
        if end_dt <= start_dt:
            end_dt = end_dt + timedelta(days=1)
        close_time = end_dt - timedelta(minutes=30)

        breaks: list[tuple[datetime, datetime]] = []
        for start_key, end_key in (
            ("morning_break_start", "morning_break_end"),
            ("lunch_break_start", "lunch_break_end"),
        ):
            start_value = getattr(user, start_key)
            end_value = getattr(user, end_key)
            if not start_value or not end_value:
                continue
            b_start = datetime.combine(report_date, _parse_time(start_value), tzinfo=tz)
            b_end = datetime.combine(report_date, _parse_time(end_value), tzinfo=tz)
            if b_end <= b_start:
                b_end = b_end + timedelta(days=1)
            breaks.append((b_start, b_end))

        return ShiftWindow(start=start_dt, end=end_dt, close_time=close_time, breaks=breaks)

    @staticmethod
    def _is_break_time(when: datetime, breaks: list[tuple[datetime, datetime]]) -> bool:
        return any(start <= when <= end for start, end in breaks)


def _parse_time(value: str) -> time:
    parts = value.split(":")
    hour = int(parts[0])
    minute = int(parts[1]) if len(parts) > 1 else 0
    return time(hour=hour, minute=minute)


def _build_correlation(user_id: str, report_date: date, scheduled_for: datetime) -> str:
    return f"{user_id}-{report_date}-{scheduled_for.strftime('%H:%M')}"
