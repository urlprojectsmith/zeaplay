def test_reporting_module_imports():
    from app.reporting import api, models, schemas

    assert api.router.prefix == "/reporting"
    assert hasattr(models, "Report")
    assert hasattr(schemas, "ReportCreate")
