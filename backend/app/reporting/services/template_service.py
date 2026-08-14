from datetime import datetime

from sqlalchemy.orm import Session

from .. import models, schemas
from ..utils.tenancy import apply_tenant_scope


class TemplateService:
    def __init__(self, db: Session):
        self.db = db

    def list_templates(self, tenant_id: str) -> list[models.ReportTemplate]:
        query = self.db.query(models.ReportTemplate)
        query = apply_tenant_scope(query, tenant_id)
        return query.filter(models.ReportTemplate.deleted_at.is_(None)).all()

    def create_template(self, *, payload: schemas.ReportTemplateCreate, tenant_id: str) -> models.ReportTemplate:
        template = models.ReportTemplate(
            tenant_id=tenant_id,
            name=payload.name,
            description=payload.description,
            department_id=payload.department_id,
            is_global=payload.is_global,
            config=payload.config,
        )
        self.db.add(template)
        self.db.commit()
        self.db.refresh(template)
        return template

    def get_template(self, tenant_id: str, template_id: str) -> models.ReportTemplate | None:
        return (
            self.db.query(models.ReportTemplate)
            .filter_by(tenant_id=tenant_id, id=template_id)
            .first()
        )

    def update_template(
        self,
        *,
        tenant_id: str,
        template_id: str,
        payload: schemas.ReportTemplateCreate,
    ) -> models.ReportTemplate | None:
        template = self.get_template(tenant_id, template_id)
        if not template:
            return None
        template.name = payload.name
        template.description = payload.description
        template.department_id = payload.department_id
        template.is_global = payload.is_global
        template.config = payload.config
        self.db.add(template)
        self.db.commit()
        self.db.refresh(template)
        return template

    def delete_template(self, tenant_id: str, template_id: str) -> None:
        template = self.get_template(tenant_id, template_id)
        if not template:
            return None
        template.deleted_at = datetime.utcnow()
        template.is_active = False
        self.db.add(template)
        self.db.commit()

    def publish_template(
        self,
        tenant_id: str,
        template_id: str,
        actor_id: str,
    ) -> models.ReportTemplate | None:
        template = self.get_template(tenant_id, template_id)
        if not template:
            return None
        template.published_at = datetime.utcnow()
        template.version += 1
        template.is_active = True
        self.db.add(template)
        self.db.add(
            models.AuditEvent(
                tenant_id=tenant_id,
                event_type="template_publish",
                entity_type="report_template",
                entity_id=template.id,
                actor_id=actor_id,
                metadata_payload={},
            )
        )
        self.db.commit()
        self.db.refresh(template)
        return template
