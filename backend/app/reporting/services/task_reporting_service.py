from __future__ import annotations

from datetime import date, datetime, time
from typing import Iterable, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ...models import Task, TaskStatusEnum
from .. import models
from ..utils.idempotency import build_idempotency_key


COMPLETED_STATUSES = {
    TaskStatusEnum.DONE,
    TaskStatusEnum.FAILED,
    TaskStatusEnum.GRAVEYARD,
}


class TaskReportingService:
    def __init__(self, db: Session):
        self.db = db

    def collect_tasks_for_date(
        self,
        *,
        tenant_id: str,
        user_id: str,
        report_date: date,
        include_open: bool = True,
    ) -> list[Task]:
        start, end = self._day_bounds(report_date)
        base_query = (
            self.db.query(Task)
            .filter(or_(Task.created_by_id == user_id, Task.assigned_to_id == user_id))
        )
        dated_filters = or_(
            Task.created_at.between(start, end),
            Task.updated_at.between(start, end),
            Task.due_at.between(start, end),
            Task.completed_at.between(start, end),
            Task.assigned_at.between(start, end),
        )
        query = base_query.filter(dated_filters)

        tasks = query.all()
        if include_open:
            open_tasks = (
                base_query.filter(Task.status.notin_(list(COMPLETED_STATUSES)))
                .all()
            )
            tasks = list({task.id: task for task in tasks + open_tasks}.values())
        return tasks

    def create_task_snapshots(
        self,
        *,
        tenant_id: str,
        session_id: Optional[str],
        user_id: str,
        report_date: date,
        tasks: Iterable[Task],
    ) -> list[models.ReportTaskSnapshot]:
        snapshots: list[models.ReportTaskSnapshot] = []
        for task in tasks:
            existing = (
                self.db.query(models.ReportTaskSnapshot)
                .filter_by(tenant_id=tenant_id, report_date=report_date, task_id=task.id)
                .first()
            )
            if existing:
                snapshots.append(existing)
                continue
            snapshot = models.ReportTaskSnapshot(
                tenant_id=tenant_id,
                session_id=session_id,
                user_id=user_id,
                report_date=report_date,
                task_id=task.id,
                snapshot_json=self._snapshot_payload(task),
            )
            self.db.add(snapshot)
            snapshots.append(snapshot)
        self.db.flush()
        return snapshots

    def append_snapshot_events(
        self,
        *,
        tenant_id: str,
        session_id: Optional[str],
        user_id: str,
        report_date: date,
        snapshots: Iterable[models.ReportTaskSnapshot],
    ) -> None:
        for snapshot in snapshots:
            key = build_idempotency_key("task_snapshot", str(snapshot.task_id), str(report_date)).key
            if self._timeline_exists(tenant_id, key):
                continue
            event = models.ReportTimelineEvent(
                tenant_id=tenant_id,
                session_id=session_id,
                user_id=user_id,
                report_date=report_date,
                event_type="TASK_SNAPSHOT",
                event_time=datetime.utcnow(),
                source="task",
                payload_json={
                    "related_task_id": snapshot.task_id,
                    "snapshot": snapshot.snapshot_json,
                    "title": snapshot.snapshot_json.get("title"),
                    "status": snapshot.snapshot_json.get("status"),
                },
                idempotency_key=key,
            )
            self.db.add(event)
        self.db.flush()

    def handle_task_completion(
        self,
        *,
        tenant_id: str,
        user_id: str,
        task: Task,
    ) -> None:
        if not task.completed_at:
            return
        target_user_id = task.assigned_to_id or task.created_by_id or user_id
        report_date = task.completed_at.date()
        key = build_idempotency_key("task_completed", task.id, str(report_date), target_user_id).key
        if self._timeline_exists(tenant_id, key):
            return
        event = models.ReportTimelineEvent(
            tenant_id=tenant_id,
            session_id=None,
            user_id=target_user_id,
            report_date=report_date,
            event_type="TASK_COMPLETED",
            event_time=task.completed_at,
            source="task",
            payload_json={
                **self._snapshot_payload(task),
                "related_task_id": task.id,
                "time_bucket": _time_bucket(task.completed_at),
            },
            idempotency_key=key,
        )
        self.db.add(event)

    def _timeline_exists(self, tenant_id: str, idempotency_key: str) -> bool:
        return (
            self.db.query(models.ReportTimelineEvent)
            .filter_by(tenant_id=tenant_id, idempotency_key=idempotency_key)
            .first()
            is not None
        )

    @staticmethod
    def _day_bounds(report_date: date) -> tuple[datetime, datetime]:
        start = datetime.combine(report_date, time.min)
        end = datetime.combine(report_date, time.max)
        return start, end

    @staticmethod
    def _snapshot_payload(task: Task) -> dict:
        return {
            "id": task.id,
            "title": task.title,
            "description": task.description,
            "status": getattr(task.status, "value", task.status),
            "priority": getattr(task.priority, "value", task.priority),
            "team": task.team,
            "assigned_to_id": task.assigned_to_id,
            "created_by_id": task.created_by_id,
            "task_group_id": task.task_group_id,
            "due_at": task.due_at.isoformat() if task.due_at else None,
            "assigned_at": task.assigned_at.isoformat() if task.assigned_at else None,
            "completed_at": task.completed_at.isoformat() if task.completed_at else None,
            "created_at": task.created_at.isoformat() if task.created_at else None,
            "updated_at": task.updated_at.isoformat() if task.updated_at else None,
            "tags": list(task.tags or []),
        }


def _time_bucket(timestamp: datetime) -> str:
    hour = timestamp.time().hour
    if hour < 12:
        return "Morning"
    if hour < 17:
        return "Afternoon"
    return "Evening"
