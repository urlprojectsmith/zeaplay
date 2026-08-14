import React, { useCallback, useMemo, useState } from 'react';
import api from '../services/mockApi';
import {
  Role,
  DailyReport,
  ReportTemplate,
  ReportComment,
  TeamStatus,
  ReportingSession,
  SalesVisit,
  ReportPreviewResponse,
  GeneratedReportResponse,
} from '../types';
import { useAuth } from '../hooks/useAuth';
import { formatDate } from '../utils';

type TabKey =
  | 'myDay'
  | 'preview'
  | 'history'
  | 'teamStatus'
  | 'viewer'
  | 'templateBuilder'
  | 'templateList';

const Reporting: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>('myDay');
  const [statusMessage, setStatusMessage] = useState('');

  const [session, setSession] = useState<ReportingSession | null>(null);
  const [reportDate, setReportDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [slotHour, setSlotHour] = useState<number>(new Date().getHours());
  const [slotNote, setSlotNote] = useState('');
  const [visitLocation, setVisitLocation] = useState('');
  const [visitId, setVisitId] = useState('');
  const [visitLog, setVisitLog] = useState<SalesVisit[]>([]);

  const [draftPayload, setDraftPayload] = useState('');
  const [previewData, setPreviewData] = useState<ReportPreviewResponse | null>(null);
  const [generatedReport, setGeneratedReport] = useState<GeneratedReportResponse | null>(null);
  const [manualNote, setManualNote] = useState('');
  const [manualTaskId, setManualTaskId] = useState<string | null>(null);
  const [manualTime, setManualTime] = useState('');
  const [manualDuration, setManualDuration] = useState<number | ''>('');
  const [manualBucket, setManualBucket] = useState('');
  const [reportTitle, setReportTitle] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [sendEmail, setSendEmail] = useState(false);
  const [sendWebex, setSendWebex] = useState(false);
  const [includeOpenTasks, setIncludeOpenTasks] = useState(true);
  const [historyReports, setHistoryReports] = useState<DailyReport[]>([]);

  const [teamStatusDate, setTeamStatusDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [teamStatus, setTeamStatus] = useState<TeamStatus[]>([]);

  const [managerReports, setManagerReports] = useState<DailyReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<DailyReport | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentLog, setCommentLog] = useState<ReportComment[]>([]);

  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateDepartment, setTemplateDepartment] = useState('');
  const [templateIsGlobal, setTemplateIsGlobal] = useState(false);
  const [templateHtmlShell, setTemplateHtmlShell] = useState('');
  const [templateCss, setTemplateCss] = useState('');
  const [templateColumns, setTemplateColumns] = useState('time,event_type,title,status,duration_minutes');
  const [templateEventTypes, setTemplateEventTypes] = useState('TASK_SNAPSHOT,TASK_COMPLETED,MANUAL_ENTRY,WEBEX_REPLY,SALES_VISIT_START,SALES_VISIT_STOP,SESSION_OPEN,SESSION_CLOSE');
  const [templateSections, setTemplateSections] = useState<Array<{ title: string; fields: string[] }>>([
    { title: 'Summary', fields: ['Highlights'] },
  ]);

  const isManager = user?.role === Role.MANAGER || user?.role === Role.ADMIN || user?.role === Role.OWNER;
  const isAdmin = user?.role === Role.ADMIN || user?.role === Role.OWNER;
  const isSales =
    (user?.department ?? '').toLowerCase().includes('sales') ||
    (user?.title ?? '').toLowerCase().includes('sales');

  const tabs = useMemo(() => {
    const list: { key: TabKey; label: string; show: boolean }[] = [
      { key: 'myDay', label: 'My Day', show: true },
      { key: 'preview', label: 'Report Preview', show: true },
      { key: 'history', label: 'History', show: true },
      { key: 'teamStatus', label: 'Team Status', show: isManager },
      { key: 'viewer', label: 'Report Viewer', show: isManager },
      { key: 'templateBuilder', label: 'Template Builder', show: isAdmin },
      { key: 'templateList', label: 'Template List', show: isAdmin },
    ];
    return list.filter((tab) => tab.show);
  }, [isManager, isAdmin]);

  const buttonClass =
    'rounded-lg border border-border-color bg-surface px-4 py-2 text-sm font-semibold text-text-primary transition hover:border-primary';
  const panelClass = 'rounded-2xl border border-border-color bg-surface p-6 space-y-4';

  const timeline = previewData?.timeline ?? [];
  const taskSnapshots = previewData?.task_snapshots ?? [];
  const completedCount = timeline.filter((event) => event.event_type === 'TASK_COMPLETED').length;
  const totalTasksCount = taskSnapshots.length;
  const visitsCount = timeline.filter((event) => event.event_type === 'SALES_VISIT_STOP').length;
  const visitRunning =
    timeline.filter((event) => event.event_type === 'SALES_VISIT_START').length >
    timeline.filter((event) => event.event_type === 'SALES_VISIT_STOP').length;
  const nextCheckin = useMemo(() => {
    const now = new Date();
    const upcoming = timeline
      .filter((event) => event.event_type === 'WEBEX_CHECKIN' && event.payload['scheduled_for'])
      .map((event) => ({ ...event, scheduled: new Date(event.payload['scheduled_for'] as string) }))
      .filter((event) => event.scheduled > now)
      .sort((a, b) => a.scheduled.getTime() - b.scheduled.getTime());
    return upcoming[0]?.scheduled?.toLocaleTimeString() ?? 'No check-in';
  }, [timeline]);
  const draftBadge = generatedReport ? 'Generated' : previewData ? 'Draft' : 'None';

  const handleStartDay = async () => {
    setStatusMessage('');
    try {
      const data = await api.reportingStartDay({ reportDate });
      setSession(data);
      setStatusMessage('Day started.');
    } catch (error) {
      setStatusMessage('Unable to start the day.');
    }
  };

  const handleEndDay = async () => {
    setStatusMessage('');
    try {
      const data = await api.reportingEndDay({ reportDate });
      setSession(data);
      setStatusMessage('Day ended.');
    } catch (error) {
      setStatusMessage('Unable to end the day.');
    }
  };

  const handleSubmitHourly = async () => {
    if (!session?.id) {
      setStatusMessage('Start the day to get a session id.');
      return;
    }
    setStatusMessage('');
    try {
      await api.reportingSubmitHourly({
        sessionId: session.id,
        slotHour,
        payload: { note: slotNote },
        idempotencyKey: `${session.id}-${slotHour}`,
      });
      setSlotNote('');
      setStatusMessage('Hourly update submitted.');
    } catch (error) {
      setStatusMessage('Unable to submit hourly update.');
    }
  };

  const handleStartVisit = async () => {
    if (!session?.id) {
      setStatusMessage('Start the day to open a sales visit.');
      return;
    }
    setStatusMessage('');
    try {
      const data = await api.reportingStartVisit({
        sessionId: session.id,
        locationName: visitLocation,
        idempotencyKey: `visit-start-${session.id}-${visitLocation}`,
      });
      setVisitLog((prev) => [data, ...prev]);
      setVisitId(data.id);
      setStatusMessage('Visit started.');
    } catch (error) {
      setStatusMessage('Unable to start visit.');
    }
  };

  const handleEndVisit = async () => {
    if (!visitId) {
      setStatusMessage('Select a visit to end.');
      return;
    }
    setStatusMessage('');
    try {
      const data = await api.reportingEndVisit({
        visitId,
        idempotencyKey: `visit-end-${visitId}`,
      });
      setVisitLog((prev) => prev.map((visit) => (visit.id === data.id ? data : visit)));
      setStatusMessage('Visit ended.');
    } catch (error) {
      setStatusMessage('Unable to end visit.');
    }
  };

  const handleLoadPreview = async () => {
    setStatusMessage('');
    try {
      const data = await api.reportingPreview(reportDate, includeOpenTasks);
      setPreviewData(data);
      setDraftPayload(JSON.stringify(data.draft_json ?? {}, null, 2));
      setStatusMessage('Preview loaded.');
    } catch (error) {
      setStatusMessage('No preview found for this date.');
    }
  };

  const handleSaveDraft = async () => {
    if (!session?.id) {
      setStatusMessage('Start the day to attach a draft.');
      return;
    }
    try {
      const payload = JSON.parse(draftPayload || '{}');
      await api.reportingSaveDraft({
        sessionId: session.id,
        reportDate,
        managerId: user?.managerId ?? null,
        departmentId: user?.departmentId ?? null,
        payload,
      });
      setStatusMessage('Draft saved.');
    } catch (error) {
      setStatusMessage('Unable to save draft. Check JSON format.');
    }
  };

  const handleSubmitReport = async () => {
    if (!session?.id) {
      setStatusMessage('Start the day to submit a report.');
      return;
    }
    try {
      const payload = JSON.parse(draftPayload || '{}');
      await api.reportingSubmitReport({
        sessionId: session.id,
        reportDate,
        managerId: user?.managerId ?? null,
        departmentId: user?.departmentId ?? null,
        payload,
        idempotencyKey: `submit-${session.id}-${reportDate}`,
      });
      setStatusMessage('Report submitted.');
    } catch (error) {
      setStatusMessage('Unable to submit report.');
    }
  };

  const handleManualEntry = async () => {
    if (!manualNote.trim()) {
      setStatusMessage('Add a note for the manual entry.');
      return;
    }
    try {
      const data = await api.reportingManualEntry({
        reportDate,
        sessionId: session?.id ?? null,
        taskId: manualTaskId,
        note: manualNote.trim(),
        eventTime: manualTime || null,
        durationMinutes: manualDuration === '' ? null : Number(manualDuration),
        timeBucket: manualBucket || null,
      });
      setPreviewData(data);
      setManualNote('');
      setManualTime('');
      setManualDuration('');
      setManualBucket('');
      setStatusMessage('Manual entry added.');
    } catch (error) {
      setStatusMessage('Unable to add manual entry.');
    }
  };

  const handleGenerateReport = async () => {
    try {
      const data = await api.reportingGenerateReport({
        reportDate,
        templateId: selectedTemplateId || null,
        title: reportTitle || null,
        sendEmail,
        sendWebex,
      });
      setGeneratedReport(data);
      setStatusMessage('Report generated.');
    } catch (error) {
      setStatusMessage('Unable to generate report.');
    }
  };

  const handleExport = (type: 'html' | 'pdf' | 'csv') => {
    if (!generatedReport?.report?.id) {
      setStatusMessage('Generate a report first.');
      return;
    }
    window.open(`/api/reporting/reports/${generatedReport.report.id}/export/${type}`, '_blank');
  };

  const handleLoadHistory = async () => {
    setStatusMessage('');
    try {
      if (isManager) {
        const data = await api.reportingManagerReports({ status: 'submitted' });
        setHistoryReports(data);
      } else {
        setHistoryReports([]);
      }
    } catch (error) {
      setStatusMessage('Unable to load history.');
    }
  };

  const handleLoadTeamStatus = async () => {
    setStatusMessage('');
    try {
      const data = await api.reportingManagerTeamStatus(teamStatusDate);
      setTeamStatus(data);
    } catch (error) {
      setStatusMessage('Unable to load team status.');
    }
  };

  const handleLoadManagerReports = async () => {
    setStatusMessage('');
    try {
      const data = await api.reportingManagerReports({ date: teamStatusDate });
      setManagerReports(data);
      setSelectedReport(data[0] ?? null);
    } catch (error) {
      setStatusMessage('Unable to load manager reports.');
    }
  };

  const handleAddComment = async () => {
    if (!selectedReport) {
      setStatusMessage('Select a report.');
      return;
    }
    if (!commentText.trim()) return;
    try {
      const data = await api.reportingAddComment(selectedReport.id, commentText);
      setCommentLog((prev) => [data, ...prev]);
      setCommentText('');
    } catch (error) {
      setStatusMessage('Unable to add comment.');
    }
  };

  const handleLoadTemplates = useCallback(async () => {
    try {
      const data = await api.reportingListTemplates();
      setTemplates(data);
    } catch (error) {
      setStatusMessage('Unable to load templates.');
    }
  }, []);

  const handleCreateTemplate = async () => {
    try {
      const config = {
        html_shell: templateHtmlShell || null,
        css: templateCss || null,
        blocks: [
          {
            type: 'table',
            columns: templateColumns
              .split(',')
              .map((col) => col.trim())
              .filter(Boolean)
              .map((col) => ({ key: col, label: col.toUpperCase(), width: 'auto' })),
            event_types: templateEventTypes
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean),
          },
        ],
        sections: templateSections.map((section) => ({
          title: section.title,
          fields: section.fields.map((field) => ({ label: field, required: false, type: 'text' })),
        })),
      };
      await api.reportingCreateTemplate({
        name: templateName,
        description: templateDescription,
        departmentId: templateDepartment || null,
        isGlobal: templateIsGlobal,
        config,
      });
      setTemplateName('');
      setTemplateDescription('');
      setTemplateDepartment('');
      setTemplateIsGlobal(false);
      setTemplateHtmlShell('');
      setTemplateCss('');
      setTemplateColumns('time,event_type,title,status,duration_minutes');
      setTemplateEventTypes('TASK_SNAPSHOT,TASK_COMPLETED,MANUAL_ENTRY,WEBEX_REPLY,SALES_VISIT_START,SALES_VISIT_STOP,SESSION_OPEN,SESSION_CLOSE');
      setTemplateSections([{ title: 'Summary', fields: ['Highlights'] }]);
      handleLoadTemplates();
      setStatusMessage('Template created.');
    } catch (error) {
      setStatusMessage('Unable to create template.');
    }
  };

  const handlePublishTemplate = async (templateId: string) => {
    try {
      await api.reportingPublishTemplate(templateId);
      handleLoadTemplates();
      setStatusMessage('Template published.');
    } catch (error) {
      setStatusMessage('Unable to publish template.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`${buttonClass} ${activeTab === tab.key ? 'border-primary text-primary' : ''}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {statusMessage && (
        <div className="rounded-lg border border-border-color bg-surface px-4 py-2 text-sm text-text-secondary">
          {statusMessage}
        </div>
      )}

      {activeTab === 'myDay' && (
        <div className={panelClass}>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="text-sm text-text-secondary">Report Date</label>
              <input
                type="date"
                value={reportDate}
                onChange={(event) => setReportDate(event.target.value)}
                className="mt-1 rounded-md border border-border-color bg-background px-3 py-2 text-sm"
              />
            </div>
            <button className={buttonClass} onClick={handleStartDay}>
              Start Day
            </button>
            <button className={buttonClass} onClick={handleEndDay}>
              End Day
            </button>
            {session && <span className="text-sm text-text-secondary">Session: {session.id}</span>}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="text-sm text-text-secondary">Slot Hour</label>
              <input
                type="number"
                min={0}
                max={23}
                value={slotHour}
                onChange={(event) => setSlotHour(Number(event.target.value))}
                className="mt-1 w-full rounded-md border border-border-color bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm text-text-secondary">Hourly Note</label>
              <input
                type="text"
                value={slotNote}
                onChange={(event) => setSlotNote(event.target.value)}
                className="mt-1 w-full rounded-md border border-border-color bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
          <button className={buttonClass} onClick={handleSubmitHourly}>
            Submit Hourly Update
          </button>

          {isSales && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-text-primary">Sales Visits</h3>
              <div className="flex flex-wrap gap-4 items-end">
                <div>
                  <label className="text-sm text-text-secondary">Location</label>
                  <input
                    type="text"
                    value={visitLocation}
                    onChange={(event) => setVisitLocation(event.target.value)}
                    className="mt-1 rounded-md border border-border-color bg-background px-3 py-2 text-sm"
                  />
                </div>
                <button className={buttonClass} onClick={handleStartVisit}>
                  Start Visit
                </button>
                <div>
                  <label className="text-sm text-text-secondary">Visit ID</label>
                  <input
                    type="text"
                    value={visitId}
                    onChange={(event) => setVisitId(event.target.value)}
                    className="mt-1 rounded-md border border-border-color bg-background px-3 py-2 text-sm"
                  />
                </div>
                <button className={buttonClass} onClick={handleEndVisit}>
                  End Visit
                </button>
              </div>
              {visitLog.length > 0 && (
                <div className="space-y-2 text-sm text-text-secondary">
                  {visitLog.map((visit) => (
                    <div key={visit.id} className="flex items-center justify-between border border-border-color rounded-lg px-3 py-2">
                      <span>{visit.location_name || 'Visit'}</span>
                      <span>{visit.checkout_at ? 'Closed' : 'Active'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'preview' && (
        <div className={panelClass}>
          <div className="flex flex-wrap gap-3 items-center">
            <input
              type="date"
              value={reportDate}
              onChange={(event) => setReportDate(event.target.value)}
              className="rounded-md border border-border-color bg-background px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={includeOpenTasks}
                onChange={(event) => setIncludeOpenTasks(event.target.checked)}
              />
              Include Open Tasks
            </label>
            <button className={buttonClass} onClick={handleLoadPreview}>
              Load Preview
            </button>
            <button className={buttonClass} onClick={handleSaveDraft}>
              Save Draft
            </button>
            <button className={buttonClass} onClick={handleSubmitReport}>
              Submit Report
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-5">
            {[
              { label: 'Today Status', value: session?.status ?? 'Not started' },
              { label: 'Next Check-in', value: nextCheckin },
              { label: 'Tasks Completed', value: `${completedCount}/${totalTasksCount}` },
              { label: 'Visits', value: visitsCount },
              { label: 'Sales Visit Running', value: visitRunning ? 'Yes' : 'No' },
              { label: 'Draft Status', value: draftBadge },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-border-color bg-background px-3 py-2 text-sm">
                <div className="text-xs text-text-secondary">{item.label}</div>
                <div className="text-base font-semibold text-text-primary">{item.value}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
            <div className="space-y-4">
              <div className="rounded-lg border border-border-color bg-background p-4">
                <h3 className="text-sm font-semibold text-text-primary">Timeline</h3>
                {timeline.length === 0 ? (
                  <p className="text-sm text-text-secondary">No events yet.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {timeline.map((event) => (
                      <div key={event.id} className="rounded-md border border-border-color px-3 py-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-text-primary">{event.event_type}</span>
                          <span className="text-xs text-text-secondary">
                            {formatDate(event.event_time, true)}
                          </span>
                        </div>
                        <div className="text-xs text-text-secondary">{event.source}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-border-color bg-background p-4 space-y-3">
                <h3 className="text-sm font-semibold text-text-primary">Manual Entry</h3>
                <input
                  type="text"
                  value={manualNote}
                  onChange={(event) => setManualNote(event.target.value)}
                  placeholder="Add a note..."
                  className="w-full rounded-md border border-border-color bg-background px-3 py-2 text-sm"
                />
                <div className="grid gap-3 md:grid-cols-2">
                  <select
                    value={manualTaskId ?? ''}
                    onChange={(event) => setManualTaskId(event.target.value || null)}
                    className="rounded-md border border-border-color bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Link to task (optional)</option>
                    {taskSnapshots.map((snapshot) => (
                      <option key={snapshot.task_id} value={snapshot.task_id}>
                        {(snapshot.snapshot['title'] as string) || snapshot.task_id}
                      </option>
                    ))}
                  </select>
                  <input
                    type="datetime-local"
                    value={manualTime}
                    onChange={(event) => setManualTime(event.target.value)}
                    className="rounded-md border border-border-color bg-background px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <select
                    value={manualBucket}
                    onChange={(event) => setManualBucket(event.target.value)}
                    className="rounded-md border border-border-color bg-background px-3 py-2 text-sm"
                  >
                    <option value="">Time bucket (auto)</option>
                    <option value="Morning">Morning</option>
                    <option value="Afternoon">Afternoon</option>
                    <option value="Evening">Evening</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    value={manualDuration}
                    onChange={(event) => setManualDuration(event.target.value === '' ? '' : Number(event.target.value))}
                    placeholder="Duration minutes"
                    className="rounded-md border border-border-color bg-background px-3 py-2 text-sm"
                  />
                </div>
                <button className={buttonClass} onClick={handleManualEntry}>
                  Add Entry
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-lg border border-border-color bg-background p-4">
                <h3 className="text-sm font-semibold text-text-primary">Table Preview</h3>
                {previewData?.draft_json?.table_rows ? (
                  <div className="mt-2 overflow-auto">
                    <table className="w-full text-xs text-text-secondary">
                      <thead className="text-xs text-text-secondary">
                        <tr>
                          <th className="text-left p-2">Time</th>
                          <th className="text-left p-2">Type</th>
                          <th className="text-left p-2">Title</th>
                          <th className="text-left p-2">Status</th>
                          <th className="text-left p-2">Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(previewData.draft_json.table_rows as Array<Record<string, unknown>>).map((row, idx) => (
                          <tr key={`${row.time}-${idx}`} className="border-t border-border-color">
                            <td className="p-2">{String(row.time ?? '')}</td>
                            <td className="p-2">{String(row.event_type ?? '')}</td>
                            <td className="p-2">{String(row.title ?? '')}</td>
                            <td className="p-2">{String(row.status ?? '')}</td>
                            <td className="p-2">{String(row.duration_minutes ?? '')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-text-secondary">No rows yet.</p>
                )}
              </div>
              <div className="rounded-lg border border-border-color bg-background p-4">
                <h3 className="text-sm font-semibold text-text-primary">Draft JSON</h3>
                <textarea
                  value={draftPayload}
                  onChange={(event) => setDraftPayload(event.target.value)}
                  className="mt-2 min-h-[200px] w-full rounded-lg border border-border-color bg-background px-3 py-2 text-xs font-mono"
                />
              </div>

              <div className="rounded-lg border border-border-color bg-background p-4 space-y-3">
                <h3 className="text-sm font-semibold text-text-primary">Generated Report</h3>
                <button className={buttonClass} onClick={handleLoadTemplates}>
                  Refresh Templates
                </button>
                <input
                  type="text"
                  value={reportTitle}
                  onChange={(event) => setReportTitle(event.target.value)}
                  placeholder="Report title"
                  className="w-full rounded-md border border-border-color bg-background px-3 py-2 text-sm"
                />
                <select
                  value={selectedTemplateId}
                  onChange={(event) => setSelectedTemplateId(event.target.value)}
                  className="w-full rounded-md border border-border-color bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select template</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm text-text-secondary">
                  <input type="checkbox" checked={sendEmail} onChange={(event) => setSendEmail(event.target.checked)} />
                  Email Manager
                </label>
                <label className="flex items-center gap-2 text-sm text-text-secondary">
                  <input type="checkbox" checked={sendWebex} onChange={(event) => setSendWebex(event.target.checked)} />
                  Send Webex
                </label>
                <button className={buttonClass} onClick={handleGenerateReport}>
                  Generate Report
                </button>
                <div className="flex flex-wrap gap-2">
                  <button className={buttonClass} onClick={() => handleExport('html')}>
                    Export HTML
                  </button>
                  <button className={buttonClass} onClick={() => handleExport('pdf')}>
                    Export PDF
                  </button>
                  <button className={buttonClass} onClick={() => handleExport('csv')}>
                    Export CSV
                  </button>
                </div>
                {generatedReport?.report?.rendered_html ? (
                  <div
                    className="rounded-lg border border-border-color bg-background p-3 text-sm"
                    dangerouslySetInnerHTML={{ __html: generatedReport.report.rendered_html }}
                  />
                ) : (
                  <p className="text-xs text-text-secondary">Generate to preview rendered report.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className={panelClass}>
          <div className="flex flex-wrap gap-3 items-center">
            <input
              type="date"
              value={reportDate}
              onChange={(event) => setReportDate(event.target.value)}
              className="rounded-md border border-border-color bg-background px-3 py-2 text-sm"
            />
            <button className={buttonClass} onClick={handleLoadHistory}>
              Load History
            </button>
          </div>
          {historyReports.length === 0 ? (
            <p className="text-sm text-text-secondary">No submitted reports yet.</p>
          ) : (
            <div className="space-y-2">
              {historyReports.map((report) => (
                <div key={report.id} className="rounded-lg border border-border-color px-3 py-2 text-sm">
                  <div className="font-semibold text-text-primary">Report {report.report_date}</div>
                  <div className="text-text-secondary">Status: {report.status}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'teamStatus' && (
        <div className={panelClass}>
          <div className="flex flex-wrap gap-3 items-center">
            <input
              type="date"
              value={teamStatusDate}
              onChange={(event) => setTeamStatusDate(event.target.value)}
              className="rounded-md border border-border-color bg-background px-3 py-2 text-sm"
            />
            <button className={buttonClass} onClick={handleLoadTeamStatus}>
              Load Team Status
            </button>
          </div>
          {teamStatus.length === 0 ? (
            <p className="text-sm text-text-secondary">No team status available.</p>
          ) : (
            <div className="space-y-2 text-sm">
              {teamStatus.map((entry) => (
                <div key={entry.session_id} className="rounded-lg border border-border-color px-3 py-2">
                  <div className="font-semibold text-text-primary">Employee {entry.employee_id}</div>
                  <div className="text-text-secondary">Session: {entry.session_status}</div>
                  <div className="text-text-secondary">Report: {entry.report_status}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'viewer' && (
        <div className={panelClass}>
          <div className="flex flex-wrap gap-3 items-center">
            <input
              type="date"
              value={teamStatusDate}
              onChange={(event) => setTeamStatusDate(event.target.value)}
              className="rounded-md border border-border-color bg-background px-3 py-2 text-sm"
            />
            <button className={buttonClass} onClick={handleLoadManagerReports}>
              Load Reports
            </button>
            <button className={buttonClass} onClick={() => setShowRaw((prev) => !prev)}>
              {showRaw ? 'Show Rendered' : 'Show Raw JSON'}
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-[240px,1fr]">
            <div className="space-y-2">
              {managerReports.map((report) => (
                <button
                  key={report.id}
                  onClick={() => setSelectedReport(report)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                    selectedReport?.id === report.id ? 'border-primary text-primary' : 'border-border-color text-text-secondary'
                  }`}
                >
                  {report.employee_id} — {report.report_date}
                </button>
              ))}
            </div>
            <div className="space-y-3">
              {selectedReport ? (
                <>
                  {showRaw ? (
                    <pre className="rounded-lg border border-border-color bg-background p-3 text-xs">
                      {JSON.stringify(selectedReport.payload ?? {}, null, 2)}
                    </pre>
                  ) : (
                    <div className="rounded-lg border border-border-color bg-background p-3 text-sm">
                      {selectedReport.rendered_html ? (
                        <div dangerouslySetInnerHTML={{ __html: selectedReport.rendered_html }} />
                      ) : (
                        <p className="text-text-secondary">No rendered HTML available.</p>
                      )}
                    </div>
                  )}
                  <div className="rounded-lg border border-border-color p-3 space-y-2">
                    <h4 className="text-sm font-semibold text-text-primary">Comments</h4>
                    <textarea
                      value={commentText}
                      onChange={(event) => setCommentText(event.target.value)}
                      className="w-full rounded-md border border-border-color bg-background px-3 py-2 text-sm"
                      rows={3}
                    />
                    <button className={buttonClass} onClick={handleAddComment}>
                      Add Comment
                    </button>
                    {commentLog.length > 0 && (
                      <div className="space-y-2 text-sm text-text-secondary">
                        {commentLog.map((comment) => (
                          <div key={comment.id} className="border border-border-color rounded-lg px-3 py-2">
                            {comment.comment}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-text-secondary">Select a report to view.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'templateBuilder' && (
        <div className={panelClass}>
          <div className="grid gap-4 md:grid-cols-2">
            <input
              type="text"
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder="Template name"
              className="rounded-md border border-border-color bg-background px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={templateDepartment}
              onChange={(event) => setTemplateDepartment(event.target.value)}
              placeholder="Department ID (optional)"
              className="rounded-md border border-border-color bg-background px-3 py-2 text-sm"
            />
          </div>
          <input
            type="text"
            value={templateColumns}
            onChange={(event) => setTemplateColumns(event.target.value)}
            placeholder="Table columns (comma separated)"
            className="rounded-md border border-border-color bg-background px-3 py-2 text-sm"
          />
          <input
            type="text"
            value={templateEventTypes}
            onChange={(event) => setTemplateEventTypes(event.target.value)}
            placeholder="Event types to include (comma separated)"
            className="rounded-md border border-border-color bg-background px-3 py-2 text-sm"
          />
          <textarea
            value={templateDescription}
            onChange={(event) => setTemplateDescription(event.target.value)}
            placeholder="Description"
            className="rounded-md border border-border-color bg-background px-3 py-2 text-sm"
          />
          <textarea
            value={templateHtmlShell}
            onChange={(event) => setTemplateHtmlShell(event.target.value)}
            placeholder="HTML shell (use {content}, {title}, {report_date}, {css})"
            className="min-h-[140px] rounded-md border border-border-color bg-background px-3 py-2 text-sm font-mono"
          />
          <textarea
            value={templateCss}
            onChange={(event) => setTemplateCss(event.target.value)}
            placeholder="CSS"
            className="min-h-[120px] rounded-md border border-border-color bg-background px-3 py-2 text-sm font-mono"
          />
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={templateIsGlobal}
              onChange={(event) => setTemplateIsGlobal(event.target.checked)}
            />
            Global Template
          </label>
          <div className="space-y-3">
            {templateSections.map((section, sectionIndex) => (
              <div key={`${section.title}-${sectionIndex}`} className="rounded-lg border border-border-color p-3">
                <input
                  type="text"
                  value={section.title}
                  onChange={(event) => {
                    const next = [...templateSections];
                    next[sectionIndex] = { ...next[sectionIndex], title: event.target.value };
                    setTemplateSections(next);
                  }}
                  className="mb-2 w-full rounded-md border border-border-color bg-background px-3 py-2 text-sm"
                />
                <div className="space-y-2">
                  {section.fields.map((field, fieldIndex) => (
                    <input
                      key={`${field}-${fieldIndex}`}
                      type="text"
                      value={field}
                      onChange={(event) => {
                        const next = [...templateSections];
                        const fields = [...next[sectionIndex].fields];
                        fields[fieldIndex] = event.target.value;
                        next[sectionIndex] = { ...next[sectionIndex], fields };
                        setTemplateSections(next);
                      }}
                      className="w-full rounded-md border border-border-color bg-background px-3 py-2 text-sm"
                    />
                  ))}
                </div>
                <button
                  className={`${buttonClass} mt-2`}
                  onClick={() => {
                    const next = [...templateSections];
                    next[sectionIndex].fields.push('New Field');
                    setTemplateSections(next);
                  }}
                >
                  Add Field
                </button>
              </div>
            ))}
            <button
              className={buttonClass}
              onClick={() => setTemplateSections((prev) => [...prev, { title: 'New Section', fields: ['Field'] }])}
            >
              Add Section
            </button>
          </div>
          <button className={buttonClass} onClick={handleCreateTemplate}>
            Create Template
          </button>
        </div>
      )}

      {activeTab === 'templateList' && (
        <div className={panelClass}>
          <button className={buttonClass} onClick={handleLoadTemplates}>
            Refresh Templates
          </button>
          {templates.length === 0 ? (
            <p className="text-sm text-text-secondary">No templates yet.</p>
          ) : (
            <div className="space-y-2">
              {templates.map((template) => (
                <div key={template.id} className="rounded-lg border border-border-color px-3 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-text-primary">{template.name}</div>
                      <div className="text-text-secondary">Version {template.version}</div>
                    </div>
                    <button className={buttonClass} onClick={() => handlePublishTemplate(template.id)}>
                      Publish
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Reporting;
