import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { Notification, NotificationEntityType, NotificationType, Task, User } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useMentionUsers } from '../hooks/useMentionUsers';
import MentionPicker from '../components/ui/MentionPicker';
import { applyMention, extractMentionedUserIds, getMentionMatch, MentionMatch } from '../utils/mentionUtils';
import {
  addMentionNotifications,
  addMissionLogEntry,
  deleteLocalNotifications,
  deleteMissionLogEntries,
  getLocalNotifications,
  getMissionLogEntries,
  markLocalNotificationsRead,
  markMissionLogRead,
  MissionLogEntry,
} from '../utils/inboxStore';
import { timeAgo } from '../utils';

type InboxTab = 'notifications' | 'mission-log' | 'ticket-mentions' | 'messaging';

const Inbox: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { users: mentionUsers } = useMentionUsers();
  const [activeTab, setActiveTab] = useState<InboxTab>('notifications');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [localNotifications, setLocalNotifications] = useState<Notification[]>([]);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [missionEntries, setMissionEntries] = useState<MissionLogEntry[]>([]);
  const [missionSelectedIds, setMissionSelectedIds] = useState<Set<string>>(new Set());
  const [missionTasks, setMissionTasks] = useState<Task[]>([]);
  const [missionTaskId, setMissionTaskId] = useState<string>('');
  const [missionText, setMissionText] = useState('');
  const [missionMention, setMissionMention] = useState<MentionMatch | null>(null);
  const missionTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!user) return;
    const fetchNotifications = async () => {
      setLoadingNotifications(true);
      try {
        const data = await api.getNotifications(user.id);
        setNotifications(data);
      } catch (error) {
        console.error('Failed to load notifications', error);
      } finally {
        setLoadingNotifications(false);
      }
    };
    fetchNotifications();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    setLocalNotifications(getLocalNotifications(user.id));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    api.getTasks(user.id, user.role)
      .then(setMissionTasks)
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    setMissionEntries(getMissionLogEntries());
  }, []);

  const allNotifications = useMemo(() => {
    const combined = [...localNotifications, ...notifications];
    return combined.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [localNotifications, notifications]);

  const ticketMentions = useMemo(
    () => localNotifications.filter((item) => item.type === NotificationType.MENTION && item.entityType === NotificationEntityType.TICKET),
    [localNotifications],
  );

  const markSelectedRead = async () => {
    if (!user || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const localIds = localNotifications.filter((item) => ids.includes(item.id)).map((item) => item.id);
    if (localIds.length) {
      markLocalNotificationsRead(user.id, localIds);
      setLocalNotifications(getLocalNotifications(user.id));
    }
    const apiIds = notifications.filter((item) => ids.includes(item.id)).map((item) => item.id);
    await Promise.all(apiIds.map((id) => api.markNotificationAsRead(user.id, id)));
    setNotifications((prev) => prev.map((item) => (apiIds.includes(item.id) ? { ...item, isRead: true } : item)));
    setSelectedIds(new Set());
  };

  const markAllRead = async () => {
    if (!user) return;
    await api.markAllAsRead(user.id);
    markLocalNotificationsRead(user.id);
    setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })));
    setLocalNotifications(getLocalNotifications(user.id));
    setSelectedIds(new Set());
  };

  const deleteSelected = () => {
    if (!user || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const localIds = localNotifications.filter((item) => ids.includes(item.id)).map((item) => item.id);
    if (localIds.length) {
      deleteLocalNotifications(user.id, localIds);
      setLocalNotifications(getLocalNotifications(user.id));
    }
    const apiIds = notifications.filter((item) => ids.includes(item.id)).map((item) => item.id);
    apiIds.forEach((id) => api.deleteNotification(id).catch(() => {}));
    setNotifications((prev) => prev.filter((item) => !apiIds.includes(item.id)));
    setSelectedIds(new Set());
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!user) return;
    if (notification.deepLink) {
      navigate(notification.deepLink);
    }
    if (!notification.isRead) {
      if (notification.source === 'local') {
        markLocalNotificationsRead(user.id, [notification.id]);
        setLocalNotifications(getLocalNotifications(user.id));
      } else {
        api.markNotificationAsRead(user.id, notification.id).catch(() => {});
        setNotifications((prev) =>
          prev.map((item) => (item.id === notification.id ? { ...item, isRead: true } : item)),
        );
      }
    }
  };

  const handleMissionTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.target.value;
    setMissionText(nextValue);
    const cursor = event.target.selectionStart ?? nextValue.length;
    setMissionMention(getMentionMatch(nextValue, cursor));
  };

  const handleMissionMentionSelect = (selectedUser: User) => {
    if (!missionMention) return;
    const mentionLabel = selectedUser.name.replace(/\\s+/g, '');
    const nextValue = applyMention(missionText, missionMention, mentionLabel);
    setMissionText(nextValue);
    setMissionMention(null);
    requestAnimationFrame(() => {
      if (!missionTextareaRef.current) return;
      const cursorPosition = missionMention.start + mentionLabel.length + 2;
      missionTextareaRef.current.focus();
      missionTextareaRef.current.setSelectionRange(cursorPosition, cursorPosition);
    });
  };

  const handleMissionSubmit = () => {
    if (!user || !missionText.trim()) return;
    const task = missionTasks.find((entry) => entry.id === missionTaskId);
    const mentioned = extractMentionedUserIds(missionText.trim(), mentionUsers).filter((id) => id !== user.id);
    const entry = addMissionLogEntry({
      taskId: missionTaskId || null,
      taskTitle: task?.title ?? null,
      authorId: user.id,
      authorName: user.name,
      message: missionText.trim(),
      mentions: mentioned,
    });
    if (mentioned.length) {
      addMentionNotifications({
        authorName: user.name,
        mentionedUserIds: mentioned,
        message: missionText.trim(),
        entityType: NotificationEntityType.TASK,
        entityId: missionTaskId || entry.id,
        deepLink: missionTaskId ? `/tasks/${missionTaskId}` : '/tasks',
      });
      setLocalNotifications(getLocalNotifications(user.id));
    }
    setMissionEntries((prev) => [entry, ...prev]);
    setMissionText('');
    setMissionTaskId('');
  };

  const markMissionRead = () => {
    if (missionSelectedIds.size === 0) return;
    markMissionLogRead(Array.from(missionSelectedIds));
    setMissionEntries(getMissionLogEntries());
    setMissionSelectedIds(new Set());
  };

  const deleteMissionSelected = () => {
    if (missionSelectedIds.size === 0) return;
    deleteMissionLogEntries(Array.from(missionSelectedIds));
    setMissionEntries(getMissionLogEntries());
    setMissionSelectedIds(new Set());
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Inbox</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Notifications, mentions, and mission logs.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['notifications', 'mission-log', 'ticket-mentions', 'messaging'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] ${
              activeTab === tab
                ? 'bg-blue-600 text-white'
                : 'border border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
            }`}
          >
            {tab.replace('-', ' ')}
          </button>
        ))}
      </div>

      {activeTab === 'notifications' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={markSelectedRead}
              className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-200"
            >
              Mark read
            </button>
            <button
              type="button"
              onClick={markAllRead}
              className="rounded-full border border-blue-500/40 bg-blue-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-200"
            >
              Mark all read
            </button>
            <button
              type="button"
              onClick={deleteSelected}
              className="rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-rose-600 dark:text-rose-200"
            >
              Delete
            </button>
          </div>

          {loadingNotifications && (
            <div className="flex items-center justify-center rounded-xl border border-gray-200/60 bg-white/70 py-10 dark:border-gray-700/60 dark:bg-gray-900/60">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
            </div>
          )}

          {!loadingNotifications && allNotifications.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/70 px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400">
              No notifications yet.
            </div>
          )}

          {!loadingNotifications && allNotifications.length > 0 && (
            <div className="space-y-3">
              {allNotifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`flex items-start gap-3 rounded-xl border p-4 transition ${
                    notification.isRead
                      ? 'border-gray-200/50 bg-white/70 dark:border-gray-700/60 dark:bg-gray-900/60'
                      : 'border-blue-500/40 bg-blue-50/70 dark:border-blue-500/50 dark:bg-blue-950/40'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(notification.id)}
                    onChange={(event) => {
                      const next = new Set(selectedIds);
                      if (event.target.checked) next.add(notification.id);
                      else next.delete(notification.id);
                      setSelectedIds(next);
                    }}
                    className="mt-1 h-4 w-4 rounded border-gray-300"
                  />
                  <button
                    type="button"
                    onClick={() => handleNotificationClick(notification)}
                    className="text-left"
                  >
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      {notification.title || notification.message}
                    </p>
                    {notification.body && (
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{notification.body}</p>
                    )}
                    <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-gray-400">
                      {timeAgo(notification.createdAt)}
                    </p>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'mission-log' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200/60 bg-white/80 p-4 shadow-sm dark:border-gray-700/60 dark:bg-gray-900/70">
            <p className="text-xs uppercase tracking-[0.25em] text-gray-400">New Mission Log</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <select
                value={missionTaskId}
                onChange={(event) => setMissionTaskId(event.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              >
                <option value="">Select task...</option>
                {missionTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleMissionSubmit}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Post log
              </button>
            </div>
            <div className="relative mt-3">
              <textarea
                ref={missionTextareaRef}
                value={missionText}
                onChange={handleMissionTextChange}
                rows={3}
                placeholder="Share a mission update and @mention teammates..."
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              />
              <MentionPicker
                users={mentionUsers}
                query={missionMention?.query ?? ''}
                isOpen={!!missionMention}
                onSelect={handleMissionMentionSelect}
                onClose={() => setMissionMention(null)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={markMissionRead}
              className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-200"
            >
              Mark read
            </button>
            <button
              type="button"
              onClick={deleteMissionSelected}
              className="rounded-full border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-rose-600 dark:text-rose-200"
            >
              Delete
            </button>
          </div>

          {missionEntries.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/70 px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400">
              No mission logs yet.
            </div>
          )}

          {missionEntries.length > 0 && (
            <div className="space-y-3">
              {missionEntries.map((entry) => (
                <div
                  key={entry.id}
                  className={`flex items-start gap-3 rounded-xl border p-4 ${
                    entry.isRead
                      ? 'border-gray-200/50 bg-white/70 dark:border-gray-700/60 dark:bg-gray-900/60'
                      : 'border-blue-500/40 bg-blue-50/70 dark:border-blue-500/50 dark:bg-blue-950/40'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={missionSelectedIds.has(entry.id)}
                    onChange={(event) => {
                      const next = new Set(missionSelectedIds);
                      if (event.target.checked) next.add(entry.id);
                      else next.delete(entry.id);
                      setMissionSelectedIds(next);
                    }}
                    className="mt-1 h-4 w-4 rounded border-gray-300"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      {entry.taskTitle || 'General update'}
                    </p>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{entry.message}</p>
                    <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-gray-400">
                      {entry.authorName} - {timeAgo(entry.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'ticket-mentions' && (
        <div className="space-y-3">
          {ticketMentions.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/70 px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400">
              No ticket mentions yet.
            </div>
          )}
          {ticketMentions.map((notification) => (
            <button
              key={notification.id}
              type="button"
              onClick={() => handleNotificationClick(notification)}
              className={`w-full rounded-xl border p-4 text-left ${
                notification.isRead
                  ? 'border-gray-200/50 bg-white/70 dark:border-gray-700/60 dark:bg-gray-900/60'
                  : 'border-blue-500/40 bg-blue-50/70 dark:border-blue-500/50 dark:bg-blue-950/40'
              }`}
            >
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {notification.title || notification.message}
              </p>
              {notification.body && (
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{notification.body}</p>
              )}
              <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-gray-400">
                {timeAgo(notification.createdAt)}
              </p>
            </button>
          ))}
        </div>
      )}

      {activeTab === 'messaging' && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/70 px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400">
          Messaging channels will appear here soon.
        </div>
      )}
    </div>
  );
};

export default Inbox;
