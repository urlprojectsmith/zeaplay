from dataclasses import dataclass


@dataclass
class ScheduledJob:
    name: str
    cron: str
    enabled: bool = True


class JobScheduler:
    """Placeholder scheduler for reporting jobs."""

    def register(self, job: ScheduledJob) -> None:
        return None

    def run_due_jobs(self) -> None:
        return None
