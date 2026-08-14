import os
from dataclasses import dataclass


@dataclass(frozen=True)
class ReportingEmailConfig:
    sender: str = os.getenv("REPORTING_EMAIL_SENDER", "reports@zeaplay.local")
    enabled: bool = os.getenv("REPORTING_EMAIL_ENABLED", "false").lower() == "true"


@dataclass(frozen=True)
class ReportingWebexConfig:
    bot_token: str = os.getenv("REPORTING_WEBEX_BOT_TOKEN", "")
    enabled: bool = os.getenv("REPORTING_WEBEX_ENABLED", "false").lower() == "true"


@dataclass(frozen=True)
class ReportingIntegrationsConfig:
    email: ReportingEmailConfig = ReportingEmailConfig()
    webex: ReportingWebexConfig = ReportingWebexConfig()
