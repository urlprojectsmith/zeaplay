from datetime import date, datetime
from typing import Optional

from sqlalchemy.orm import Session

from .. import models, schemas
from ..utils.tenancy import apply_tenant_scope


class VisitService:
    def __init__(self, db: Session):
        self.db = db

    def list_visits(self, tenant_id: str) -> list[models.SalesVisit]:
        query = self.db.query(models.SalesVisit)
        return apply_tenant_scope(query, tenant_id).all()

    def start_visit(
        self,
        *,
        tenant_id: str,
        payload: schemas.SalesVisitCreate,
        employee_id: str,
        idempotency_key: Optional[str],
    ) -> models.SalesVisit:
        if idempotency_key and self._idempotent_event_exists("visit_start", idempotency_key, tenant_id):
            existing = (
                self.db.query(models.SalesVisit)
                .filter_by(tenant_id=tenant_id, employee_id=employee_id, session_id=payload.session_id)
                .order_by(models.SalesVisit.created_at.desc())
                .first()
            )
            if existing:
                return existing
        existing_open = (
            self.db.query(models.SalesVisit)
            .filter_by(
                tenant_id=tenant_id,
                employee_id=employee_id,
                session_id=payload.session_id,
                checkout_at=None,
            )
            .first()
        )
        if existing_open:
            raise ValueError("Active visit already exists.")
        visit = models.SalesVisit(
            tenant_id=tenant_id,
            session_id=payload.session_id,
            employee_id=employee_id,
            manager_id=payload.manager_id,
            department_id=payload.department_id,
            location_name=payload.location_name,
            checkin_at=payload.checkin_at or datetime.utcnow(),
            checkin_lat=payload.checkin_lat,
            checkin_lng=payload.checkin_lng,
            checkin_photo_id=payload.checkin_photo_id,
            notes=payload.notes,
        )
        self.db.add(visit)
        self.db.flush()
        self._record_timeline_event(
            tenant_id=tenant_id,
            session_id=payload.session_id,
            user_id=employee_id,
            report_date=visit.checkin_at.date(),
            event_type="SALES_VISIT_START",
            event_time=visit.checkin_at,
            source="sales",
            payload={
                "related_visit_id": visit.id,
                "location": visit.location_name,
                "start_time": visit.checkin_at.isoformat(),
            },
            idempotency_key=f"visit-start-{visit.id}",
        )
        self._record_event(
            tenant_id=tenant_id,
            event_type="visit_start",
            entity_type="sales_visit",
            entity_id=visit.id,
            actor_id=employee_id,
            idempotency_key=idempotency_key,
        )
        self.db.commit()
        self.db.refresh(visit)
        return visit

    def end_visit(
        self,
        *,
        tenant_id: str,
        visit_id: str,
        checkout_lat: Optional[str],
        checkout_lng: Optional[str],
        checkout_photo_id: Optional[str],
        idempotency_key: Optional[str],
    ) -> models.SalesVisit:
        if idempotency_key and self._idempotent_event_exists("visit_end", idempotency_key, tenant_id):
            existing = (
                self.db.query(models.SalesVisit)
                .filter_by(tenant_id=tenant_id, id=visit_id)
                .first()
            )
            if existing:
                return existing
        visit = (
            self.db.query(models.SalesVisit)
            .filter_by(tenant_id=tenant_id, id=visit_id)
            .first()
        )
        if not visit:
            raise ValueError("Visit not found.")
        if visit.checkout_at:
            raise ValueError("Visit already completed.")
        visit.checkout_at = datetime.utcnow()
        visit.checkout_lat = checkout_lat
        visit.checkout_lng = checkout_lng
        visit.checkout_photo_id = checkout_photo_id
        self.db.add(visit)
        self.db.flush()
        self._record_timeline_event(
            tenant_id=tenant_id,
            session_id=visit.session_id,
            user_id=visit.employee_id,
            report_date=visit.checkout_at.date(),
            event_type="SALES_VISIT_STOP",
            event_time=visit.checkout_at,
            source="sales",
            payload={
                "related_visit_id": visit.id,
                "start_time": visit.checkin_at.isoformat() if visit.checkin_at else None,
                "end_time": visit.checkout_at.isoformat(),
                "duration_minutes": int(
                    ((visit.checkout_at - visit.checkin_at).total_seconds() / 60) if visit.checkin_at else 0
                ),
            },
            idempotency_key=f"visit-stop-{visit.id}",
        )
        self._record_event(
            tenant_id=tenant_id,
            event_type="visit_end",
            entity_type="sales_visit",
            entity_id=visit.id,
            actor_id=visit.employee_id,
            idempotency_key=idempotency_key,
        )
        self.db.commit()
        self.db.refresh(visit)
        return visit

    def _record_event(
        self,
        *,
        tenant_id: str,
        event_type: str,
        entity_type: str,
        entity_id: str,
        actor_id: Optional[str],
        idempotency_key: Optional[str],
    ) -> None:
        metadata = {}
        if idempotency_key:
            metadata["idempotency_key"] = idempotency_key
        self.db.add(
            models.AuditEvent(
                tenant_id=tenant_id,
                event_type=event_type,
                entity_type=entity_type,
                entity_id=entity_id,
                actor_id=actor_id,
                metadata_payload=metadata,
            )
        )

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
