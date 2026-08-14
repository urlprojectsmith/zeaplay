from __future__ import annotations

from datetime import date
from typing import Any, Optional

from sqlalchemy.orm import Session

from .. import models


class ReportGeneratorService:
    def __init__(self, db: Session):
        self.db = db

    def build_draft_json(
        self,
        *,
        timeline: list[models.ReportTimelineEvent],
        snapshots: list[models.ReportTaskSnapshot],
    ) -> dict[str, Any]:
        timeline_sorted = sorted(timeline, key=lambda item: item.event_time)
        snapshot_map = {snap.task_id: snap.snapshot_json for snap in snapshots}
        completed_tasks: list[dict[str, Any]] = []
        manual_entries: list[dict[str, Any]] = []
        visits: list[dict[str, Any]] = []
        table_rows: list[dict[str, Any]] = []

        for event in timeline_sorted:
            payload = event.payload_json or {}
            if event.event_type == "TASK_COMPLETED":
                completed_tasks.append(payload)
            if event.event_type == "MANUAL_ENTRY":
                manual_entries.append(payload)
            if event.event_type in {"SALES_VISIT_START", "SALES_VISIT_STOP"}:
                visits.append(payload)
            table_rows.append(
                {
                    "event_type": event.event_type,
                    "time": event.event_time.isoformat(),
                    "time_bucket": payload.get("time_bucket"),
                    "title": payload.get("title") or payload.get("note") or payload.get("location"),
                    "status": payload.get("status"),
                    "duration_minutes": payload.get("duration_minutes"),
                    "related_task_id": payload.get("related_task_id"),
                    "related_visit_id": payload.get("related_visit_id"),
                }
            )

        open_tasks = [
            snapshot
            for snapshot in snapshot_map.values()
            if snapshot.get("status") not in {"DONE", "FAILED", "GRAVEYARD"}
        ]

        return {
            "timeline": [
                {
                    "event_type": event.event_type,
                    "event_time": event.event_time.isoformat(),
                    "source": event.source,
                    "payload": event.payload_json or {},
                }
                for event in timeline_sorted
            ],
            "open_tasks": open_tasks,
            "completed_tasks": completed_tasks,
            "manual_entries": manual_entries,
            "visits": visits,
            "table_rows": table_rows,
        }

    def render_html(
        self,
        *,
        title: str,
        report_date: date,
        draft_json: dict[str, Any],
        template: Optional[models.ReportTemplate] = None,
    ) -> str:
        header = f"<h1>{title}</h1><p>Date: {report_date}</p>"
        sections = []
        rows = draft_json.get("table_rows", [])
        table_html = self._render_table(rows)
        sections.append(table_html)
        if template and isinstance(template.config, dict):
            shell = template.config.get("html_shell")
            css = template.config.get("css") or ""
            if shell:
                return shell.format(
                    title=title,
                    report_date=report_date,
                    content=table_html,
                    css=css,
                )
        return "<div>" + header + "".join(sections) + "</div>"

    @staticmethod
    def _render_section(title: str, items: list[dict[str, Any]]) -> str:
        if not items:
            return f"<h2>{title}</h2><p>No entries.</p>"
        rows = "".join(f"<li>{item}</li>" for item in items)
        return f"<h2>{title}</h2><ul>{rows}</ul>"

    @staticmethod
    def _render_table(rows: list[dict[str, Any]]) -> str:
        if not rows:
            return "<h2>Timeline</h2><p>No entries.</p>"
        header = "<tr><th>Time</th><th>Type</th><th>Title</th><th>Status</th><th>Duration</th></tr>"
        body = "".join(
            "<tr>"
            f"<td>{row.get('time')}</td>"
            f"<td>{row.get('event_type')}</td>"
            f"<td>{row.get('title') or ''}</td>"
            f"<td>{row.get('status') or ''}</td>"
            f"<td>{row.get('duration_minutes') or ''}</td>"
            "</tr>"
            for row in rows
        )
        return f"<table>{header}{body}</table>"

    @staticmethod
    def build_csv(draft_json: dict[str, Any]) -> str:
        rows = draft_json.get("table_rows", [])
        headers = ["time", "event_type", "title", "status", "duration_minutes", "time_bucket"]
        lines = [",".join(headers)]
        for row in rows:
            line = ",".join(
                str(row.get(key, "") or "").replace(",", " ") for key in headers
            )
            lines.append(line)
        return "\n".join(lines)
