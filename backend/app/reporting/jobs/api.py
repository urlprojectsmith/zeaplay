from datetime import datetime, date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ...database import get_db
from ...dependencies import get_current_admin
from ...models import User
from .logic import (
    ReportingJobConfig,
    run_eod_nudge,
    run_escalations,
    run_hourly_slot_enforcement,
    run_weekly_summary,
)

router = APIRouter(prefix="/reporting/jobs", tags=["reporting-jobs"])


def _resolve_now(now: Optional[datetime]) -> datetime:
    return now or datetime.utcnow()


@router.post("/hourly-slot-enforcement")
def hourly_slot_enforcement(
    now: Optional[datetime] = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    config = ReportingJobConfig()
    return run_hourly_slot_enforcement(db, _resolve_now(now), config)


@router.post("/escalations")
def escalations(
    now: Optional[datetime] = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    config = ReportingJobConfig()
    return run_escalations(db, _resolve_now(now), config)


@router.post("/eod-nudge")
def eod_nudge(
    now: Optional[datetime] = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    config = ReportingJobConfig()
    return run_eod_nudge(db, _resolve_now(now), config)


@router.post("/weekly-summary")
def weekly_summary(
    week_start: date = Query(...),
    week_end: date = Query(...),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    return run_weekly_summary(db, week_start, week_end)
