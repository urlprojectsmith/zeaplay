from typing import Any, Optional

from ... import models
from ...services import audit_logger


def record_reporting_audit_event(
    *,
    tenant_id: str,
    actor_id: Optional[str],
    action: str,
    metadata: Optional[dict[str, Any]] = None,
) -> None:
    """Basic audit logging wrapper for reporting actions."""
    audit_logger.log_event(
        audit_logger.AuditLogInput(
            action=action,
            category=models.AuditLogCategoryEnum.SYSTEM,
            actor_id=actor_id,
            entity_type="tenant",
            entity_id=tenant_id,
            metadata=metadata or {},
        )
    )
