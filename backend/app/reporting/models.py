from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Integer, JSON, String, Text, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class TenantScopedMixin:
    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)


class ReportingBase(Base, TenantScopedMixin):
    __abstract__ = True

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class ReportTemplate(ReportingBase):
    __tablename__ = "report_templates"

    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(400), nullable=True)
    department_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    is_global: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    config: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    __table_args__ = (
        Index("ix_report_templates_tenant_department", "tenant_id", "department_id"),
    )


class EmployeeDaySession(ReportingBase):
    __tablename__ = "employee_day_sessions"

    employee_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    manager_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    department_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    report_date: Mapped[datetime] = mapped_column(Date, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="open")
    metadata_payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    __table_args__ = (
        UniqueConstraint("tenant_id", "employee_id", "report_date", name="uq_session_employee_date"),
    )


class HourlyReportSlot(ReportingBase):
    __tablename__ = "hourly_report_slots"

    session_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    slot_hour: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="pending")
    reminder_state: Mapped[str] = mapped_column(String(40), nullable=False, default="idle")
    last_reminder_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    __table_args__ = (
        UniqueConstraint("tenant_id", "session_id", "slot_hour", name="uq_slot_session_hour"),
    )


class SalesVisit(ReportingBase):
    __tablename__ = "sales_visits"

    session_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    employee_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    manager_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    department_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    location_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    checkin_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    checkin_lat: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    checkin_lng: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    checkout_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    checkout_lat: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    checkout_lng: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    checkin_photo_id: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    checkout_photo_id: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class DailyReport(ReportingBase):
    __tablename__ = "daily_reports"

    session_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    template_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    employee_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    manager_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    department_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    report_date: Mapped[datetime] = mapped_column(Date, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="draft")
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    rendered_html: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("ix_daily_reports_manager_dashboard", "tenant_id", "department_id", "manager_id", "report_date", "status"),
    )


class ReportComment(ReportingBase):
    __tablename__ = "report_comments"

    report_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    manager_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    comment: Mapped[str] = mapped_column(Text, nullable=False)


class ReportTimelineEvent(ReportingBase):
    __tablename__ = "report_timeline_events"

    session_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    report_date: Mapped[datetime] = mapped_column(Date, nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    event_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    source: Mapped[str] = mapped_column(String(40), nullable=False, default="system")
    payload_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    idempotency_key: Mapped[str] = mapped_column(String(120), nullable=False, index=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "idempotency_key", name="uq_report_timeline_idempotency"),
        Index("ix_report_timeline_user_date", "tenant_id", "user_id", "report_date"),
        Index("ix_report_timeline_session", "tenant_id", "session_id"),
    )


class ReportTaskSnapshot(ReportingBase):
    __tablename__ = "report_task_snapshots"

    session_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    report_date: Mapped[datetime] = mapped_column(Date, nullable=False, index=True)
    task_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    snapshot_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    __table_args__ = (
        UniqueConstraint("tenant_id", "report_date", "task_id", name="uq_report_task_snapshot"),
        Index("ix_report_task_snapshot_session", "tenant_id", "session_id"),
        Index("ix_report_task_snapshot_user_date", "tenant_id", "user_id", "report_date"),
    )


class AuditEvent(ReportingBase):
    __tablename__ = "reporting_audit_events"

    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    actor_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    metadata_payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


class ReportNotification(ReportingBase):
    __tablename__ = "report_notifications"

    report_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    channel: Mapped[str] = mapped_column(String(40), nullable=False)
    recipient: Mapped[str] = mapped_column(String(120), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="queued")
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    __table_args__ = (
        UniqueConstraint("tenant_id", "idempotency_key", name="uq_report_notifications_idempotency"),
        Index("ix_report_notifications_tenant_report", "tenant_id", "report_id"),
    )


class ReportCheckin(ReportingBase):
    __tablename__ = "report_checkins"

    session_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    report_date: Mapped[datetime] = mapped_column(Date, nullable=False, index=True)
    slot_time: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    correlation_id: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    reply_received: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    retries_sent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    next_retry_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "correlation_id", name="uq_report_checkin_correlation"),
        Index("ix_report_checkins_user_date", "tenant_id", "user_id", "report_date"),
    )


class EmailProviderConfig(ReportingBase):
    __tablename__ = "report_email_provider_configs"

    mode: Mapped[str] = mapped_column(String(20), nullable=False, default="smtp")
    smtp_host: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    smtp_port: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    smtp_user: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    smtp_pass: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    smtp_tls: Mapped[Optional[bool]] = mapped_column(Boolean, default=True, nullable=True)
    sendgrid_api_key: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    from_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    from_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    __table_args__ = (
        Index("ix_report_email_provider_tenant_active", "tenant_id", "is_active"),
    )


class ReportLeaderboardEntry(ReportingBase):
    __tablename__ = "report_leaderboard_entries"

    employee_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    department_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    report_date: Mapped[datetime] = mapped_column(Date, nullable=False, index=True)
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class WeeklyReportSummary(ReportingBase):
    __tablename__ = "weekly_report_summaries"

    department_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    manager_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    week_start: Mapped[datetime] = mapped_column(Date, nullable=False, index=True)
    week_end: Mapped[datetime] = mapped_column(Date, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="open")
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
