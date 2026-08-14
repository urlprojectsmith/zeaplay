from datetime import date, datetime
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import get_current_active_user
from ..models import RoleEnum, User
from . import models, schemas
from .services.report_service import ReportService
from .services.template_service import TemplateService
from .services.visit_service import VisitService
from .services.task_reporting_service import TaskReportingService
from .services.report_generator_service import ReportGeneratorService
from .services.webex_checkin_service import WebexCheckinService
from .services.automation_scheduler import ReportingAutomationScheduler
from .jobs.api import router as jobs_router

router = APIRouter(prefix="/reporting", tags=["reporting"])
router.include_router(jobs_router)

logger = logging.getLogger(__name__)


def _require_roles(user: User, allowed: set[RoleEnum]) -> None:
    if user.role not in allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role permissions")


def _tenant_id(user: User, x_tenant_id: Optional[str] = Header(default=None, alias="x-tenant-id")) -> str:
    if user.tenant_id:
        return str(user.tenant_id)
    if x_tenant_id:
        return str(x_tenant_id)
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is missing tenant assignment")


@router.post("/day/start", response_model=schemas.EmployeeDaySessionRead)
def start_day(
    payload: schemas.EmployeeDaySessionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.USER, RoleEnum.MANAGER, RoleEnum.ADMIN, RoleEnum.OWNER})
    logger.warning(
        "reporting debug start_day tenant=%s user=%s report_date=%s payload=%s",
        _tenant_id(current_user),
        current_user.id,
        payload.report_date,
        payload.dict(),
    )
    service = ReportService(db)
    try:
        return service.start_day(
            tenant_id=_tenant_id(current_user),
            employee_id=current_user.id,
            manager_id=current_user.manager_id,
            department_id=current_user.department_id,
            report_date=payload.report_date,
            metadata=payload.metadata,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/day/end", response_model=schemas.EmployeeDaySessionRead)
def end_day(
    payload: schemas.DayEndRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.USER, RoleEnum.MANAGER, RoleEnum.ADMIN, RoleEnum.OWNER})
    service = ReportService(db)
    try:
        return service.end_day(
            tenant_id=_tenant_id(current_user),
            employee_id=current_user.id,
            report_date=payload.report_date,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/hourly/submit", response_model=schemas.HourlyReportSlotRead)
def submit_hourly(
    payload: schemas.HourlyReportSubmitRequest,
    idempotency_key: Optional[str] = Query(default=None, alias="idempotency_key"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.USER, RoleEnum.MANAGER, RoleEnum.ADMIN, RoleEnum.OWNER})
    service = ReportService(db)
    try:
        return service.submit_hourly(
            tenant_id=_tenant_id(current_user),
            employee_id=current_user.id,
            session_id=payload.session_id,
            slot_hour=payload.slot_hour,
            payload=payload.payload,
            idempotency_key=idempotency_key,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/visit/start", response_model=schemas.SalesVisitRead)
def start_visit(
    payload: schemas.SalesVisitCreate,
    idempotency_key: Optional[str] = Query(default=None, alias="idempotency_key"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.USER, RoleEnum.MANAGER, RoleEnum.ADMIN, RoleEnum.OWNER})
    service = VisitService(db)
    try:
        resolved_payload = schemas.SalesVisitCreate(
            session_id=payload.session_id,
            manager_id=payload.manager_id or current_user.manager_id,
            department_id=payload.department_id or current_user.department_id,
            location_name=payload.location_name,
            checkin_at=payload.checkin_at,
            checkin_lat=payload.checkin_lat,
            checkin_lng=payload.checkin_lng,
            checkout_at=payload.checkout_at,
            checkout_lat=payload.checkout_lat,
            checkout_lng=payload.checkout_lng,
            checkin_photo_id=payload.checkin_photo_id,
            checkout_photo_id=payload.checkout_photo_id,
            notes=payload.notes,
        )
        return service.start_visit(
            tenant_id=_tenant_id(current_user),
            payload=resolved_payload,
            employee_id=current_user.id,
            idempotency_key=idempotency_key,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/visit/end", response_model=schemas.SalesVisitRead)
def end_visit(
    payload: schemas.VisitEndRequest,
    idempotency_key: Optional[str] = Query(default=None, alias="idempotency_key"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.USER, RoleEnum.MANAGER, RoleEnum.ADMIN, RoleEnum.OWNER})
    service = VisitService(db)
    try:
        return service.end_visit(
            tenant_id=_tenant_id(current_user),
            visit_id=payload.visit_id,
            checkout_lat=payload.checkout_lat,
            checkout_lng=payload.checkout_lng,
            checkout_photo_id=payload.checkout_photo_id,
            idempotency_key=idempotency_key,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/report/draft", response_model=schemas.DailyReportRead)
def save_report_draft(
    payload: schemas.DailyReportCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.USER, RoleEnum.MANAGER, RoleEnum.ADMIN, RoleEnum.OWNER})
    logger.warning(
        "reporting debug save_draft tenant=%s user=%s session_id=%s report_date=%s payload_keys=%s",
        _tenant_id(current_user),
        current_user.id,
        payload.session_id,
        payload.report_date,
        list(payload.payload.keys()),
    )
    service = ReportService(db)
    try:
        return service.save_draft(
            tenant_id=_tenant_id(current_user),
            employee_id=current_user.id,
            payload=payload,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/preview", response_model=schemas.ReportPreviewResponse)
@router.get("/report/preview", response_model=schemas.ReportPreviewResponse)
def preview_report(
    report_date: date = Query(alias="date"),
    include_open: bool = Query(default=True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.USER, RoleEnum.MANAGER, RoleEnum.ADMIN, RoleEnum.OWNER})
    logger.warning(
        "reporting debug preview tenant=%s user=%s report_date=%s",
        _tenant_id(current_user),
        current_user.id,
        report_date,
    )
    tenant_id = _tenant_id(current_user)
    task_service = TaskReportingService(db)
    tasks = task_service.collect_tasks_for_date(
        tenant_id=tenant_id,
        user_id=current_user.id,
        report_date=report_date,
        include_open=include_open,
    )
    session = (
        db.query(models.EmployeeDaySession)
        .filter_by(tenant_id=tenant_id, employee_id=current_user.id, report_date=report_date)
        .first()
    )
    snapshots = task_service.create_task_snapshots(
        tenant_id=tenant_id,
        session_id=session.id if session else None,
        user_id=current_user.id,
        report_date=report_date,
        tasks=tasks,
    )
    task_service.append_snapshot_events(
        tenant_id=tenant_id,
        session_id=session.id if session else None,
        user_id=current_user.id,
        report_date=report_date,
        snapshots=snapshots,
    )
    timeline = (
        db.query(models.ReportTimelineEvent)
        .filter_by(tenant_id=tenant_id, user_id=current_user.id, report_date=report_date)
        .order_by(models.ReportTimelineEvent.event_time.asc())
        .all()
    )
    draft_json = ReportGeneratorService(db).build_draft_json(timeline=timeline, snapshots=list(snapshots))
    return schemas.ReportPreviewResponse(
        report_date=report_date,
        timeline=timeline,
        task_snapshots=list(snapshots),
        draft_json=draft_json,
    )


@router.post("/manual-entry", response_model=schemas.ReportTimelineEventRead)
def create_manual_entry(
    payload: schemas.ManualEntryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.USER, RoleEnum.MANAGER, RoleEnum.ADMIN, RoleEnum.OWNER})
    tenant_id = _tenant_id(current_user)
    event_time = payload.event_time or datetime.utcnow()
    time_bucket = payload.time_bucket
    if not time_bucket:
        hour = event_time.hour
        time_bucket = "Morning" if hour < 12 else "Afternoon" if hour < 17 else "Evening"
    idempotency_key = f"manual-{current_user.id}-{payload.report_date}-{event_time.isoformat()}"
    event = models.ReportTimelineEvent(
        tenant_id=tenant_id,
        session_id=payload.session_id,
        user_id=current_user.id,
        report_date=payload.report_date,
        event_type="MANUAL_ENTRY",
        event_time=event_time,
        source="manual",
        payload_json={
            "note": payload.note,
            "related_task_id": payload.task_id,
            "time_bucket": time_bucket,
            "duration_minutes": payload.duration_minutes,
        },
        idempotency_key=idempotency_key,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.post("/webex/reply-webhook", response_model=schemas.ReportTimelineEventRead)
def webex_reply_webhook(
    payload: schemas.WebexReplyWebhook,
    db: Session = Depends(get_db),
):
    service = WebexCheckinService(db)
    if not payload.person_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="person_id is required")
    user = db.query(User).filter_by(webex_person_id=payload.person_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found for Webex person id")
    report_time = payload.reply_time or datetime.utcnow()
    report_date = report_time.date()

    correlation_id = payload.correlation_id
    if not correlation_id and payload.text:
        marker = "#ZEA_CHECKIN:"
        if marker in payload.text:
            correlation_id = payload.text.split(marker, 1)[1].strip().split()[0]

    checkin = None
    if correlation_id:
        checkin = (
            db.query(models.ReportCheckin)
            .filter_by(tenant_id=str(user.tenant_id), correlation_id=correlation_id)
            .first()
        )
    if not checkin:
        checkin = (
            db.query(models.ReportCheckin)
            .filter_by(tenant_id=str(user.tenant_id), user_id=user.id, report_date=report_date, reply_received=False)
            .order_by(models.ReportCheckin.slot_time.desc())
            .first()
        )

    correlation_id = correlation_id or (checkin.correlation_id if checkin else "unknown")
    event = service.record_reply(
        tenant_id=str(user.tenant_id),
        user_id=user.id,
        report_date=report_date,
        correlation_id=correlation_id,
        payload={
            "text": payload.text,
            "person_id": payload.person_id,
            "room_id": payload.room_id,
            "reply_time": report_time.isoformat(),
        },
        event_time=report_time,
        message_id=payload.message_id,
    )
    db.commit()
    db.refresh(event)
    return event


@router.post("/generate", response_model=schemas.GeneratedReportResponse)
def generate_report(
    payload: schemas.GenerateReportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.USER, RoleEnum.MANAGER, RoleEnum.ADMIN, RoleEnum.OWNER})
    tenant_id = _tenant_id(current_user)
    task_service = TaskReportingService(db)
    tasks = task_service.collect_tasks_for_date(
        tenant_id=tenant_id,
        user_id=current_user.id,
        report_date=payload.report_date,
        include_open=True,
    )
    session = (
        db.query(models.EmployeeDaySession)
        .filter_by(tenant_id=tenant_id, employee_id=current_user.id, report_date=payload.report_date)
        .first()
    )
    snapshots = task_service.create_task_snapshots(
        tenant_id=tenant_id,
        session_id=session.id if session else None,
        user_id=current_user.id,
        report_date=payload.report_date,
        tasks=tasks,
    )
    timeline = (
        db.query(models.ReportTimelineEvent)
        .filter_by(tenant_id=tenant_id, user_id=current_user.id, report_date=payload.report_date)
        .order_by(models.ReportTimelineEvent.event_time.asc())
        .all()
    )
    generator = ReportGeneratorService(db)
    draft_json = generator.build_draft_json(timeline=timeline, snapshots=list(snapshots))
    template = None
    if payload.template_id:
        template = db.query(models.ReportTemplate).filter_by(tenant_id=tenant_id, id=payload.template_id).first()
    title = payload.title or f"Daily Report - {payload.report_date}"
    rendered_html = generator.render_html(title=title, report_date=payload.report_date, draft_json=draft_json, template=template)

    report = (
        db.query(models.DailyReport)
        .filter_by(tenant_id=tenant_id, employee_id=current_user.id, report_date=payload.report_date)
        .first()
    )
    if not report:
        report = models.DailyReport(
            tenant_id=tenant_id,
            session_id=session.id if session else "",
            template_id=payload.template_id,
            employee_id=current_user.id,
            manager_id=current_user.manager_id,
            department_id=current_user.department_id,
            report_date=payload.report_date,
        )
    report.payload = draft_json
    report.rendered_html = rendered_html
    report.status = "generated"
    db.add(report)

    email_sent = False
    webex_sent = False
    if payload.send_email:
        email_recipient = current_user.manager_email or current_user.manager_id or ""
        db.add(
            models.ReportNotification(
                tenant_id=tenant_id,
                report_id=report.id,
                channel="email",
                recipient=email_recipient,
                idempotency_key=f"email-{report.id}",
                payload={"title": title},
            )
        )
        email_sent = True
    if payload.send_webex:
        webex_recipient = current_user.manager_id or ""
        db.add(
            models.ReportNotification(
                tenant_id=tenant_id,
                report_id=report.id,
                channel="webex",
                recipient=webex_recipient,
                idempotency_key=f"webex-{report.id}",
                payload={"title": title},
            )
        )
        webex_sent = True

    db.commit()
    db.refresh(report)

    return schemas.GeneratedReportResponse(
        report=report,
        export_url=f"/api/reporting/reports/{report.id}/export/pdf",
        email_sent=email_sent,
        webex_sent=webex_sent,
    )


@router.post("/automation/bootstrap-today")
def bootstrap_automation_today(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.ADMIN, RoleEnum.OWNER})
    scheduler = ReportingAutomationScheduler(db)
    return scheduler.bootstrap_today()


@router.get("/admin/email/config", response_model=schemas.EmailProviderConfigRead)
def get_email_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.ADMIN, RoleEnum.OWNER})
    tenant_id = _tenant_id(current_user)
    config = (
        db.query(models.EmailProviderConfig)
        .filter_by(tenant_id=tenant_id, is_active=True)
        .order_by(models.EmailProviderConfig.created_at.desc())
        .first()
    )
    if not config:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Email config not found")
    return config


@router.put("/admin/email/config", response_model=schemas.EmailProviderConfigRead)
def upsert_email_config(
    payload: schemas.EmailProviderConfigUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.ADMIN, RoleEnum.OWNER})
    tenant_id = _tenant_id(current_user)
    config = models.EmailProviderConfig(
        tenant_id=tenant_id,
        mode=payload.mode,
        smtp_host=payload.smtp_host,
        smtp_port=payload.smtp_port,
        smtp_user=payload.smtp_user,
        smtp_pass=payload.smtp_pass,
        smtp_tls=payload.smtp_tls,
        sendgrid_api_key=payload.sendgrid_api_key,
        from_email=payload.from_email,
        from_name=payload.from_name,
        is_active=payload.is_active,
    )
    db.add(config)
    db.commit()
    db.refresh(config)
    return config


@router.post("/admin/email/test")
def test_email_config(
    payload: schemas.EmailTestRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.ADMIN, RoleEnum.OWNER})
    tenant_id = _tenant_id(current_user)
    config = (
        db.query(models.EmailProviderConfig)
        .filter_by(tenant_id=tenant_id, is_active=True)
        .order_by(models.EmailProviderConfig.created_at.desc())
        .first()
    )
    if not config:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Email config not found")
    return {
        "status": "queued",
        "mode": config.mode,
        "to": payload.to_email,
        "subject": payload.subject or "ZeaPlay email test",
    }


@router.post("/report/submit", response_model=schemas.DailyReportRead)
def submit_report(
    payload: schemas.DailyReportCreate,
    idempotency_key: Optional[str] = Query(default=None, alias="idempotency_key"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.USER, RoleEnum.MANAGER, RoleEnum.ADMIN, RoleEnum.OWNER})
    service = ReportService(db)
    try:
        return service.submit_report(
            tenant_id=_tenant_id(current_user),
            employee_id=current_user.id,
            payload=payload,
            idempotency_key=idempotency_key,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/templates", response_model=list[schemas.ReportTemplateRead])
def list_templates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.MANAGER, RoleEnum.ADMIN, RoleEnum.OWNER})
    return TemplateService(db).list_templates(_tenant_id(current_user))


@router.post("/templates", response_model=schemas.ReportTemplateRead)
def create_template(
    payload: schemas.ReportTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.MANAGER, RoleEnum.ADMIN, RoleEnum.OWNER})
    return TemplateService(db).create_template(
        payload=payload,
        tenant_id=_tenant_id(current_user),
    )


@router.get("/templates/{template_id}", response_model=schemas.ReportTemplateRead)
def get_template(
    template_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.MANAGER, RoleEnum.ADMIN, RoleEnum.OWNER})
    template = TemplateService(db).get_template(_tenant_id(current_user), template_id)
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    return template


@router.put("/templates/{template_id}", response_model=schemas.ReportTemplateRead)
def update_template(
    template_id: str,
    payload: schemas.ReportTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.MANAGER, RoleEnum.ADMIN, RoleEnum.OWNER})
    template = TemplateService(db).update_template(
        tenant_id=_tenant_id(current_user),
        template_id=template_id,
        payload=payload,
    )
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    return template


@router.delete("/templates/{template_id}")
def delete_template(
    template_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.MANAGER, RoleEnum.ADMIN, RoleEnum.OWNER})
    TemplateService(db).delete_template(_tenant_id(current_user), template_id)
    return {"status": "ok"}


@router.post("/templates/{template_id}/publish", response_model=schemas.ReportTemplateRead)
def publish_template(
    template_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.MANAGER, RoleEnum.ADMIN, RoleEnum.OWNER})
    template = TemplateService(db).publish_template(
        _tenant_id(current_user),
        template_id,
        actor_id=current_user.id,
    )
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    return template


@router.get("/manager/team-status", response_model=list[schemas.TeamStatusRead])
def manager_team_status(
    report_date: date = Query(alias="date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.MANAGER, RoleEnum.ADMIN, RoleEnum.OWNER})
    return ReportService(db).get_team_status(
        tenant_id=_tenant_id(current_user),
        report_date=report_date,
        manager_id=current_user.id,
        department_id=current_user.department_id,
    )


@router.get("/manager/reports", response_model=list[schemas.DailyReportRead])
def manager_reports(
    report_date: Optional[date] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.MANAGER, RoleEnum.ADMIN, RoleEnum.OWNER})
    return ReportService(db).get_manager_reports(
        tenant_id=_tenant_id(current_user),
        report_date=report_date,
        manager_id=current_user.id,
        status=status_filter,
    )


@router.post("/reports/{report_id}/comments", response_model=schemas.ReportCommentRead)
def add_report_comment(
    report_id: str,
    payload: schemas.ReportCommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.MANAGER, RoleEnum.ADMIN, RoleEnum.OWNER})
    return ReportService(db).add_comment(
        tenant_id=_tenant_id(current_user),
        report_id=report_id,
        manager_id=current_user.id,
        comment=payload.comment,
    )


@router.get("/reports/{report_id}/export/html")
def export_report_html(
    report_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.MANAGER, RoleEnum.ADMIN, RoleEnum.OWNER})
    report = ReportService(db).get_report(_tenant_id(current_user), report_id)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    return {"html": report.rendered_html or ""}


@router.get("/reports/{report_id}/export/csv")
def export_report_csv(
    report_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.MANAGER, RoleEnum.ADMIN, RoleEnum.OWNER})
    report = ReportService(db).get_report(_tenant_id(current_user), report_id)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    csv_data = ReportGeneratorService(db).build_csv(report.payload or {})
    return {"csv": csv_data}


@router.get("/reports/{report_id}/export/pdf")
def export_report_pdf(
    report_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    _require_roles(current_user, {RoleEnum.MANAGER, RoleEnum.ADMIN, RoleEnum.OWNER})
    report = ReportService(db).get_report(_tenant_id(current_user), report_id)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    return {"status": "pending", "message": "PDF export will be available soon."}
