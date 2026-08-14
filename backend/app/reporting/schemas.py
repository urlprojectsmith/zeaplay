from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class ReportingBase(BaseModel):
    id: str
    tenant_id: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ReportTemplateCreate(BaseModel):
    name: str
    description: Optional[str] = None
    department_id: Optional[str] = None
    is_global: bool = False
    config: dict[str, Any] = Field(default_factory=dict)


class ReportTemplateRead(ReportingBase):
    name: str
    description: Optional[str] = None
    department_id: Optional[str] = None
    version: int
    published_at: Optional[datetime] = None
    is_global: bool
    config: dict[str, Any]
    is_active: bool
    deleted_at: Optional[datetime] = None


class ReportCreate(BaseModel):
    template_id: str
    title: str
    payload: dict[str, Any] = Field(default_factory=dict)


class ReportRead(ReportingBase):
    template_id: str
    title: str
    status: str
    payload: dict[str, Any]


class EmployeeDaySessionCreate(BaseModel):
    report_date: date
    metadata: dict[str, Any] = Field(default_factory=dict)


class DayEndRequest(BaseModel):
    report_date: date


class HourlyReportSubmitRequest(BaseModel):
    session_id: str
    slot_hour: int
    payload: dict[str, Any] = Field(default_factory=dict)


class EmployeeDaySessionRead(ReportingBase):
    employee_id: str
    manager_id: Optional[str] = None
    department_id: Optional[str] = None
    report_date: date
    status: str
    metadata: dict[str, Any] = Field(alias="metadata_payload")


class HourlyReportSlotCreate(BaseModel):
    session_id: str
    slot_hour: int
    payload: dict[str, Any] = Field(default_factory=dict)


class HourlyReportSlotRead(ReportingBase):
    session_id: str
    slot_hour: int
    status: str
    reminder_state: str
    last_reminder_at: Optional[datetime] = None
    payload: dict[str, Any]


class SalesVisitCreate(BaseModel):
    session_id: str
    manager_id: Optional[str] = None
    department_id: Optional[str] = None
    location_name: Optional[str] = None
    checkin_at: Optional[datetime] = None
    checkin_lat: Optional[str] = None
    checkin_lng: Optional[str] = None
    checkout_at: Optional[datetime] = None
    checkout_lat: Optional[str] = None
    checkout_lng: Optional[str] = None
    checkin_photo_id: Optional[str] = None
    checkout_photo_id: Optional[str] = None
    notes: Optional[str] = None


class VisitEndRequest(BaseModel):
    visit_id: str
    checkout_lat: Optional[str] = None
    checkout_lng: Optional[str] = None
    checkout_photo_id: Optional[str] = None


class SalesVisitRead(ReportingBase):
    session_id: str
    employee_id: str
    manager_id: Optional[str] = None
    department_id: Optional[str] = None
    location_name: Optional[str] = None
    checkin_at: Optional[datetime] = None
    checkin_lat: Optional[str] = None
    checkin_lng: Optional[str] = None
    checkout_at: Optional[datetime] = None
    checkout_lat: Optional[str] = None
    checkout_lng: Optional[str] = None
    checkin_photo_id: Optional[str] = None
    checkout_photo_id: Optional[str] = None
    notes: Optional[str] = None


class DailyReportCreate(BaseModel):
    session_id: str
    template_id: Optional[str] = None
    manager_id: Optional[str] = None
    department_id: Optional[str] = None
    report_date: date
    payload: dict[str, Any] = Field(default_factory=dict)


class DailyReportRead(ReportingBase):
    session_id: str
    template_id: Optional[str] = None
    employee_id: str
    manager_id: Optional[str] = None
    department_id: Optional[str] = None
    report_date: date
    status: str
    submitted_at: Optional[datetime] = None
    payload: dict[str, Any]
    rendered_html: Optional[str] = None


class ReportCommentCreate(BaseModel):
    comment: str


class ReportCommentRead(ReportingBase):
    report_id: str
    manager_id: str
    comment: str


class ReportTimelineEventCreate(BaseModel):
    session_id: Optional[str] = None
    report_date: date
    event_type: str
    event_time: Optional[datetime] = None
    source: str = "manual"
    payload: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str


class ReportTimelineEventRead(ReportingBase):
    session_id: Optional[str] = None
    user_id: str
    report_date: date
    event_type: str
    event_time: datetime
    source: str
    payload: dict[str, Any] = Field(alias="payload_json")
    idempotency_key: str


class ReportTaskSnapshotRead(ReportingBase):
    session_id: Optional[str] = None
    user_id: str
    report_date: date
    task_id: str
    snapshot: dict[str, Any] = Field(alias="snapshot_json")


class ManualEntryRequest(BaseModel):
    report_date: date
    session_id: Optional[str] = None
    task_id: Optional[str] = None
    note: str
    event_time: Optional[datetime] = None
    time_bucket: Optional[str] = None
    duration_minutes: Optional[int] = None


class ReportPreviewResponse(BaseModel):
    report_date: date
    timeline: list[ReportTimelineEventRead]
    task_snapshots: list[ReportTaskSnapshotRead]
    draft_json: dict[str, Any]


class WebexReplyWebhook(BaseModel):
    correlation_id: Optional[str] = None
    text: Optional[str] = None
    person_id: Optional[str] = None
    room_id: Optional[str] = None
    reply_time: Optional[datetime] = None
    message_id: Optional[str] = None


class GenerateReportRequest(BaseModel):
    report_date: date
    template_id: Optional[str] = None
    title: Optional[str] = None
    send_email: bool = False
    send_webex: bool = False


class GeneratedReportResponse(BaseModel):
    report: DailyReportRead
    export_url: Optional[str] = None
    email_sent: bool
    webex_sent: bool


class ReportCheckinRead(ReportingBase):
    session_id: Optional[str] = None
    user_id: str
    report_date: date
    slot_time: datetime
    correlation_id: str
    sent_at: Optional[datetime] = None
    reply_received: bool
    retries_sent: int
    next_retry_at: Optional[datetime] = None
    last_error: Optional[str] = None


class EmailProviderConfigUpsert(BaseModel):
    mode: str = "smtp"
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_pass: Optional[str] = None
    smtp_tls: Optional[bool] = True
    sendgrid_api_key: Optional[str] = None
    from_email: Optional[str] = None
    from_name: Optional[str] = None
    is_active: bool = True


class EmailProviderConfigRead(ReportingBase):
    mode: str
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_user: Optional[str] = None
    smtp_tls: Optional[bool] = None
    sendgrid_api_key: Optional[str] = None
    from_email: Optional[str] = None
    from_name: Optional[str] = None
    is_active: bool


class EmailTestRequest(BaseModel):
    to_email: str
    subject: Optional[str] = None
    body: Optional[str] = None


class AuditEventCreate(BaseModel):
    event_type: str
    entity_type: str
    entity_id: str
    actor_id: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class AuditEventRead(ReportingBase):
    event_type: str
    entity_type: str
    entity_id: str
    actor_id: Optional[str] = None
    metadata: dict[str, Any] = Field(alias="metadata_payload")


class ReportLeaderboardEntryRead(ReportingBase):
    employee_id: str
    department_id: Optional[str] = None
    report_date: date
    score: int


class WeeklyReportSummaryRead(ReportingBase):
    department_id: Optional[str] = None
    manager_id: Optional[str] = None
    week_start: date
    week_end: date
    status: str
    payload: dict[str, Any]


class TeamStatusRead(BaseModel):
    employee_id: str
    session_id: str
    report_date: date
    session_status: str
    report_status: str


class ReportVisitCreate(BaseModel):
    tenant_id: str
    report_id: str
    user_id: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ReportVisitRead(ReportingBase):
    report_id: str
    user_id: Optional[str] = None
    metadata: dict[str, Any]


class ReportNotificationCreate(BaseModel):
    tenant_id: str
    report_id: str
    channel: str
    recipient: str
    idempotency_key: str
    payload: dict[str, Any] = Field(default_factory=dict)


class ReportNotificationRead(ReportingBase):
    report_id: str
    channel: str
    recipient: str
    idempotency_key: str
    status: str
    payload: dict[str, Any]
