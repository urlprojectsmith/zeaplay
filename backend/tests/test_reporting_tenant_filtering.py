import uuid
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.database import Base
import backend.app.reporting.models  # noqa: F401
import backend.app.reporting.models as reporting_models
from backend.app.reporting.services.report_service import ReportService


SQLALCHEMY_DATABASE_URL = "sqlite:///./test_reporting_tenant_filtering.db"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)


def _new_session():
    return TestingSessionLocal()


def test_manager_reports_tenant_filter():
    db = _new_session()
    try:
        tenant_a = str(uuid.uuid4())
        tenant_b = str(uuid.uuid4())
        report_date = date.today()

        report_a = reporting_models.DailyReport(
            tenant_id=tenant_a,
            session_id="session-a",
            employee_id="emp-a",
            manager_id="mgr-a",
            department_id="dept-a",
            report_date=report_date,
            status="submitted",
            payload={},
        )
        report_b = reporting_models.DailyReport(
            tenant_id=tenant_b,
            session_id="session-b",
            employee_id="emp-b",
            manager_id="mgr-b",
            department_id="dept-b",
            report_date=report_date,
            status="submitted",
            payload={},
        )
        db.add(report_a)
        db.add(report_b)
        db.commit()

        service = ReportService(db)
        reports = service.get_manager_reports(tenant_id=tenant_a, report_date=report_date, manager_id=None, status=None)
        assert all(report.tenant_id == tenant_a for report in reports)
    finally:
        db.close()
