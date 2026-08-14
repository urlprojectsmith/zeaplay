import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    Task,
    User,
    TaskPriority,
    TaskStatus,
    RecurrenceRule,
    Role,
} from '../types';
import { useAuth, useTheme, useSearch } from '../hooks/useAuth';
import api from '../services/mockApi';
import TaskDetailModal from '../components/TaskDetailModal';
import TaskPriorityBadge from '../components/ui/TaskPriorityBadge';
import CreateTaskModal from '../components/CreateTaskModal';
import { PlusIcon, DocumentTextIcon, BellIcon, XMarkIcon, SparklesIcon } from '../components/icons';
import GamificationService, { GamificationStats, AchievementPopup } from '../services/gamification';
import { CUSTOM_STATUS_NAMES } from '../types';

const gamificationService = GamificationService.getInstance();


type ThemeMode = 'light' | 'dark' | 'colorful' | 'professional' | 'gamified' | 'system';
type ResolvedTheme = 'light' | 'dark' | 'colorful' | 'professional' | 'gamified';
type ViewMode = 'month' | 'week' | 'day';
type QuickActionType = 'note' | 'reminder' | 'more';

type CalendarNote = {
    id: string;
    content: string;
    createdAt: string;
    createdBy: string | null;
};

type CalendarReminder = {
    id: string;
    message: string;
    createdAt: string;
    createdBy: string | null;
};

const resolveTheme = (theme: ThemeMode): ResolvedTheme => {
    if (theme === 'colorful' || theme === 'gamified') return 'gamified';
    if (theme === 'light' || theme === 'professional') return 'professional';
    if (theme === 'dark') return 'dark';
    if (typeof window !== 'undefined') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'professional';
    }
    return 'dark';
};

const getDateKey = (date: Date) => date.toISOString().split('T')[0];
const startOfWeek = (date: Date) => {
    const clone = new Date(date);
    const diff = clone.getDay();
    clone.setDate(clone.getDate() - diff);
    clone.setHours(0, 0, 0, 0);
    return clone;
};
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);

const getRangeForView = (mode: ViewMode, reference: Date) => {
    const days: Date[] = [];
    if (mode === 'day') {
        const day = new Date(reference);
        day.setHours(0, 0, 0, 0);
        days.push(day);
        return days;
    }
    if (mode === 'week') {
        const start = startOfWeek(reference);
        for (let i = 0; i < 7; i++) {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            days.push(d);
        }
        return days;
    }
    // month
    const monthStart = startOfMonth(reference);
    const monthEnd = new Date(reference.getFullYear(), reference.getMonth() + 1, 0);
    const start = new Date(monthStart);
    start.setDate(start.getDate() - monthStart.getDay());
    const end = new Date(monthEnd);
    if (monthEnd.getDay() !== 6) {
        end.setDate(end.getDate() + (6 - monthEnd.getDay()));
    }
    const iterator = new Date(start);
    while (iterator <= end) {
        days.push(new Date(iterator));
        iterator.setDate(iterator.getDate() + 1);
    }
    return days;
};

const createLightweightId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const CalendarView: React.FC = () => {
    const { user } = useAuth() as { user: User | null };
    const { theme } = useTheme();
    const resolvedTheme = resolveTheme(theme as ThemeMode);
    const isDark = resolvedTheme === 'dark';
    const isColorful = resolvedTheme === 'colorful';
    const isGamified = resolvedTheme === 'gamified';
    const isProfessional = resolvedTheme === 'professional';

    const [tasks, setTasks] = useState<Task[]>([]);
    const [usersMap, setUsersMap] = useState<Map<string, User>>(new Map());
    const [loading, setLoading] = useState(true);

    const [viewMode, setViewMode] = useState<ViewMode>('month');
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

    const [searchTerm, setSearchTerm] = useState('');

    // Filter states
    const [priorityFilter, setPriorityFilter] = useState<'ALL' | TaskPriority>('ALL');
    const [statusFilter, setStatusFilter] = useState<'ALL' | TaskStatus>('ALL');
    const [assigneeFilter, setAssigneeFilter] = useState<'ALL' | 'ME' | string>('ALL');
    const [teamFilter, setTeamFilter] = useState<string>('');
    const [tagFilter, setTagFilter] = useState<string>('');
    const [dueDateFilter, setDueDateFilter] = useState<string>('');
    const [creationDateFilter, setCreationDateFilter] = useState<string>('');
    const [quickFilter, setQuickFilter] = useState<string>('');

    // Removed inline quick add UI state and handlers as per user request
    // const [quickAddDate, setQuickAddDate] = useState<string | null>(null);
    // const [quickAddTitle, setQuickAddTitle] = useState('');
    // const [quickAddPriority, setQuickAddPriority] = useState<TaskPriority>(TaskPriority.MEDIUM);
    // const [quickAddLoading, setQuickAddLoading] = useState(false);
    const [activityLog, setActivityLog] = useState<{ message: string; timestamp: string }[]>([]);
    const reminderSentRef = useRef<Set<string>>(new Set());

    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [createModalDate, setCreateModalDate] = useState<string | null>(null);
    const [activeQuickActionsDay, setActiveQuickActionsDay] = useState<string | null>(null);
    const [quickActionContext, setQuickActionContext] = useState<{ dateKey: string; date: Date; type: QuickActionType } | null>(null);
    const [noteDraft, setNoteDraft] = useState('');
    const [reminderDraft, setReminderDraft] = useState('');
    const [notesByDate, setNotesByDate] = useState<Record<string, CalendarNote[]>>({});
    const [remindersByDate, setRemindersByDate] = useState<Record<string, CalendarReminder[]>>({});
    const notesStorageKey = useMemo(() => (user ? `calendar-notes-${user.id}` : null), [user]);
    const remindersStorageKey = useMemo(() => (user ? `calendar-reminders-${user.id}` : null), [user]);
    const canCreateTasks = !!user && [Role.MANAGER, Role.ADMIN, Role.OWNER].includes(user.role);

    // Gamification states
    const [gamificationStats, setGamificationStats] = useState<GamificationStats | null>(null);
    const [achievementPopups, setAchievementPopups] = useState<AchievementPopup[]>([]);

    const logActivity = useCallback((message: string) => {
        setActivityLog((prev) => {
            const entry = { message, timestamp: new Date().toISOString() };
            return [entry, ...prev].slice(0, 25);
        });
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }
        if (!notesStorageKey) {
            setNotesByDate({});
            return;
        }
        try {
            const stored = window.localStorage.getItem(notesStorageKey);
            if (stored) {
                const parsed = JSON.parse(stored) as Record<string, CalendarNote[]>;
                setNotesByDate(parsed && typeof parsed === 'object' ? parsed : {});
            } else {
                setNotesByDate({});
            }
        } catch (error) {
            console.warn('Failed to load calendar notes from storage', error);
            setNotesByDate({});
        }
    }, [notesStorageKey]);

    useEffect(() => {
        if (typeof window === 'undefined' || !notesStorageKey) {
            return;
        }
        try {
            window.localStorage.setItem(notesStorageKey, JSON.stringify(notesByDate));
        } catch (error) {
            console.warn('Failed to persist calendar notes', error);
        }
    }, [notesByDate, notesStorageKey]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }
        if (!remindersStorageKey) {
            setRemindersByDate({});
            return;
        }
        try {
            const stored = window.localStorage.getItem(remindersStorageKey);
            if (stored) {
                const parsed = JSON.parse(stored) as Record<string, CalendarReminder[]>;
                setRemindersByDate(parsed && typeof parsed === 'object' ? parsed : {});
            } else {
                setRemindersByDate({});
            }
        } catch (error) {
            console.warn('Failed to load calendar reminders from storage', error);
            setRemindersByDate({});
        }
    }, [remindersStorageKey]);

    useEffect(() => {
        if (typeof window === 'undefined' || !remindersStorageKey) {
            return;
        }
        try {
            window.localStorage.setItem(remindersStorageKey, JSON.stringify(remindersByDate));
        } catch (error) {
            console.warn('Failed to persist calendar reminders', error);
        }
    }, [remindersByDate, remindersStorageKey]);

    // Removed inline quick add handlers
    // const openQuickAdd = (date: Date) => {
    //     setQuickAddDate(date.toISOString());
    //     setQuickAddTitle('');
    //     setQuickAddPriority(TaskPriority.MEDIUM);
    // };

    // const submitQuickAdd = async () => {
    //     if (!quickAddDate || !user || !quickAddTitle.trim()) {
    //         return;
    //     }
    //     setQuickAddLoading(true);
    //     try {
    //         await api.createTask(
    //             {
    //                 title: quickAddTitle.trim(),
    //                 description: 'Created from calendar quick add.',
    //                 status: TaskStatus.TODO,
    //                 priority: quickAddPriority,
    //                 team: 'Calendar',
    //                 assignedTo: assigneeFilter === 'ME' ? user.id : assigneeFilter === 'ALL' ? user.id : assigneeFilter,
    //                 dueAt: quickAddDate,
    //                 recurrenceRule: RecurrenceRule.NONE,
    //                 recurringTaskId: null,
    //                 clarityRating: null,
    //                 attachments: [],
    //                 estimatedHours: null,
    //                 tags: [],
    //                 subtasks: [],
    //             } as any,
    //             user.id,
    //         );
    //         logActivity(`Quick-added "${quickAddTitle.trim()}" for ${new Date(quickAddDate).toLocaleDateString()}`);
    //         setQuickAddDate(null);
    //         setQuickAddTitle('');
    //         fetchData();
    //     } catch (error) {
    //         console.error('Failed to quick add task', error);
    //     } finally {
    //         setQuickAddLoading(false);
    //     }
    // };

    // const handleCancelQuickAdd = () => {
    //     setQuickAddDate(null);
    //     setQuickAddTitle('');
    //     setQuickAddPriority(TaskPriority.MEDIUM);
    // };

    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const [fetchedTasks, allUsers] = await Promise.all([
                api.getTasks(user.id, user.role),
                api.getUsers(),
            ]);
            setTasks(fetchedTasks);
            const map = new Map<string, User>();
            allUsers.forEach((u) => map.set(u.id, u));
            setUsersMap(map);
        } catch (error) {
            console.error('Failed to fetch calendar data:', error);
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Update gamification stats when tasks or user changes
    useEffect(() => {
        if (!user || !tasks.length) return;
        const stats = gamificationService.getGamificationStats(tasks, user);
        setGamificationStats(stats);
    }, [tasks, user]);

    const filteredTasks = useMemo(() => {
        let filtered: Task[] = tasks;

        // Apply search
        const term = searchTerm.trim().toLowerCase();
        if (term) {
            filtered = filtered.filter((task) => {
                const assigneeNames = (task.assignedTo ?? [])
                    .map((id) => usersMap.get(id)?.name?.toLowerCase() || '')
                    .filter((name) => name !== '');
                const matchesAssignee = assigneeNames.some(name => name.includes(term));
                return (
                    task.title.toLowerCase().includes(term) ||
                    task.description.toLowerCase().includes(term) ||
                    task.team.toLowerCase().includes(term) ||
                    matchesAssignee ||
                    (task.tags && task.tags.some(tag => tag.toLowerCase().includes(term)))
                );
            });
        }

        // Apply filters
        if (priorityFilter !== 'ALL') {
            filtered = filtered.filter((task) => task.priority === priorityFilter);
        }
        if (statusFilter !== 'ALL') {
            filtered = filtered.filter((task) => task.status === statusFilter);
        }
        if (assigneeFilter === 'ME' && user) {
            filtered = filtered.filter((task) => task.assignedTo?.includes(user.id));
        } else if (assigneeFilter !== 'ALL' && assigneeFilter !== 'ME') {
            filtered = filtered.filter((task) => task.assignedTo?.includes(assigneeFilter));
        }
        if (teamFilter) {
            filtered = filtered.filter((task) => task.team === teamFilter);
        }
        if (tagFilter) {
            const tagFilterLower = tagFilter.toLowerCase();
            filtered = filtered.filter((task) => task.tags && task.tags.some(tag => tag.toLowerCase().includes(tagFilterLower)));
        }
        if (dueDateFilter) {
            filtered = filtered.filter((task) => task.dueAt && new Date(task.dueAt).toDateString() === new Date(dueDateFilter).toDateString());
        }
        if (creationDateFilter) {
            filtered = filtered.filter((task) => task.createdAt && new Date(task.createdAt).toDateString() === new Date(creationDateFilter).toDateString());
        }

        // Apply quick filters
        if (quickFilter === 'myTasks') {
            filtered = filtered.filter((task) => (user?.id ? task.assignedTo?.includes(user.id) : false));
        } else if (quickFilter === 'overdue') {
            filtered = filtered.filter((task) => task.dueAt && new Date(task.dueAt).getTime() < Date.now());
        } else if (quickFilter === 'completed') {
            filtered = filtered.filter((task) => task.status === TaskStatus.DONE);
        }

        return filtered;
    }, [tasks, searchTerm, usersMap, priorityFilter, statusFilter, assigneeFilter, teamFilter, tagFilter, dueDateFilter, creationDateFilter, quickFilter, user?.id]);

    const tasksByDate = useMemo(() => {
        const map = new Map<string, Task[]>();
        filteredTasks.forEach((task) => {
            if (!task.dueAt) {
                return;
            }
            const dateKey = getDateKey(new Date(task.dueAt));
            if (!map.has(dateKey)) {
                map.set(dateKey, []);
            }
            map.get(dateKey)!.push(task);
        });
        return map;
    }, [filteredTasks]);

    useEffect(() => {
        if (!user) {
            return;
        }
        const now = new Date();
        const tomorrowStart = new Date(now);
        tomorrowStart.setDate(tomorrowStart.getDate() + 1);
        tomorrowStart.setHours(0, 0, 0, 0);
        const tomorrowEnd = new Date(tomorrowStart);
        tomorrowEnd.setHours(23, 59, 59, 999);

        filteredTasks.forEach((task) => {
            if (!task.dueAt) return;
            if (reminderSentRef.current.has(task.id)) return;
            const dueDate = new Date(task.dueAt);
            if (dueDate >= tomorrowStart && dueDate <= tomorrowEnd) {
                reminderSentRef.current.add(task.id);
                const payload = {
                    taskId: task.id,
                    title: task.title,
                    dueAt: task.dueAt,
                    priority: task.priority,
                    assignedTo: task.assignedTo,
                    requestedBy: user?.id,
                };
                fetch('https://n8n.urlfactory.website/webhook/Remainder', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                }).catch((error) => console.error('Failed to send reminder', error));
                logActivity(`Reminder scheduled for "${task.title}" (due tomorrow)`);
            }
        });
    }, [filteredTasks, user, logActivity]);

    const workloadHeat = useMemo(() => {
        const counts = new Map<string, number>();
        tasksByDate.forEach((value, key) => {
            counts.set(key, value.length);
        });
        const max = Math.max(1, ...Array.from(counts.values()));
        return { counts, max };
    }, [tasksByDate]);

    const conflictDates = useMemo(() => {
        const conflicts = new Set<string>();
        tasksByDate.forEach((taskList, dateKey) => {
            const critical = taskList.filter((task) => task.priority === TaskPriority.URGENT);
            if (critical.length > 1) {
                conflicts.add(dateKey);
            }
        });
        return conflicts;
    }, [tasksByDate]);

    const handlePrev = () => {
        if (viewMode === 'month') {
            setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
        } else if (viewMode === 'week') {
            const clone = new Date(currentDate);
            clone.setDate(clone.getDate() - 7);
            setCurrentDate(clone);
        } else {
            const clone = new Date(currentDate);
            clone.setDate(clone.getDate() - 1);
            setCurrentDate(clone);
        }
    };

    const handleNext = () => {
        if (viewMode === 'month') {
            setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
        } else if (viewMode === 'week') {
            const clone = new Date(currentDate);
            clone.setDate(clone.getDate() + 7);
            setCurrentDate(clone);
        } else {
            const clone = new Date(currentDate);
            clone.setDate(clone.getDate() + 1);
            setCurrentDate(clone);
        }
    };

    const handleToday = () => {
        setCurrentDate(new Date());
    };

    const handleTaskClick = (taskId: string) => {
        setSelectedTaskId(taskId);
    };

    const closeTaskModal = () => {
        setSelectedTaskId(null);
        fetchData();
    };

    const handleTaskDeleted = (_taskId: string) => {
        setSelectedTaskId(null);
    };

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, taskId: string) => {
        e.dataTransfer.setData('taskId', taskId);
    };

    const handleDrop = async (e: React.DragEvent<HTMLDivElement>, date: Date) => {
        e.preventDefault();
        const taskId = e.dataTransfer.getData('taskId');
        if (!taskId || !user) {
            return;
        }
        const movedTask = tasks.find((task) => task.id === taskId);
        const iso = new Date(date).toISOString();
        try {
            setTasks((prev) => prev.map((task) => (task.id === taskId ? { ...task, dueAt: iso } : task)));
            await api.updateTask(taskId, { dueAt: iso }, user.id);
            if (movedTask) {
                logActivity(`Moved "${movedTask.title}" to ${new Date(date).toLocaleDateString()}`);
            }
        } catch (error) {
            console.error('Failed to move task', error);
            fetchData();
        }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => e.preventDefault();

    // Removed inline quick add handlers as per user request
    // const openQuickAdd = (date: Date) => {
    //     setQuickAddDate(date.toISOString());
    //     setQuickAddTitle('');
    //     setQuickAddPriority(TaskPriority.MEDIUM);
    // };

    // const submitQuickAdd = async () => {
    //     if (!quickAddDate || !user || !quickAddTitle.trim()) {
    //         return;
    //     }
    //     setQuickAddLoading(true);
    //     try {
    //         await api.createTask(
    //             {
    //                 title: quickAddTitle.trim(),
    //                 description: 'Created from calendar quick add.',
    //                 status: TaskStatus.TODO,
    //                 priority: quickAddPriority,
    //                 team: 'Calendar',
    //                 assignedTo: assigneeFilter === 'ME' ? user.id : assigneeFilter === 'ALL' ? user.id : assigneeFilter,
    //                 dueAt: quickAddDate,
    //                 recurrenceRule: RecurrenceRule.NONE,
    //                 recurringTaskId: null,
    //                 clarityRating: null,
    //                 attachments: [],
    //                 estimatedHours: null,
    //                 tags: [],
    //                 subtasks: [],
    //             } as any,
    //             user.id,
    //         );
    //         logActivity(`Quick-added "${quickAddTitle.trim()}" for ${new Date(quickAddDate).toLocaleDateString()}`);
    //         setQuickAddDate(null);
    //         setQuickAddTitle('');
    //         fetchData();
    //     } catch (error) {
    //         console.error('Failed to quick add task', error);
    //     } finally {
    //         setQuickAddLoading(false);
    //     }
    // };

    // const handleCancelQuickAdd = () => {
    //     setQuickAddDate(null);
    //     setQuickAddTitle('');
    //     setQuickAddPriority(TaskPriority.MEDIUM);
    // };

    const openCreateModal = (date: Date) => {
        setCreateModalDate(date.toISOString());
        setIsCreateModalOpen(true);
    };

    const closeCreateModal = () => {
        setIsCreateModalOpen(false);
        setCreateModalDate(null);
        fetchData();
    };

    const toggleQuickActions = (dateKey: string) => {
        setActiveQuickActionsDay((prev) => (prev === dateKey ? null : dateKey));
        setQuickActionContext(null);
    };

    const handleQuickActionSelection = (dateKey: string, date: Date, type: QuickActionType) => {
        setQuickActionContext({ dateKey, date: new Date(date), type });
        setActiveQuickActionsDay(null);
        setNoteDraft('');
        setReminderDraft('');
    };

    const closeQuickActionModal = () => {
        setQuickActionContext(null);
        setNoteDraft('');
        setReminderDraft('');
    };

    const handleNoteSubmit = () => {
        if (!quickActionContext || quickActionContext.type !== 'note') {
            return;
        }
        const content = noteDraft.trim();
        if (!content) {
            return;
        }
        setNotesByDate((prev) => {
            const existing = prev[quickActionContext.dateKey] ? [...prev[quickActionContext.dateKey]] : [];
            existing.push({
                id: createLightweightId(),
                content,
                createdAt: new Date().toISOString(),
                createdBy: user ? user.id : null,
            });
            return { ...prev, [quickActionContext.dateKey]: existing };
        });
        logActivity(`Added note for ${quickActionContext.date.toLocaleDateString()}`);
        closeQuickActionModal();
    };

    const handleReminderSubmit = () => {
        if (!quickActionContext || quickActionContext.type !== 'reminder') {
            return;
        }
        const message = reminderDraft.trim();
        if (!message) {
            return;
        }
        setRemindersByDate((prev) => {
            const existing = prev[quickActionContext.dateKey] ? [...prev[quickActionContext.dateKey]] : [];
            existing.push({
                id: createLightweightId(),
                message,
                createdAt: new Date().toISOString(),
                createdBy: user ? user.id : null,
            });
            return { ...prev, [quickActionContext.dateKey]: existing };
        });
        logActivity(`Added reminder for ${quickActionContext.date.toLocaleDateString()}`);
        closeQuickActionModal();
    };

    const handleNoteDelete = (dateKey: string, noteId: string, displayDate?: Date) => {
        const existing = notesByDate[dateKey] ?? [];
        const target = existing.find((note) => note.id === noteId);
        if (!target) {
            return;
        }
        setNotesByDate((prev) => {
            const current = prev[dateKey] ?? [];
            const nextEntries = current.filter((note) => note.id !== noteId);
            const next = { ...prev };
            if (nextEntries.length > 0) {
                next[dateKey] = nextEntries;
            } else {
                delete next[dateKey];
            }
            return next;
        });
        const friendlyDate = displayDate ? displayDate.toLocaleDateString() : new Date(dateKey).toLocaleDateString();
        logActivity(`Deleted note for ${friendlyDate}`);
    };

    const handleReminderDelete = (dateKey: string, reminderId: string, displayDate?: Date) => {
        const existing = remindersByDate[dateKey] ?? [];
        const target = existing.find((reminder) => reminder.id === reminderId);
        if (!target) {
            return;
        }
        setRemindersByDate((prev) => {
            const current = prev[dateKey] ?? [];
            const nextEntries = current.filter((reminder) => reminder.id !== reminderId);
            const next = { ...prev };
            if (nextEntries.length > 0) {
                next[dateKey] = nextEntries;
            } else {
                delete next[dateKey];
            }
            return next;
        });
        const friendlyDate = displayDate ? displayDate.toLocaleDateString() : new Date(dateKey).toLocaleDateString();
        logActivity(`Deleted reminder for ${friendlyDate}`);
    };

    const formatRangeLabel = () => {
        const formatter = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
        if (viewMode === 'month') {
            return formatter.format(currentDate);
        }
        if (viewMode === 'week') {
            const weekStart = startOfWeek(currentDate);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            const rangeFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
            return `${rangeFormat.format(weekStart)} � ${rangeFormat.format(weekEnd)} ${weekEnd.getFullYear()}`;
        }
        return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(currentDate);
    };

    const renderTasksForDate = (date: Date) => {
        const dateKey = getDateKey(date);
        const dayTasks = tasksByDate.get(dateKey) || [];
        return dayTasks
            .sort((a, b) => a.priority.localeCompare(b.priority))
            .map((task) => {
                const assignees = task.assignedTo ? task.assignedTo.map(id => usersMap.get(id)).filter(Boolean) : [];
                const subtasks = task.subtasks || [];
                const completed = subtasks.filter((sub) => sub.completed).length;
                const progress = subtasks.length > 0 ? Math.round((completed / subtasks.length) * 100) : null;
                return (
                    <div
                        key={task.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, task.id)}
                        onClick={() => handleTaskClick(task.id)}
                        className={`group rounded-2xl border border-white/15 bg-white/10 p-3 text-left text-sm text-white shadow-[0_12px_30px_rgba(15,23,42,0.45)] transition hover:-translate-y-1 hover:border-white/40 hover:bg-white/15 ${
                            resolvedTheme === 'professional' ? 'task-card-professional' : 'task-card-gamified'
                        }`}
                    >
                        <div className="flex items-center justify-between gap-2">
                            <p className="flex-1 truncate font-semibold text-white group-hover:text-amber-200">{task.title}</p>
                            <TaskPriorityBadge priority={task.priority} />
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-xs text-white/70">
                            <div className="h-6 w-6 rounded-full bg-white/20 text-center text-[10px] font-semibold leading-6 text-white">
                                {(() => {
                                    if (assignees.length === 0) return '??';
                                    if (assignees.length === 1) {
                                        return assignees[0]!.name.split(' ').map((n) => n[0]).join('').slice(0, 2);
                                    }
                                    if (assignees.length === 2) {
                                        return assignees.map(a => a!.name.split(' ').map((n) => n[0]).join('').slice(0, 1)).join('');
                                    }
                                    return `${assignees.length}`;
                                })()}
                            </div>
                            <span>{task.status.replace(/_/g, ' ').toLowerCase()}</span>
                            {task.tags && task.tags.length > 0 && <span>� {task.tags[0]}</span>}
                        </div>
                        {progress !== null && (
                            <div className="mt-2">
                                <div className="h-1.5 w-full rounded-full bg-white/20">
                                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-300 via-teal-300 to-sky-300" style={{ width: `${progress}%` }} />
                                </div>
                                <p className="mt-1 text-[10px] text-white/60">Progress {progress}%</p>
                            </div>
                        )}
                    </div>
                );
            });
    };

    const renderCells = () => {
        const daysInView = getRangeForView(viewMode, currentDate);
        const todayKey = getDateKey(new Date());
        const month = currentDate.getMonth();
        const isMonth = viewMode === 'month';

        const rows: React.JSX.Element[] = [];
        const cells: React.JSX.Element[] = [];
        daysInView.forEach((day, index) => {
            const dateKey = getDateKey(day);
            const heatCount = workloadHeat.counts.get(dateKey) || 0;
            const heatIntensity = workloadHeat.max > 0 ? heatCount / workloadHeat.max : 0;
            const heatColor = heatIntensity === 0 ? 'transparent' : `rgba(244,114,182, ${Math.min(0.6, 0.15 + heatIntensity * 0.5)})`;
            const inCurrentMonth = day.getMonth() === month;
            const isConflict = conflictDates.has(dateKey);

            const isQuickActionsOpen = activeQuickActionsDay === dateKey;
            const dateNotes = notesByDate[dateKey] ?? [];
            const dateReminders = remindersByDate[dateKey] ?? [];
            const dateBadgeBase = `ml-auto flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold ${
                dateKey === todayKey ? 'bg-gradient-to-r from-sky-400 to-violet-400 text-slate-900' : 'bg-white/15 text-white'
            }`;
            const quickActionButtonStyles = isDark
                ? 'border-white/15 bg-white/10 text-white/70 hover:border-white/50 hover:text-white'
                : isColorful
                    ? 'border-white/60 bg-white text-slate-600 hover:border-violet-300 hover:text-violet-500'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-indigo-300 hover:text-indigo-600';
            const quickActionPanelSurface = isDark
                ? 'border-white/15 bg-slate-900/95 text-white'
                : isColorful
                    ? 'border-white/60 bg-white/95 text-slate-900 shadow-lg'
                    : 'border-slate-200 bg-white text-slate-800 shadow-lg';
            const metaTextClass = isDark ? 'text-white/70' : 'text-slate-600';
            const metaLinkClass = isDark
                ? 'text-white/70 hover:text-white hover:bg-white/10'
                : isColorful
                    ? 'text-slate-600 hover:text-violet-600 hover:bg-violet-100/80'
                    : 'text-slate-600 hover:text-indigo-700 hover:bg-indigo-50';
            const quickActionOptionClass = isDark
                ? 'flex w-full items-center gap-2 rounded-xl border border-white/10 px-2 py-2 text-left hover:border-white/30 hover:bg-white/10'
                : isColorful
                    ? 'flex w-full items-center gap-2 rounded-xl border border-white/60 px-2 py-2 text-left hover:border-violet-300 hover:bg-violet-100'
                    : 'flex w-full items-center gap-2 rounded-xl border border-slate-200 px-2 py-2 text-left hover:border-indigo-200 hover:bg-indigo-50';

            const cell = (
                <div
                    key={dateKey}
                    className={`relative flex h-full min-h-[160px] flex-col gap-2 rounded-2xl border border-white/10 p-3 backdrop-blur transition ${
                        inCurrentMonth ? 'bg-white/5 hover:bg-white/10' : 'bg-white/3 text-white/60'
                    } ${isConflict ? 'ring-2 ring-rose-400/60' : ''} ${isQuickActionsOpen ? 'z-[55]' : 'z-auto'} ${
                        resolvedTheme === 'professional' ? 'calendar-cell-professional' : 'calendar-cell-gamified'
                    }`}
                    style={{ backgroundColor: inCurrentMonth ? heatColor : undefined }}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, day)}
                >
                    <div className="flex items-center justify-between text-xs">
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleQuickActions(dateKey);
                            }}
                            className={`flex h-7 w-7 items-center justify-center rounded-full border text-[13px] transition ${quickActionButtonStyles}`}
                            aria-label={`Open quick actions for ${day.toDateString()}`}
                        >
                            <PlusIcon className="h-4 w-4" />
                        </button>
                        {canCreateTasks ? (
                            <button
                                type="button"
                                onClick={() => openCreateModal(day)}
                                className={`${dateBadgeBase} cursor-pointer transition hover:scale-105`}
                                aria-label={`Schedule task for ${day.toDateString()}`}
                            >
                                {day.getDate()}
                            </button>
                        ) : (
                            <span className={dateBadgeBase}>{day.getDate()}</span>
                        )}
                    </div>

                    {isQuickActionsOpen && (
                        <div
                            className={`absolute right-3 top-12 z-[60] w-48 rounded-2xl border p-3 text-xs shadow-2xl ${quickActionPanelSurface}`}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="mb-2 flex items-center justify-between">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.2em]">Quick actions</p>
                                <button
                                    type="button"
                                    onClick={() => toggleQuickActions(dateKey)}
                                    className="rounded-full p-1 text-xs hover:bg-white/10"
                                    aria-label="Close quick actions"
                                >
                                    <XMarkIcon className="h-4 w-4" />
                                </button>
                            </div>
                            <div className="space-y-2">
                                <button
                                    type="button"
                                    onClick={() => handleQuickActionSelection(dateKey, day, 'note')}
                                    className={quickActionOptionClass}
                                >
                                    <DocumentTextIcon className="h-4 w-4" />
                                    <span>Create note</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleQuickActionSelection(dateKey, day, 'reminder')}
                                    className={quickActionOptionClass}
                                >
                                    <BellIcon className="h-4 w-4" />
                                    <span>Set reminder</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleQuickActionSelection(dateKey, day, 'more')}
                                    className={`${quickActionOptionClass} border-dashed opacity-80 hover:opacity-100`}
                                >
                                    <SparklesIcon className="h-4 w-4" />
                                    <span>Explore more</span>
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="flex-1 space-y-2 overflow-y-auto pr-1">
                        {renderTasksForDate(day)}
                    </div>

                    {(dateNotes.length > 0 || dateReminders.length > 0) && (
                        <div className="mt-1 space-y-1 text-[11px]">
                            {dateNotes.length > 0 && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleQuickActionSelection(dateKey, day, 'note');
                                    }}
                                    className={`inline-flex items-center gap-1 rounded-md px-1 py-[2px] transition ${metaLinkClass}`}
                                >
                                    <DocumentTextIcon className="h-3 w-3" />
                                    <span>{dateNotes.length} note{dateNotes.length === 1 ? '' : 's'}</span>
                                </button>
                            )}
                            {dateReminders.length > 0 && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleQuickActionSelection(dateKey, day, 'reminder');
                                    }}
                                    className={`inline-flex items-center gap-1 rounded-md px-1 py-[2px] transition ${metaLinkClass}`}
                                >
                                    <BellIcon className="h-3 w-3" />
                                    <span>{dateReminders.length} reminder{dateReminders.length === 1 ? '' : 's'}</span>
                                </button>
                            )}
                        </div>
                    )}
                </div>
            );

            cells.push(cell);

            if (isMonth && (index + 1) % 7 === 0) {
                rows.push(
                    <div key={`row-${dateKey}`} className="grid grid-cols-7 gap-3">
                        {cells.splice(0)}
                    </div>
                );
            }
        });

        if (viewMode === 'month') {
            return <div className="space-y-3">{rows}</div>;
        }

        if (viewMode === 'week') {
            return <div className="grid grid-cols-7 gap-3">{cells}</div>;
        }

        return <div className="grid gap-3">{cells}</div>;
    };

    const quickActionModalSurface = isDark
        ? 'bg-slate-900/90 border-white/15 text-white'
        : isColorful
            ? 'bg-white/95 border-white/60 text-slate-900 shadow-xl'
            : 'bg-white border-slate-200 text-slate-900 shadow-xl';
    const modalSecondaryButton = isDark
        ? 'rounded-full border border-white/20 px-3 py-1 text-xs text-white/70 hover:border-white/40 hover:text-white'
        : 'rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-indigo-200 hover:text-indigo-600';
    const modalPrimaryButton = 'rounded-full bg-gradient-to-r from-sky-400 to-violet-400 px-3 py-1 text-xs font-semibold text-slate-900 shadow hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed';
    const modalSubtleText = isDark ? 'text-white/70' : 'text-slate-600';
    const modalFieldClass = isDark
        ? 'border-white/20 bg-white/5 text-white placeholder:text-white/40 focus:border-sky-300'
        : isColorful
            ? 'border-white/60 bg-white text-slate-800 placeholder:text-slate-400 focus:border-violet-300'
            : 'border-slate-200 bg-white text-slate-800 placeholder:text-slate-400 focus:border-indigo-300';
    const modalLabelClass = isDark ? 'text-white/50' : 'text-slate-400';
    const modalListCardClass = isDark
        ? 'border-white/15 bg-white/5 text-white/90'
        : isColorful
            ? 'border-white/60 bg-white text-slate-800'
            : 'border-slate-200 bg-white text-slate-800';
    const modalTimestampClass = isDark ? 'text-white/50' : 'text-slate-400';
    const modalDangerButton = isDark
        ? 'rounded-full border border-red-400/40 px-3 py-1 text-xs text-red-200 transition hover:border-red-300 hover:text-red-100 hover:bg-red-500/10'
        : 'rounded-full border border-red-200 px-3 py-1 text-xs text-red-600 transition hover:bg-red-50';

    const notesForModal = quickActionContext ? [...(notesByDate[quickActionContext.dateKey] ?? [])] : [];
    const remindersForModal = quickActionContext ? [...(remindersByDate[quickActionContext.dateKey] ?? [])] : [];

    const quickActionModal = quickActionContext ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
            <div className={`w-full max-w-sm rounded-2xl border p-5 ${quickActionModalSurface}`}>
                <div className="mb-4 flex items-center justify-between">
                    <div>
                        <p className={`text-[11px] uppercase tracking-[0.25em] ${modalLabelClass}`}>
                            {quickActionContext.type === 'note' ? 'Create Note' : quickActionContext.type === 'reminder' ? 'Set Reminder' : 'Coming Soon'}
                        </p>
                        <h3 className="text-lg font-semibold">{new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(quickActionContext.date)}</h3>
                    </div>
                    <button
                        type="button"
                        onClick={closeQuickActionModal}
                        className="rounded-full p-1 text-sm hover:bg-white/10"
                        aria-label="Close quick action modal"
                    >
                        <XMarkIcon className="h-5 w-5" />
                    </button>
                </div>

                {quickActionContext.type === 'note' && (
                    <div className="space-y-4 text-sm">
                        <div className="space-y-2">
                            <p className={modalSubtleText}>Saved notes for this day</p>
                            {notesForModal.length > 0 ? (
                                notesForModal
                                    .slice()
                                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                                    .map((note) => (
                                        <div key={note.id} className={`rounded-xl border px-3 py-2 ${modalListCardClass}`}>
                                            <p className="whitespace-pre-wrap text-sm">{note.content}</p>
                                            <div className="mt-3 flex items-center justify-between text-[11px]">
                                                <span className={modalTimestampClass}>{new Date(note.createdAt).toLocaleString()}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleNoteDelete(quickActionContext.dateKey, note.id, quickActionContext.date)}
                                                    className={modalDangerButton}
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </div>
                                    ))
                            ) : (
                                <p className={modalSubtleText}>No notes captured yet. Add one below.</p>
                            )}
                        </div>
                        <div className="space-y-3">
                            <p className={modalSubtleText}>Add a new note</p>
                            <textarea
                                value={noteDraft}
                                onChange={(e) => setNoteDraft(e.target.value)}
                                rows={4}
                                className={`w-full rounded-xl px-3 py-2 text-sm focus:outline-none ${modalFieldClass}`}
                                placeholder="Reminder about standup, blockers, or anything else..."
                            />
                            <div className="flex justify-end gap-2">
                                <button type="button" onClick={closeQuickActionModal} className={modalSecondaryButton}>Cancel</button>
                                <button type="button" onClick={handleNoteSubmit} disabled={!noteDraft.trim()} className={modalPrimaryButton}>Save note</button>
                            </div>
                        </div>
                    </div>
                )}

                {quickActionContext.type === 'reminder' && (
                    <div className="space-y-4 text-sm">
                        <div className="space-y-2">
                            <p className={modalSubtleText}>Scheduled reminders</p>
                            {remindersForModal.length > 0 ? (
                                remindersForModal
                                    .slice()
                                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                                    .map((reminder) => (
                                        <div key={reminder.id} className={`rounded-xl border px-3 py-2 ${modalListCardClass}`}>
                                            <p className="whitespace-pre-wrap text-sm">{reminder.message}</p>
                                            <div className="mt-3 flex items-center justify-between text-[11px]">
                                                <span className={modalTimestampClass}>{new Date(reminder.createdAt).toLocaleString()}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleReminderDelete(quickActionContext.dateKey, reminder.id, quickActionContext.date)}
                                                    className={modalDangerButton}
                                                >
                                                    Delete
                                                </button>
                                            </div>
                                        </div>
                                    ))
                            ) : (
                                <p className={modalSubtleText}>No reminders set yet. Create one below.</p>
                            )}
                        </div>
                        <div className="space-y-3">
                            <p className={modalSubtleText}>Add a new reminder</p>
                            <textarea
                                value={reminderDraft}
                                onChange={(e) => setReminderDraft(e.target.value)}
                                rows={3}
                                className={`w-full rounded-xl px-3 py-2 text-sm focus:outline-none ${modalFieldClass}`}
                                placeholder="What should everyone remember?"
                            />
                            <div className="flex justify-end gap-2">
                                <button type="button" onClick={closeQuickActionModal} className={modalSecondaryButton}>Cancel</button>
                                <button type="button" onClick={handleReminderSubmit} disabled={!reminderDraft.trim()} className={modalPrimaryButton}>Save reminder</button>
                            </div>
                        </div>
                    </div>
                )}

                {quickActionContext.type === 'more' && (
                    <div className="space-y-3 text-sm">
                        <p className={modalSubtleText}>We&apos;re sketching more quick actions next... think recurring events, checklists, and AI summaries.</p>
                        <p className={modalSubtleText}>Tell us what would help most and we&apos;ll bump it up the roadmap.</p>
                        <div className="flex justify-end">
                            <button type="button" onClick={closeQuickActionModal} className={modalPrimaryButton}>Sounds good</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    ) : null;

    if (loading) {
        return <div className="p-10 text-center text-white/70">Loading calendar�</div>;
    }

    const topBarSurface = resolvedTheme === 'dark'
        ? 'bg-slate-950/70 border-white/10 text-white'
        : resolvedTheme === 'colorful'
            ? 'bg-white/80 border-white/50 text-slate-900 shadow-lg'
            : 'bg-white/85 border-slate-200 text-slate-800 shadow-sm';

    const buttonBase = 'rounded-full px-3 py-1 text-xs font-semibold transition';
    const activeBtn = 'bg-gradient-to-r from-sky-400 to-violet-400 text-slate-900 shadow';
    const inactiveBtn = resolvedTheme === 'dark'
        ? 'border border-white/20 text-white/70 hover:border-white/50 hover:text-white'
        : 'border border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600';

    const controls = (
        <div className={`mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border px-5 py-4 backdrop-blur ${topBarSurface}`}>
            <div className="flex flex-wrap items-center gap-2">
                {(['month', 'week', 'day'] as ViewMode[]).map((mode) => (
                    <button
                        key={mode}
                        onClick={() => setViewMode(mode)}
                        className={`${buttonBase} ${viewMode === mode ? activeBtn : inactiveBtn}`}
                    >
                        {mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </button>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
                <button onClick={handlePrev} className={`${buttonBase} ${inactiveBtn}`}>Prev</button>
                <button onClick={handleToday} className={`${buttonBase} ${inactiveBtn}`}>Today</button>
                <button onClick={handleNext} className={`${buttonBase} ${inactiveBtn}`}>Next</button>
                <span className="text-sm font-semibold">{formatRangeLabel()}</span>
            </div>
        </div>
    );

    const filterBar = (
        <div className={`mb-6 grid gap-3 rounded-2xl border px-5 py-4 backdrop-blur md:grid-cols-[2fr,1fr,1fr,1fr] ${topBarSurface}`}>
            <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search quests�"
                className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            />
            <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value as 'ALL' | TaskPriority)}
                className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
                <option value="ALL">All priorities</option>
                {Object.values(TaskPriority).map((priority) => (
                    <option key={priority} value={priority}>
                        {priority.replace(/_/g, ' ')}
                    </option>
                ))}
            </select>
            <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'ALL' | TaskStatus)}
                className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
                <option value="ALL">All statuses</option>
                {Object.values(TaskStatus).map((status) => (
                    <option key={status} value={status}>
                        {status.replace(/_/g, ' ')}
                    </option>
                ))}
            </select>
            <select
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value as 'ALL' | 'ME' | string)}
                className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            >
                <option value="ME">My quests</option>
                <option value="ALL">Entire squad</option>
                            {Array.from(usersMap.values()).map((member) => {
                                const typedMember = member as User;
                                return (
                                    <option key={typedMember.id} value={typedMember.id}>
                                        {typedMember.name}
                                    </option>
                                );
                            })}
            </select>
        </div>
    );

    const legend = (
        <div className="mb-6 flex flex-wrap items-center gap-4 text-xs text-white/70">
            <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-rose-400/60" />
                Heavy workload
            </span>
            <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-gradient-to-r from-sky-400 to-violet-400" />
                Today
            </span>
            <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-full border border-white/40" />
                Drag quests to reschedule
            </span>
            <span className="inline-flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-white/30 ring-2 ring-rose-400/60" />
                Conflict alert
            </span>
        </div>
    );

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-extrabold tracking-tight text-white">Mission Calendar</h1>
            {controls}
            {filterBar}
            {legend}
            {viewMode === 'month' && (
                <div className="grid grid-cols-7 gap-3 text-xs font-semibold uppercase tracking-[0.3em] text-white/60">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                        <div key={day} className="rounded-2xl border border-white/10 bg-white/5 py-3 text-center">
                            {day}
                        </div>
                    ))}
                </div>
            )}
            {renderCells()}
            <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-4 text-xs text-white/60">
                ?? Advanced automations such as reminders, external calendar sync, exports, smart scheduling, and time-blocking are on the roadmap. The current interface highlights conflicts, offers drag-and-drop rescheduling, and provides quick add so your crew can keep momentum while we wire up the deeper integrations.
            </div>
            {selectedTaskId && (
                <TaskDetailModal
                    taskId={selectedTaskId}
                    isOpen={!!selectedTaskId}
                    onClose={closeTaskModal}
                    usersMap={usersMap}
                    onTaskDeleted={handleTaskDeleted}
                />
            )}
            {isCreateModalOpen && (
                <CreateTaskModal
                    isOpen={isCreateModalOpen}
                    onClose={closeCreateModal}
                    onTaskCreated={closeCreateModal}
                    initialDueDate={createModalDate}
                />
            )}
            {quickActionModal}
        </div>
    );
};

export default CalendarView;
