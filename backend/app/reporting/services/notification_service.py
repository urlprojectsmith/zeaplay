from typing import Optional

from sqlalchemy.orm import Session

from .. import models, schemas
from ..utils.idempotency import IdempotencyStore
from ..utils.tenancy import apply_tenant_scope


class NotificationService:
    def __init__(self, db: Session, idempotency_store: Optional[IdempotencyStore] = None):
        self.db = db
        self.idempotency_store = idempotency_store or IdempotencyStore()

    def list_notifications(self, tenant_id: str) -> list[models.ReportNotification]:
        query = self.db.query(models.ReportNotification)
        return apply_tenant_scope(query, tenant_id).all()

    def create_notification(self, payload: schemas.ReportNotificationCreate) -> models.ReportNotification:
        existing = (
            self.db.query(models.ReportNotification)
            .filter_by(tenant_id=payload.tenant_id, idempotency_key=payload.idempotency_key)
            .first()
        )
        if existing:
            return existing
        if self.idempotency_store.was_processed(payload.idempotency_key):
            return (
                self.db.query(models.ReportNotification)
                .filter_by(tenant_id=payload.tenant_id, idempotency_key=payload.idempotency_key)
                .first()
            )
        notification = models.ReportNotification(**payload.dict())
        self.db.add(notification)
        self.db.commit()
        self.db.refresh(notification)
        self.idempotency_store.mark_processed(payload.idempotency_key)
        return notification
