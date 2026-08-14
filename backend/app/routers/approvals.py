from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..notifiers import get_notifier
from ..database import get_db
from ..dependencies import get_current_active_user
from ..services import notifications as notification_service
from ..tickets.models import Ticket


router = APIRouter(prefix="/me", tags=["approvals"])


@router.get("/approvals", response_model=list[schemas.ApprovalInboxItem])
def list_my_approvals(
    status_filter: Optional[str] = Query(default="pending", alias="status"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
) -> list[schemas.ApprovalInboxItem]:
    stmt = select(models.Approval).where(models.Approval.approver_id == current_user.id)
    if status_filter and status_filter.lower() != "all":
        try:
            status_value = models.ApprovalStatusEnum(status_filter.lower())
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid status filter") from exc
        stmt = stmt.where(models.Approval.status == status_value)

    approvals = db.execute(stmt.order_by(models.Approval.created_at.desc())).scalars().all()
    now = datetime.utcnow()
    results: list[schemas.ApprovalInboxItem] = []
    sla_notifications_created = False

    for approval in approvals:
        scope: dict = {}
        deep_link: Optional[str] = None
        if approval.scope_type == models.ApprovalScopeTypeEnum.TICKET:
            ticket = db.execute(
                select(Ticket).where(Ticket.id == approval.scope_id)
            ).scalar_one_or_none()
            if ticket:
                scope = {
                    "ticket_id": str(ticket.id),
                    "title": ticket.title,
                    "status": ticket.status.value,
                    "priority": ticket.priority.value,
                }
                deep_link = f"/tickets/{ticket.id}"
                if (
                    approval.status == models.ApprovalStatusEnum.PENDING
                    and approval.created_at
                    and approval.sla_hours
                    and approval.created_at + timedelta(hours=approval.sla_hours) < now
                ):
                    recipients = {ticket.created_by, ticket.owner_id}
                    recipients.discard(None)
                    owner_ids = db.execute(
                        select(models.User.id).where(models.User.role == models.RoleEnum.OWNER)
                    ).scalars().all()
                    recipients.update(owner_ids)
                    creator = db.get(models.User, ticket.created_by)
                    if creator and creator.manager_id:
                        recipients.add(creator.manager_id)
                    existing = set(
                        db.execute(
                            select(models.Notification.user_id).where(
                                models.Notification.type == models.NotificationTypeEnum.SLA_BREACH,
                                models.Notification.entity_type == models.NotificationEntityTypeEnum.APPROVAL,
                                models.Notification.entity_id == str(approval.id),
                                models.Notification.user_id.in_(list(recipients)),
                            )
                        ).scalars().all()
                    )
                    for recipient_id in recipients:
                        if recipient_id in existing:
                            continue
                        notification_service.create_notification(
                            db,
                            user_id=str(recipient_id),
                            notification_type=models.NotificationTypeEnum.SLA_BREACH,
                            message=f"Approval SLA breached for ticket '{ticket.title}'.",
                            title="Approval SLA breach",
                            body=f"Approval for ticket '{ticket.title}' exceeded SLA.",
                            entity_type=models.NotificationEntityTypeEnum.APPROVAL,
                            entity_id=str(approval.id),
                            deep_link=f"/tickets/{ticket.id}",
                        )
                        sla_notifications_created = True
        elif approval.scope_type == models.ApprovalScopeTypeEnum.TASK:
            task = db.get(models.Task, approval.scope_id)
            if task:
                scope = {
                    "task_id": str(task.id),
                    "title": task.title,
                    "status": task.status.value,
                    "due_at": task.due_at.isoformat() if task.due_at else None,
                }
                deep_link = f"/tasks/{task.id}"
        elif approval.scope_type == models.ApprovalScopeTypeEnum.OVERRIDE_CLOSE:
            ticket = db.execute(
                select(Ticket).where(Ticket.id == approval.scope_id)
            ).scalar_one_or_none()
            if ticket:
                scope = {
                    "ticket_id": str(ticket.id),
                    "title": ticket.title,
                    "status": ticket.status.value,
                }
                deep_link = f"/tickets/{ticket.id}"

        sla_remaining = None
        if approval.created_at and approval.sla_hours:
            deadline = approval.created_at + timedelta(hours=approval.sla_hours)
            sla_remaining = max(0.0, (deadline - now).total_seconds() / 3600)

        results.append(
            schemas.ApprovalInboxItem(
                id=str(approval.id),
                scope_type=approval.scope_type,
                scope_id=str(approval.scope_id),
                status=approval.status,
                order_index=approval.order_index,
                requested_by=str(approval.requested_by),
                approver_id=str(approval.approver_id) if approval.approver_id else None,
                comment=approval.comment,
                sla_hours=approval.sla_hours,
                created_at=approval.created_at,
                acted_at=approval.acted_at,
                sla_remaining_hours=sla_remaining,
                deep_link=deep_link,
                scope=scope,
            )
        )

    if sla_notifications_created:
        get_notifier().send_webex_message("Approval SLA breach detected.")
        db.commit()

    return results
