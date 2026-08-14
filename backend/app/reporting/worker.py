import os
import time
from datetime import datetime

from sqlalchemy.orm import Session

from ..database import SessionLocal
from .services.automation_scheduler import ReportingAutomationScheduler


POLL_INTERVAL_SECONDS = int(os.getenv("REPORTING_WORKER_INTERVAL", "60"))


def run_worker() -> None:
    while True:
        db: Session = SessionLocal()
        try:
            scheduler = ReportingAutomationScheduler(db)
            scheduler.bootstrap_today(now=datetime.utcnow())
        finally:
            db.close()
        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    run_worker()
