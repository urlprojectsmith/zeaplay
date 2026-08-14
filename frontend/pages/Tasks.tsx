import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Task, User, TaskStatus, TaskPriority, CUSTOM_STATUS_NAMES, Role, TaskKanbanResponse } from '../types';
import { useAuth, useSearch, useTheme } from '../hooks/useAuth';
import { useTaskList } from '../hooks/useTaskList';
import { useTaskPrefetch } from '../hooks/useTaskPrefetch';
import { useTaskWebSocket } from '../hooks/useTaskWebSocket';
import { buildTaskKanbanKey, getTaskCaches, invalidateTaskCaches } from '../hooks/useTaskCache';
import api from '../services/mockApi';
import { loadPointsConfig, POINTS_CONFIG_UPDATED_EVENT } from '../utils/pointsConfigStorage';
import { formatDate, timeAgo } from '../utils';
import { augmentTasksWithPoints, summarizeTaskPoints, formatPointsValue, TaskPointsTone } from '../utils/taskPoints';
import { PlusIcon, TagIcon } from '../components/icons';
import TaskStatusBadge from '../components/ui/TaskStatusBadge';
import TaskPriorityBadge from '../components/ui/TaskPriorityBadge';
import CreateTaskModal from '../components/CreateTaskModal';
import TaskDetailModal from '../components/TaskDetailModal';
import TaskTemplateModal from '../components/TaskTemplateModal';

type ThemeMode = 'light' | 'dark' | 'colorful' | 'system';
type ResolvedTheme = 'light' | 'dark' | 'colorful';

const resolveTheme = (theme: ThemeMode): ResolvedTheme => {
    if (theme === 'colorful') return 'colorful';
    if (theme === 'light') return 'light';
    if (theme === 'dark') return 'dark';
    if (typeof window !== 'undefined') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
};

const useResolvedTheme = (theme: ThemeMode): ResolvedTheme => {
    const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(theme));

    useEffect(() => {
        if (theme === 'system') {
            const media = window.matchMedia('(prefers-color-scheme: dark)');
            const listener = () => setResolved(media.matches ? 'dark' : 'light');
            listener();
            media.addEventListener('change', listener);
            return () => media.removeEventListener('change', listener);
        }

        setResolved(resolveTheme(theme));
    }, [theme]);

    return resolved;
};

const DEFAULT_THEME = {
    legend: 'Unknown',
    gradient: 'from-gray-500/30 via-gray-600/30 to-gray-800/35',
    glow: 'hover:shadow-[0_30px_70px_rgba(100,116,139,0.35)]',
};

const TASK_STATUS_THEME: Record<TaskStatus, { legend: string; gradient: string; glow: string }> = {
    [TaskStatus.WAITING_FOR_REQUIREMENT]: {
        legend: 'Strategize the Battle Plan',
        gradient: 'from-slate-500/30 via-slate-600/30 to-slate-800/35',
        glow: 'hover:shadow-[0_30px_70px_rgba(100,116,139,0.35)]',
    },
    [TaskStatus.TODO]: {
        legend: 'Case Filed and Ready',
        gradient: 'from-indigo-500/25 via-sky-500/25 to-cyan-500/30',
        glow: 'hover:shadow-[0_30px_70px_rgba(59,130,246,0.35)]',
    },
    [TaskStatus.IN_PROGRESS]: {
        legend: 'In Progress',
        gradient: 'from-purple-500/25 via-fuchsia-500/25 to-rose-500/30',
        glow: 'hover:shadow-[0_30px_70px_rgba(192,132,252,0.4)]',
    },
    [TaskStatus.BLOCKED]: {
        legend: 'Boss Encounter - Critical',
        gradient: 'from-rose-500/25 via-red-500/25 to-orange-500/30',
        glow: 'hover:shadow-[0_30px_70px_rgba(248,113,113,0.4)]',
    },
    [TaskStatus.IN_REVIEW]: {
        legend: 'Tactical Shift in Progress',
        gradient: 'from-emerald-500/25 via-teal-500/25 to-sky-400/30',
        glow: 'hover:shadow-[0_30px_70px_rgba(16,185,129,0.35)]',
    },
    [TaskStatus.ON_HOLD]: {
        legend: 'On Hold',
        gradient: 'from-slate-500/25 via-slate-600/25 to-slate-700/30',
        glow: 'hover:shadow-[0_30px_70px_rgba(148,163,184,0.35)]',
    },
    [TaskStatus.DONE]: {
        legend: 'Victory Achieved - Claim Rewards',
        gradient: 'from-emerald-400/25 via-lime-400/25 to-amber-300/30',
        glow: 'hover:shadow-[0_30px_70px_rgba(74,222,128,0.35)]',
    },
    [TaskStatus.FAILED]: {
        legend: 'Mission Failed - Fallen',
        gradient: 'from-red-500/25 via-rose-500/25 to-pink-500/30',
        glow: 'hover:shadow-[0_30px_70px_rgba(239,68,68,0.35)]',
    },
    [TaskStatus.GRAVEYARD]: {
        legend: 'Archived in the Graveyard',
        gradient: 'from-gray-500/25 via-gray-600/25 to-gray-700/30',
        glow: 'hover:shadow-[0_30px_70px_rgba(107,114,128,0.35)]',
    },
};

const completedStatuses = new Set<TaskStatus>([
    TaskStatus.DONE,
]);

const activeStatuses = new Set<TaskStatus>([
    TaskStatus.TODO,
    TaskStatus.IN_PROGRESS,
    TaskStatus.IN_REVIEW,
]);

const overdueExcludedStatuses = new Set<TaskStatus>([
    TaskStatus.DONE,
    TaskStatus.FAILED,
    TaskStatus.GRAVEYARD,
]);

const STATUS_ORDER: TaskStatus[] = [
    TaskStatus.WAITING_FOR_REQUIREMENT,
    TaskStatus.TODO,
    TaskStatus.IN_PROGRESS,
    TaskStatus.BLOCKED,
    TaskStatus.IN_REVIEW,
    TaskStatus.ON_HOLD,
    TaskStatus.DONE,
    TaskStatus.FAILED,
    TaskStatus.GRAVEYARD,
];

type FilterOption = {
    value: string;
    label: string;
};

const ChevronIcon: React.FC<{ open: boolean; className?: string }> = ({ open, className }) => (
    <svg
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        className={`${className ?? ''} ${open ? 'rotate-180' : ''}`.trim()}
    >
        <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

const FilterDropdown: React.FC<{
    value: string;
    placeholder: string;
    options: FilterOption[];
    onChange: (value: string) => void;
    buttonClassName: string;
    menuClassName: string;
    itemClassName: string;
    activeItemClassName: string;
}> = ({ value, placeholder, options, onChange, buttonClassName, menuClassName, itemClassName, activeItemClassName }) => {
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const selectedLabel = options.find((option) => option.value === value)?.label ?? placeholder;

    useEffect(() => {
        if (!isOpen) return;
        const handleClick = (event: MouseEvent) => {
            if (!wrapperRef.current || wrapperRef.current.contains(event.target as Node)) {
                return;
            }
            setIsOpen(false);
        };
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKey);
        };
    }, [isOpen]);

    return (
        <div ref={wrapperRef} className="relative min-w-[190px]">
            <button
                type="button"
                className={`${buttonClassName} flex w-full items-center justify-between gap-3 text-left`}
                onClick={() => setIsOpen((prev) => !prev)}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
            >
                <span className={value ? '' : 'opacity-80'}>{selectedLabel}</span>
                <ChevronIcon open={isOpen} className="h-4 w-4 shrink-0 opacity-80 transition" />
            </button>
            {isOpen && (
                <div className={`absolute left-0 top-full z-50 mt-2 w-full overflow-hidden rounded-b-[12px] border ${menuClassName}`}>
                    <div className="max-h-64 overflow-y-auto py-1 custom-scrollbar">
                        {options.map((option) => {
                            const isActive = option.value === value;
                            return (
                                <button
                                    key={option.value || option.label}
                                    type="button"
                                    role="option"
                                    aria-selected={isActive}
                                    className={`${itemClassName} ${isActive ? activeItemClassName : ''}`}
                                    onClick={() => {
                                        onChange(option.value);
                                        setIsOpen(false);
                                    }}
                                >
                                    {option.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};



const Tasks: React.FC = () => {
    const [tasks, setTasks] = useState<Task[]>([]);
    const [usersMap, setUsersMap] = useState<Map<string, User>>(new Map());
    const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);
    const [totalPages, setTotalPages] = useState(1);
    const [totalTasks, setTotalTasks] = useState(0);
    const [statusCounts, setStatusCounts] = useState<Record<TaskStatus, number>>({});
    const [kanbanData, setKanbanData] = useState<TaskKanbanResponse | null>(null);
    const [kanbanLoading, setKanbanLoading] = useState(false);
    const [kanbanRefreshTick, setKanbanRefreshTick] = useState(0);
    const { user } = useAuth();
    const { searchQuery, setSearchQuery, debouncedSearchQuery } = useSearch();
    const { theme } = useTheme();
    const resolvedTheme = useResolvedTheme(theme as ThemeMode);
    const isDark = resolvedTheme === 'dark';
    const isColorful = resolvedTheme === 'colorful';
    const isLight = resolvedTheme === 'light';

    const taskTextColor = isDark ? 'text-white' : 'text-slate-900';
    const taskTextSecondary = isDark ? 'text-white/80' : 'text-slate-700';
    const taskTextMuted = isDark ? 'text-white/70' : 'text-slate-600';
    const taskBgSecondary = isDark ? 'bg-black/30' : 'bg-slate-200/50';
    const taskTagText = isDark ? 'text-white/80' : 'text-slate-800';


    const getPointsBadgeClass = useCallback(
        (tone: TaskPointsTone | undefined) => {
            if (tone === 'positive') {
                return isDark
                    ? 'border border-emerald-400/50 bg-emerald-500/15 text-emerald-100'
                    : 'border border-emerald-400/60 bg-emerald-500/10 text-emerald-700';
            }
            if (tone === 'negative') {
                return isDark
                    ? 'border border-rose-400/50 bg-rose-500/15 text-rose-100'
                    : 'border border-rose-400/60 bg-rose-500/10 text-rose-700';
            }
            if (tone === 'warning') {
                return isDark
                    ? 'border border-amber-400/50 bg-amber-500/15 text-amber-100'
                    : 'border border-amber-400/60 bg-amber-500/10 text-amber-700';
            }
            return isDark
                ? 'border border-white/25 bg-white/10 text-white'
                : 'border border-slate-300 bg-slate-100 text-slate-700';
        },
        [isDark],
    );

    const renderPointsBadge = useCallback(
    (taskItem: Task) => {
        if (!taskItem.pointsBreakdown) {
            return null;
        }

        const summary = summarizeTaskPoints(taskItem.pointsBreakdown);
        const badgeClass = getPointsBadgeClass(summary.tone);
        const notes = taskItem.pointsBreakdown.notes.length > 0 ? taskItem.pointsBreakdown.notes.join(' | ') : '';
        const tooltip = [summary.detail, notes].filter(Boolean).join(' | ');

        return (
            <div className={'mt-2 flex flex-wrap items-center gap-2 text-xs ' + taskTextMuted}>
                <span
                    className={'inline-flex items-center gap-1 rounded-full px-3 py-1 font-semibold ' + badgeClass}
                    title={tooltip || undefined}
                >
                    {summary.label}: {formatPointsValue(summary.value)}
                </span>
                {summary.detail && <span className="text-[11px]">{summary.detail}</span>}
            </div>
        );
    },
    [getPointsBadgeClass, taskTextMuted],
);

    const [isCreateModalOpen, setCreateModalOpen] = useState(false);
    const [isTemplateModalOpen, setTemplateModalOpen] = useState(false);
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const prefetchedTaskIdsRef = useRef<Set<string>>(new Set());

    // New state for selected tasks for bulk actions
    const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());

    // Filtering and sorting state
    const [statusFilter, setStatusFilter] = useState<string>('');
    const [priorityFilter, setPriorityFilter] = useState<string>('');
    const [assigneeFilter, setAssigneeFilter] = useState<string>('');
    const [teamFilter, setTeamFilter] = useState<string>('');
    const [tagFilter, setTagFilter] = useState<string>('');
    const [dueDateFilter, setDueDateFilter] = useState<string>('');
    const [creationDateFilter, setCreationDateFilter] = useState<string>('');
    const [sortBy, setSortBy] = useState<string>('status');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
    const [quickFilter, setQuickFilter] = useState<string>('');
    const [viewMode, setViewMode] = useState<'list' | 'grid' | 'kanban'>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('taskViewMode');
            if (saved === 'list' || saved === 'grid' || saved === 'kanban') {
                return saved;
            }
        }
        return 'list';
    });
    const [currentPage, setCurrentPage] = useState(1);
    const prefetchSummaries = false;
    const [globalPageSize, setGlobalPageSize] = useState(20);
    const [pageSizeByView, setPageSizeByView] = useState<Record<'list' | 'grid' | 'kanban', number>>({
        list: 20,
        grid: 10,
        kanban: 10,
    });

    const changeViewMode = (mode: 'list' | 'grid' | 'kanban') => {
        setViewMode(mode);
        if (typeof window !== 'undefined') {
            localStorage.setItem('taskViewMode', mode);
        }
    };

    const pageSize = Math.min(globalPageSize, pageSizeByView[viewMode]);
    const apiPageSize = viewMode === 'grid' ? pageSize * 3 : pageSize;

    const listParams = useMemo(
        () => ({
            viewMode,
            page: currentPage,
            pageSize: apiPageSize,
            search: debouncedSearchQuery || undefined,
            status: statusFilter ? (statusFilter as TaskStatus) : undefined,
            priority: priorityFilter ? (priorityFilter as TaskPriority) : undefined,
            assigneeId: assigneeFilter || undefined,
            team: teamFilter || undefined,
            tag: tagFilter || undefined,
            dueDate: dueDateFilter || undefined,
            createdDate: creationDateFilter || undefined,
            quickFilter: quickFilter || undefined,
            sortBy: sortBy || undefined,
            sortOrder: sortOrder,
        }),
        [
            viewMode,
            currentPage,
            apiPageSize,
            debouncedSearchQuery,
            statusFilter,
            priorityFilter,
            assigneeFilter,
            teamFilter,
            tagFilter,
            dueDateFilter,
            creationDateFilter,
            quickFilter,
            sortBy,
            sortOrder,
        ],
    );

    const { data: pageResult, loading: listLoading, refresh: refreshTasks } = useTaskList({
        params: listParams,
        enabled: Boolean(user),
    });

    const { kanbanCache, ttlMs } = useMemo(() => getTaskCaches(), []);
    const loading = listLoading;

    useEffect(() => {
        if (!pageResult) {
            return;
        }
        const tasksWithPoints = augmentTasksWithPoints(pageResult.items);
        setTasks(tasksWithPoints);
        setTotalPages(pageResult.totalPages);
        setTotalTasks(pageResult.total);
        setStatusCounts(pageResult.statusCounts ?? {});
    }, [pageResult]);

    useEffect(() => {
        if (!user) {
            return;
        }
        const loadMetadata = async () => {
            try {
                const [allUsers, deptData] = await Promise.all([
                    api.getUsers(),
                    api.getDepartments(),
                ]);
                const map = new Map<string, User>();
                allUsers.forEach((entry) => map.set(entry.id, entry));
                setUsersMap(map);
                const departmentNames = Array.from(
                    new Set(
                        (deptData ?? [])
                            .map((dept) => dept.name)
                            .filter((name): name is string => Boolean(name)),
                    ),
                ).sort((a, b) => a.localeCompare(b));
                setDepartmentOptions(departmentNames);
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                console.error('Failed to fetch task metadata:', message);
            }
        };
        loadMetadata();
    }, [user]);

    const kanbanParams = useMemo(
        () => ({
            pageSize: pageSizeByView.kanban,
            search: debouncedSearchQuery || undefined,
            priority: priorityFilter ? (priorityFilter as TaskPriority) : undefined,
            assigneeId: assigneeFilter || undefined,
            team: teamFilter || undefined,
            tag: tagFilter || undefined,
            dueDate: dueDateFilter || undefined,
            createdDate: creationDateFilter || undefined,
            quickFilter: quickFilter || undefined,
        }),
        [
            pageSizeByView.kanban,
            debouncedSearchQuery,
            priorityFilter,
            assigneeFilter,
            teamFilter,
            tagFilter,
            dueDateFilter,
            creationDateFilter,
            quickFilter,
        ],
    );

    const kanbanCacheKey = useMemo(() => buildTaskKanbanKey(kanbanParams), [kanbanParams]);

    useEffect(() => {
        if (!user) {
            return;
        }
        const cached = kanbanCache.get(kanbanCacheKey);
        if (cached) {
            setKanbanData(cached);
            setKanbanLoading(false);
        }
        const shouldFetch = !cached || kanbanRefreshTick > 0;
        if (!shouldFetch) {
            return;
        }
        setKanbanLoading(!cached);
        api
            .getTasksKanban({
                pageSize: kanbanParams.pageSize,
                search: kanbanParams.search,
                priority: kanbanParams.priority,
                assigneeId: kanbanParams.assigneeId,
                team: kanbanParams.team,
                tag: kanbanParams.tag,
                dueDate: kanbanParams.dueDate,
                createdDate: kanbanParams.createdDate,
                quickFilter: kanbanParams.quickFilter,
            })
            .then((response) => {
                if (!response) {
                    return;
                }
                kanbanCache.set(kanbanCacheKey, response, ttlMs);
                setKanbanData(response);
            })
            .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : 'Unknown error';
                console.error('Failed to fetch kanban tasks:', message);
            })
            .finally(() => {
                setKanbanLoading(false);
            });
    }, [user, kanbanCache, kanbanCacheKey, kanbanParams, kanbanRefreshTick, ttlMs]);

    const prefetchBaseParams = useMemo(() => {
        const { page, ...rest } = listParams;
        return rest;
    }, [listParams]);

    const prefetchPages = useMemo(() => [currentPage + 1], [currentPage]);

    useTaskPrefetch({
        baseParams: prefetchBaseParams,
        pages: prefetchPages,
        enabled: Boolean(user),
        prefetchSummaries,
        visibleTasks: tasks,
        kanbanParams,
    });

    const handleTaskEvent = useCallback(() => {
        invalidateTaskCaches();
        setKanbanRefreshTick((prev) => prev + 1);
        refreshTasks();
    }, [refreshTasks]);

    useTaskWebSocket({
        enabled: Boolean(user),
        onEvent: handleTaskEvent,
    });
    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const handlePointsConfigChange = () => {
            setTasks((previous) => augmentTasksWithPoints(previous, { config: loadPointsConfig() }));
        };

        window.addEventListener(POINTS_CONFIG_UPDATED_EVENT, handlePointsConfigChange);
        return () => {
            window.removeEventListener(POINTS_CONFIG_UPDATED_EVENT, handlePointsConfigChange);
        };
    }, []);

    useEffect(() => {
        setCurrentPage(1);
    }, [
        viewMode,
        debouncedSearchQuery,
        statusFilter,
        priorityFilter,
        assigneeFilter,
        teamFilter,
        tagFilter,
        dueDateFilter,
        creationDateFilter,
        sortBy,
        sortOrder,
        quickFilter,
        pageSizeByView,
    ]);


    const formatAssigneeNames = useCallback(
        (assigneeIds: string[] | null) => {
            if (!assigneeIds || assigneeIds.length === 0) {
                return 'Unassigned';
            }

            const names = assigneeIds
                .map((id) => usersMap.get(id)?.name || '')
                .filter((name) => name !== '');

            if (names.length === 0) {
                return 'Unassigned';
            }

            return names.join(', ');
        },
        [usersMap]
    );

    const filteredTasks = useMemo(() => tasks, [tasks]);
    const pagedTasks = useMemo(() => filteredTasks, [filteredTasks]);
    const kanbanTaskIds = useMemo(() => {
        if (!kanbanData) {
            return [];
        }
        const ids = kanbanData.columns.flatMap((column) => column.items.map((task) => task.id));
        return Array.from(new Set(ids));
    }, [kanbanData]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const visibleTaskIds = useMemo(() => {
        if (viewMode !== 'kanban') {
            return pagedTasks.map((task) => task.id);
        }
        return kanbanTaskIds;
    }, [viewMode, pagedTasks, kanbanTaskIds]);
    const selectedTaskPreview = useMemo(() => {
        if (!selectedTaskId) {
            return null;
        }
        const listTask = tasks.find((task) => task.id === selectedTaskId);
        if (listTask) {
            return listTask;
        }
        return kanbanData?.columns
            .flatMap((column) => column.items)
            .find((task) => task.id === selectedTaskId) ?? null;
    }, [kanbanData, selectedTaskId, tasks]);
    const prefetchTaskDetail = useCallback((taskId: string) => {
        if (prefetchedTaskIdsRef.current.has(taskId)) {
            return;
        }
        prefetchedTaskIdsRef.current.add(taskId);
        void api.getTask(taskId).catch(() => {
            prefetchedTaskIdsRef.current.delete(taskId);
        });
    }, []);

    // New delete handler for single task
    const handleDeleteTask = async (taskId: string) => {
        if (!user) return;
        try {
            await api.deleteTask(taskId);
            setTasks((prevTasks) => prevTasks.filter((task) => task.id !== taskId));
            setSelectedTaskIds((prev) => {
                const newSet = new Set(prev);
                newSet.delete(taskId);
                return newSet;
            });
            if (selectedTaskId === taskId) {
                setSelectedTaskId(null);
            }
            refreshTasks();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('Failed to delete task:', message);
        }
    };

    // New bulk delete handler
    const handleBulkDelete = async () => {
        if (!user || selectedTaskIds.size === 0) return;
        try {
            await Promise.all(Array.from(selectedTaskIds).map((taskId) => api.deleteTask(taskId)));
            setTasks((prevTasks) => prevTasks.filter((task) => !selectedTaskIds.has(task.id)));
            setSelectedTaskIds(new Set());
            setSelectedTaskId(null);
            refreshTasks();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('Failed to bulk delete tasks:', message);
        }
    };

    // Toggle select task
    const toggleSelectTask = (taskId: string) => {
        setSelectedTaskIds((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(taskId)) {
                newSet.delete(taskId);
            } else {
                newSet.add(taskId);
            }
            return newSet;
        });
    };

    // Select all tasks
    const selectAllTasks = () => {
        setSelectedTaskIds(new Set(visibleTaskIds));
    };

    // Deselect all tasks
    const deselectAllTasks = () => {
        setSelectedTaskIds(new Set());
    };

    // Check if all tasks are selected
    const allSelected = visibleTaskIds.length > 0 && visibleTaskIds.every((id) => selectedTaskIds.has(id));

    // Toggle select all (dynamic for Select All button)
    const toggleSelectAll = () => {
        if (allSelected) {
            deselectAllTasks();
        } else {
            selectAllTasks();
        }
    };

    const completedCount = useMemo(() => {
        if (Object.keys(statusCounts).length === 0) {
            return filteredTasks.filter((task) => completedStatuses.has(task.status)).length;
        }
        return Array.from(completedStatuses).reduce((sum, status) => sum + (statusCounts[status] ?? 0), 0);
    }, [statusCounts, filteredTasks]);
    const urgentCount = filteredTasks.filter((task) => task.priority === TaskPriority.URGENT).length;
    const activeCount = useMemo(() => {
        if (Object.keys(statusCounts).length === 0) {
            return filteredTasks.filter((task) => activeStatuses.has(task.status)).length;
        }
        return Array.from(activeStatuses).reduce((sum, status) => sum + (statusCounts[status] ?? 0), 0);
    }, [statusCounts, filteredTasks]);
    const blockedCount = filteredTasks.filter((task) => task.status === TaskStatus.BLOCKED).length;
    const overdueCount = filteredTasks.filter((task) => (task.dueAt ? new Date(task.dueAt).getTime() < Date.now() : false)).length;
    const statusSummary = useMemo(
        () =>
            STATUS_ORDER.map((status) => ({
                status,
                label: CUSTOM_STATUS_NAMES[status]?.name ?? status,
                count: statusCounts[status] ?? 0,
            })),
        [statusCounts],
    );
    const newsItems = useMemo(() => {
        if (tasks.length === 0) {
            return [];
        }

        const sorted = [...tasks].sort((a, b) => {
            const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return bTime - aTime;
        });

        return sorted.slice(0, 8).map((task) => {
            const creatorName = usersMap.get(task.createdBy)?.name || 'Someone';
            const assigneeNames = (task.assignedTo ?? [])
                .map((id) => usersMap.get(id)?.name)
                .filter((name): name is string => Boolean(name));
            const assigneeLabel = assigneeNames.length > 0 ? assigneeNames.join(', ') : 'unassigned';
            const departmentLabel = task.team || 'General';
            const statusLabel = CUSTOM_STATUS_NAMES[task.status]?.name ?? task.status;
            return {
                id: task.id,
                title: task.title || 'Untitled task',
                department: departmentLabel,
                creator: creatorName,
                assignee: assigneeLabel,
                priority: task.priority,
                status: statusLabel,
            };
        });
    }, [tasks, usersMap]);
    const newsTickerItems = useMemo(() => {
        if (newsItems.length === 0) {
            return [];
        }
        return newsItems.length > 1 ? [...newsItems, ...newsItems] : newsItems;
    }, [newsItems]);
    const shouldAnimateNews = newsItems.length > 1;
    const canSeeTaskCounts = Boolean(user && [Role.MANAGER, Role.ADMIN, Role.OWNER].includes(user.role));

    const xpScore = completedCount * 160 + activeCount * 60 + urgentCount * 90;
    const baseLevel = 600;
    const level = Math.max(1, Math.floor(xpScore / baseLevel) + 1);
    const levelProgress = Math.min(100, ((xpScore % baseLevel) / baseLevel) * 100);
    const createdByFilterActive = quickFilter === 'createdByMe';
    const createdByFilterBase =
        'group relative inline-flex items-center justify-center overflow-hidden rounded-full border-2 px-10 py-5 text-lg font-semibold uppercase tracking-[0.22em] transition duration-300 min-w-[280px] focus-visible:outline-none focus-visible:ring-2';
    const createdByFilterTheme = isLight
        ? {
            surface: 'bg-white/90',
            active: 'border-sky-500/90 text-slate-900 shadow-[0_0_24px_rgba(56,189,248,0.5)]',
            inactive: 'border-slate-300/80 text-slate-700 hover:border-sky-400/80 hover:text-slate-900 hover:shadow-[0_0_18px_rgba(56,189,248,0.35)]',
            ring: 'focus-visible:ring-sky-300/60',
            glow: 'bg-[radial-gradient(circle,rgba(56,189,248,0.25),transparent_70%)]',
            ping: 'bg-sky-400/70',
            dotActive: 'bg-sky-500 shadow-[0_0_12px_rgba(56,189,248,0.8)]',
            dotInactive: 'bg-sky-400/80 shadow-[0_0_10px_rgba(56,189,248,0.6)]',
            sheen: 'bg-[linear-gradient(120deg,rgba(255,255,255,0.6),rgba(125,211,252,0.35),rgba(186,230,253,0.55))]',
            halo: 'bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.7),transparent_60%)]',
        }
        : isColorful
            ? {
                surface: 'bg-gradient-to-r from-fuchsia-950/80 via-indigo-950/70 to-sky-950/80',
                active: 'border-fuchsia-300/90 text-white shadow-[0_0_30px_rgba(217,70,239,0.55)]',
                inactive: 'border-sky-400/70 text-white/90 hover:border-fuchsia-300/80 hover:text-white hover:shadow-[0_0_24px_rgba(56,189,248,0.45)]',
                ring: 'focus-visible:ring-fuchsia-300/60',
                glow: 'bg-[radial-gradient(circle,rgba(217,70,239,0.3),transparent_70%)]',
                ping: 'bg-fuchsia-300/70',
                dotActive: 'bg-fuchsia-300 shadow-[0_0_14px_rgba(217,70,239,0.9)]',
                dotInactive: 'bg-sky-300/80 shadow-[0_0_12px_rgba(56,189,248,0.7)]',
                sheen: 'bg-[linear-gradient(120deg,rgba(216,180,254,0.45),rgba(56,189,248,0.45),rgba(167,139,250,0.45))]',
                halo: 'bg-[radial-gradient(circle_at_top,rgba(224,231,255,0.45),transparent_60%)]',
            }
            : {
                surface: 'bg-slate-950/80',
                active: 'border-cyan-300/90 text-cyan-100 shadow-[0_0_35px_rgba(34,211,238,0.7)]',
                inactive: 'border-cyan-500/60 text-white/90 hover:border-cyan-300/80 hover:text-white hover:shadow-[0_0_30px_rgba(34,211,238,0.55)]',
                ring: 'focus-visible:ring-cyan-400/70',
                glow: 'bg-[radial-gradient(circle,rgba(34,211,238,0.3),transparent_70%)]',
                ping: 'bg-cyan-300/60',
                dotActive: 'bg-cyan-200 shadow-[0_0_14px_rgba(34,211,238,0.9)]',
                dotInactive: 'bg-cyan-200/80 shadow-[0_0_10px_rgba(34,211,238,0.7)]',
                sheen: 'bg-[linear-gradient(120deg,rgba(6,182,212,0.25),rgba(59,130,246,0.4),rgba(14,116,144,0.25))]',
                halo: 'bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.35),transparent_60%)]',
            };
    const createdByFilterClass = [
        createdByFilterBase,
        createdByFilterTheme.surface,
        'saber-pulse',
        createdByFilterActive ? createdByFilterTheme.active : createdByFilterTheme.inactive,
        createdByFilterTheme.ring,
    ].join(' ');
    const quickFilterButtonBase = [
        'group relative isolate inline-flex items-center justify-center overflow-hidden rounded-[10px] border px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em]',
        'transition duration-200 ease-out active:translate-y-[1px]',
        'focus-visible:outline-none focus-visible:ring-2',
    ].join(' ');
    const quickFilterButtonTheme = isLight
        ? {
            active:
                'border-sky-400/90 text-slate-900 bg-gradient-to-b from-sky-200 via-sky-300 to-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_0_16px_rgba(56,189,248,0.45)] ring-1 ring-sky-300/70 focus-visible:ring-sky-300/70',
            inactive:
                'border-slate-300/80 text-slate-700 bg-gradient-to-b from-white via-slate-100 to-slate-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_16px_rgba(15,23,42,0.15)] hover:border-sky-400/70 hover:text-slate-900 focus-visible:ring-sky-300/60',
            overlay:
                'bg-[linear-gradient(135deg,rgba(255,255,255,0.7),transparent_45%,rgba(148,163,184,0.35))]',
            edgeTop: 'bg-white/80',
            edgeBottom: 'bg-slate-300/70',
        }
        : isColorful
            ? {
                active:
                    'border-fuchsia-200/90 text-white bg-gradient-to-b from-fuchsia-300/90 via-sky-500/85 to-indigo-900/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_0_20px_rgba(217,70,239,0.6)] ring-1 ring-fuchsia-200/70 focus-visible:ring-fuchsia-300/60',
                inactive:
                    'border-sky-300/70 text-white/90 bg-gradient-to-b from-sky-400/45 via-indigo-700/55 to-slate-950/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_10px_18px_rgba(30,27,75,0.55)] hover:border-fuchsia-300/80 hover:text-white focus-visible:ring-fuchsia-300/60',
                overlay:
                    'bg-[linear-gradient(135deg,rgba(216,180,254,0.45),transparent_45%,rgba(30,27,75,0.6))]',
                edgeTop: 'bg-white/40',
                edgeBottom: 'bg-indigo-900/60',
            }
            : {
                active:
                    'border-cyan-200/90 text-white bg-gradient-to-b from-cyan-300/85 via-sky-500/80 to-blue-800/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_0_18px_rgba(34,211,238,0.6)] ring-1 ring-cyan-200/60 focus-visible:ring-cyan-300/70',
                inactive:
                    'border-sky-400/50 text-sky-100 bg-gradient-to-b from-sky-500/40 via-blue-700/45 to-slate-900/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_10px_18px_rgba(2,6,23,0.55)] hover:from-sky-400/50 hover:via-blue-600/55 hover:to-slate-900/90 hover:text-white focus-visible:ring-cyan-300/70',
                overlay:
                    'bg-[linear-gradient(135deg,rgba(255,255,255,0.18),transparent_45%,rgba(0,0,0,0.35))]',
                edgeTop: 'bg-white/40',
                edgeBottom: 'bg-black/50',
            };
    const getQuickFilterButtonClass = (isActive: boolean) =>
        [quickFilterButtonBase, isActive ? quickFilterButtonTheme.active : quickFilterButtonTheme.inactive].join(' ');
    const questFilterPanelClass = isLight
        ? 'border-sky-200/70 bg-gradient-to-r from-white via-sky-50 to-slate-100 shadow-[0_22px_48px_rgba(15,23,42,0.12)]'
        : isColorful
            ? 'border-fuchsia-300/30 bg-gradient-to-r from-indigo-950/85 via-fuchsia-950/75 to-slate-950/90 shadow-[0_24px_54px_rgba(91,33,182,0.45)]'
            : 'border-cyan-400/30 bg-gradient-to-r from-slate-950/90 via-cyan-950/40 to-slate-950/90 shadow-[0_25px_60px_rgba(8,145,178,0.22)]';
    const questFilterMetaClass = isLight
        ? 'text-slate-600'
        : isColorful
            ? 'text-fuchsia-200/80'
            : 'text-cyan-200/80';
    const questFilterTitleClass = isLight ? 'text-slate-900' : 'text-white';
    const questFilterBodyClass = isLight ? 'text-slate-600' : 'text-white/70';
    const filterControlBase = [
        'kanban-filter-control rounded-[10px] border px-4 py-2 text-sm transition',
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_10px_18px_rgba(2,6,23,0.4)]',
        'focus:outline-none focus:ring-2',
    ].join(' ');
    const filterControlTheme = isLight
        ? [
            'border-slate-300/80 text-slate-800',
            'bg-gradient-to-b from-white via-slate-100 to-slate-200',
            'shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_8px_16px_rgba(15,23,42,0.12)]',
            'focus:border-sky-400/80 focus:ring-sky-300/60',
        ].join(' ')
        : isColorful
            ? [
                'border-fuchsia-300/70 text-white',
                'bg-gradient-to-b from-indigo-950/85 via-slate-950/90 to-black/95',
                'shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_10px_18px_rgba(30,27,75,0.5)]',
                'focus:border-fuchsia-200/80 focus:ring-fuchsia-300/60',
            ].join(' ')
            : [
                'border-slate-500/40 text-slate-100',
                'bg-gradient-to-b from-slate-900/80 via-slate-950/90 to-black/95',
                'shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_10px_18px_rgba(2,6,23,0.55)]',
                'focus:border-cyan-200/80 focus:ring-cyan-300/60',
            ].join(' ');
    const filterSelectClass = [
        filterControlBase,
        filterControlTheme,
        'kanban-filter-select font-semibold uppercase tracking-[0.22em]',
    ].join(' ');
    const filterPlaceholderClass = isLight
        ? 'placeholder:text-slate-700'
        : isColorful
            ? 'placeholder:text-white'
            : 'placeholder:text-sky-100';
    const filterInputClass = [
        filterControlBase,
        filterControlTheme,
        'kanban-filter-input',
        'font-semibold uppercase tracking-[0.22em]',
        filterPlaceholderClass,
    ].join(' ');
    const dropdownMenuClass = isLight
        ? 'border-slate-200 bg-white/95 text-slate-800 shadow-[0_20px_45px_rgba(15,23,42,0.18)]'
        : isColorful
            ? 'border-fuchsia-300/40 bg-[#120a2e]/95 text-white shadow-[0_20px_45px_rgba(30,27,75,0.7)]'
            : 'border-slate-500/40 bg-[#081229]/95 text-slate-100 shadow-[0_20px_45px_rgba(2,6,23,0.7)]';
    const dropdownItemClass = [
        'w-full px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.22em] transition',
        isLight ? 'text-slate-700 hover:bg-slate-200/80' : isColorful ? 'text-white/90 hover:bg-white/10' : 'text-slate-100 hover:bg-white/10',
    ].join(' ');
    const dropdownItemActiveClass = isLight
        ? 'bg-sky-200/80 text-slate-900'
        : isColorful
            ? 'bg-fuchsia-500/35 text-white'
            : 'bg-sky-500/30 text-white';
    const dropdownButtonClass = filterSelectClass;
    const filterColorScheme = isLight ? 'light' : 'dark';
    const countPanelClass = isLight
        ? 'border-sky-200/70 bg-gradient-to-r from-sky-50 via-white to-slate-100 shadow-[0_18px_40px_rgba(15,23,42,0.12)]'
        : isColorful
            ? 'border-fuchsia-300/30 bg-gradient-to-r from-indigo-950/85 via-fuchsia-950/80 to-slate-950/90 shadow-[0_22px_52px_rgba(91,33,182,0.55)]'
            : 'border-cyan-400/25 bg-gradient-to-r from-slate-950/85 via-blue-950/80 to-slate-950/90 shadow-[0_20px_50px_rgba(8,145,178,0.22)]';
    const countCardBase = [
        'relative overflow-hidden rounded-2xl border px-4 py-3 min-w-[110px]',
        'transition duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_12px_24px_rgba(15,23,42,0.35)]',
    ].join(' ');
    const countCardTheme = isLight
        ? 'border-sky-200/80 bg-gradient-to-br from-white via-sky-50 to-slate-100 text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.95)]'
        : isColorful
            ? 'border-fuchsia-300/40 bg-gradient-to-br from-indigo-950/70 via-fuchsia-950/75 to-slate-950/80 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]'
            : 'border-white/15 bg-gradient-to-br from-slate-900/70 via-slate-950/85 to-black/90 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]';
    const countCardLabel = isLight ? 'text-slate-500' : isColorful ? 'text-white/70' : 'text-white/70';
    const countCardValue = isLight ? 'text-slate-900' : 'text-white';
    const countCardGlow = isLight
        ? 'bg-[radial-gradient(circle,rgba(56,189,248,0.18),transparent_70%)]'
        : isColorful
            ? 'bg-[radial-gradient(circle,rgba(217,70,239,0.25),transparent_70%)]'
            : 'bg-[radial-gradient(circle,rgba(34,211,238,0.25),transparent_70%)]';
    const statusOptions = useMemo(
        () => [
            { value: '', label: 'All Statuses' },
            ...STATUS_ORDER.map((status) => ({
                value: String(status),
                label: CUSTOM_STATUS_NAMES[status as TaskStatus]?.name || status.replace('_', ' '),
            })),
        ],
        [],
    );
    const priorityOptions = useMemo(
        () => [
            { value: '', label: 'All Priorities' },
            ...Object.values(TaskPriority).map((priority) => ({
                value: priority,
                label: priority,
            })),
        ],
        [],
    );
    const assigneeOptions = useMemo(() => {
        const list = (Array.from(usersMap.values()) as User[])
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((entry) => ({ value: entry.id, label: entry.name }));
        return [{ value: '', label: 'All Assignees' }, ...list];
    }, [usersMap]);
    const teamOptions = useMemo(
        () => [{ value: '', label: 'All Teams' }, ...departmentOptions.map((department) => ({ value: department, label: department }))],
        [departmentOptions],
    );
    const sortByOptions = useMemo(
        () => [
            { value: 'dueAt', label: 'Due Date' },
            { value: 'priority', label: 'Priority' },
            { value: 'status', label: 'Status' },
            { value: 'assignee', label: 'Assignee' },
            { value: 'lastUpdated', label: 'Last Updated' },
            { value: 'title', label: 'Title' },
        ],
        [],
    );
    const sortOrderOptions = useMemo(
        () => [
            { value: 'asc', label: 'Ascending' },
            { value: 'desc', label: 'Descending' },
        ],
        [],
    );

    const handleTaskClick = (taskId: string) => {
        setSelectedTaskId(taskId);
    };

    const handleCloseDetailModal = () => {
        setSelectedTaskId(null);
        refreshTasks();
    };

    const handleTaskCreated = () => {
        setCreateModalOpen(false);
        refreshTasks();
    };

    if (loading) {
        return <div className="text-center p-8">Loading tasks...</div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold text-text-primary">Tasks</h1>
                <div className="flex gap-2">
                    {(user?.role === Role.MANAGER || user?.role === Role.ADMIN || user?.role === Role.OWNER) && (
                        <button
                            onClick={() => setTemplateModalOpen(true)}
                            className="inline-flex items-center gap-2 rounded-full border border-primary/60 bg-primary/20 px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary/30"
                        >
                            <TagIcon className="h-4 w-4" />
                            Template
                        </button>
                    )}
                    <button
                        onClick={() => setCreateModalOpen(true)}
                        className="inline-flex items-center gap-2 rounded-full border border-primary/60 bg-primary/20 px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary/30"
                    >
                        <PlusIcon className="h-4 w-4" />
                        Create Task
                    </button>
                </div>
            </div>

            <div className={`rounded-3xl border p-5 ${questFilterPanelClass}`}>
                <div className="flex flex-col items-center justify-between gap-4 text-center md:flex-row md:text-left">
                    <div className="space-y-1">
                        <p className={`text-[10px] uppercase tracking-[0.5em] ${questFilterMetaClass}`}>Quest Filter</p>
                        <h2 className={`text-xl font-semibold ${questFilterTitleClass}`}>Task Created By Me</h2>
                        <p className={`text-sm ${questFilterBodyClass}`}>
                            Focus on the missions you spawned and keep them front and center.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setQuickFilter(createdByFilterActive ? '' : 'createdByMe')}
                        className={createdByFilterClass}
                        aria-pressed={createdByFilterActive}
                        title="Show tasks you created"
                    >
                        <span className={`pointer-events-none absolute inset-0 rounded-full ${createdByFilterTheme.sheen} saber-shift opacity-90`} />
                        <span className={`pointer-events-none absolute inset-0 rounded-full ${createdByFilterTheme.halo} opacity-90`} />
                        <span className={`pointer-events-none absolute -inset-4 rounded-full ${createdByFilterTheme.glow} blur-2xl opacity-80 transition duration-300 group-hover:opacity-100`} />
                        <span className="relative z-10 flex items-center gap-3">
                            <span className="relative flex h-3 w-3">
                                <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${createdByFilterTheme.ping}`} />
                                <span
                                    className={
                                        createdByFilterActive
                                            ? `relative inline-flex h-3 w-3 rounded-full ${createdByFilterTheme.dotActive}`
                                            : `relative inline-flex h-3 w-3 rounded-full ${createdByFilterTheme.dotInactive}`
                                    }
                                />
                            </span>
                            <span>Task Created By Me</span>
                        </span>
                    </button>
                </div>
            </div>

            <div className="rounded-2xl border border-rose-400/30 bg-gradient-to-r from-rose-950/80 via-slate-950/90 to-amber-950/80 px-4 py-3 shadow-[0_20px_50px_rgba(190,18,60,0.2)]">
                <style>{`
                    @keyframes taskNewsTicker {
                        0% { transform: translateX(0); }
                        100% { transform: translateX(-50%); }
                    }
                `}</style>
                <div className="flex items-center gap-3">
                    <span className="rounded-full bg-rose-600 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.4em] text-white shadow-[0_0_18px_rgba(244,63,94,0.65)]">
                        Mission Updates
                    </span>
                    <div className="flex-1 overflow-hidden">
                        {newsItems.length === 0 ? (
                            <span className="text-sm text-white/80">No task updates yet.</span>
                        ) : (
                            <div
                                className="flex w-max items-center gap-6 pr-8 text-sm text-white/90"
                                style={shouldAnimateNews ? { animation: 'taskNewsTicker 130s linear infinite' } : undefined}
                            >
                                {newsTickerItems.map((item, index) => (
                                    <span key={`${item.id}-${index}`} className="whitespace-nowrap">
                                        <span className="font-semibold text-amber-200">{item.department}</span>
                                        <span className="text-white/70"> team: </span>
                                        <span className="font-semibold text-white">{item.creator}</span>
                                        <span className="text-white/70"> created </span>
                                        <span className="text-sky-200">"{item.title}"</span>
                                        <span className="text-white/70"> for </span>
                                        <span className="font-semibold text-white">{item.assignee}</span>
                                        <span className="text-white/70">. Status: </span>
                                        <span className="font-semibold text-white">{item.status}</span>
                                        <span
                                            className={`ml-2 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${
                                                item.priority === TaskPriority.URGENT
                                                    ? 'border-rose-400/70 bg-rose-500/20 text-rose-100'
                                                    : item.priority === TaskPriority.HIGH
                                                        ? 'border-orange-400/70 bg-orange-500/20 text-orange-100'
                                                        : item.priority === TaskPriority.MEDIUM
                                                            ? 'border-amber-300/70 bg-amber-500/20 text-amber-100'
                                                            : 'border-emerald-300/70 bg-emerald-500/20 text-emerald-100'
                                            }`}
                                        >
                                            {item.priority}
                                        </span>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {canSeeTaskCounts && (
                <div className={`rounded-2xl border p-4 ${countPanelClass}`}>
                    <div className="flex flex-wrap items-center gap-3">
                        <div className={`${countCardBase} ${countCardTheme}`}>
                            <span className={`pointer-events-none absolute inset-0 ${countCardGlow}`} />
                            <p className={`relative text-[10px] uppercase tracking-[0.24em] ${countCardLabel}`}>Total tasks</p>
                            <p className={`relative text-lg font-semibold ${countCardValue}`}>{totalTasks}</p>
                        </div>
                        {statusSummary.map((item) => (
                            <div key={item.status} className={`${countCardBase} ${countCardTheme}`}>
                                <span className={`pointer-events-none absolute inset-0 ${countCardGlow}`} />
                                <p className={`relative text-[10px] uppercase tracking-[0.24em] ${countCardLabel}`}>{item.label}</p>
                                <p className={`relative text-lg font-semibold ${countCardValue}`}>{item.count}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Filters and Sorting */}
            <div className="flex flex-wrap gap-4 items-center">
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                    className={`${filterInputClass} min-w-[220px]`}
                    placeholder="Search tasks"
                />
                <FilterDropdown
                    value={statusFilter}
                    placeholder="All Statuses"
                    options={statusOptions}
                    onChange={setStatusFilter}
                    buttonClassName={dropdownButtonClass}
                    menuClassName={dropdownMenuClass}
                    itemClassName={dropdownItemClass}
                    activeItemClassName={dropdownItemActiveClass}
                />
                <FilterDropdown
                    value={priorityFilter}
                    placeholder="All Priorities"
                    options={priorityOptions}
                    onChange={setPriorityFilter}
                    buttonClassName={dropdownButtonClass}
                    menuClassName={dropdownMenuClass}
                    itemClassName={dropdownItemClass}
                    activeItemClassName={dropdownItemActiveClass}
                />
                <FilterDropdown
                    value={assigneeFilter}
                    placeholder="All Assignees"
                    options={assigneeOptions}
                    onChange={setAssigneeFilter}
                    buttonClassName={dropdownButtonClass}
                    menuClassName={dropdownMenuClass}
                    itemClassName={dropdownItemClass}
                    activeItemClassName={dropdownItemActiveClass}
                />
                <FilterDropdown
                    value={teamFilter}
                    placeholder="All Teams"
                    options={teamOptions}
                    onChange={setTeamFilter}
                    buttonClassName={dropdownButtonClass}
                    menuClassName={dropdownMenuClass}
                    itemClassName={dropdownItemClass}
                    activeItemClassName={dropdownItemActiveClass}
                />
                <input
                    type="text"
                    value={tagFilter}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTagFilter(e.target.value)}
                    className={filterInputClass}
                    placeholder="Filter by Tag"
                />
                <input
                    type="date"
                    value={dueDateFilter}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDueDateFilter(e.target.value)}
                    className={filterInputClass}
                    placeholder="Due Date"
                    style={{ colorScheme: filterColorScheme }}
                />
                <input
                    type="date"
                    value={creationDateFilter}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCreationDateFilter(e.target.value)}
                    className={filterInputClass}
                    placeholder="Creation Date"
                    style={{ colorScheme: filterColorScheme }}
                />
                <FilterDropdown
                    value={sortBy}
                    placeholder="Sort By"
                    options={sortByOptions}
                    onChange={setSortBy}
                    buttonClassName={dropdownButtonClass}
                    menuClassName={dropdownMenuClass}
                    itemClassName={dropdownItemClass}
                    activeItemClassName={dropdownItemActiveClass}
                />
                <FilterDropdown
                    value={sortOrder}
                    placeholder="Sort Order"
                    options={sortOrderOptions}
                    onChange={(value) => setSortOrder(value as 'asc' | 'desc')}
                    buttonClassName={dropdownButtonClass}
                    menuClassName={dropdownMenuClass}
                    itemClassName={dropdownItemClass}
                    activeItemClassName={dropdownItemActiveClass}
                />
                <div className="flex gap-2">
                    <button
                        onClick={() => setQuickFilter(quickFilter === 'myTasks' ? '' : 'myTasks')}
                        className={getQuickFilterButtonClass(quickFilter === 'myTasks')}
                    >
                        <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
                        <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
                        <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
                        <span className="relative z-10">My Tasks</span>
                    </button>
                    <button
                        onClick={() => setQuickFilter(quickFilter === 'overdue' ? '' : 'overdue')}
                        className={getQuickFilterButtonClass(quickFilter === 'overdue')}
                    >
                        <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
                        <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
                        <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
                        <span className="relative z-10">Overdue</span>
                    </button>
                    <button
                        onClick={() => setQuickFilter(quickFilter === 'completed' ? '' : 'completed')}
                        className={getQuickFilterButtonClass(quickFilter === 'completed')}
                    >
                        <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
                        <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
                        <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
                        <span className="relative z-10">Completed</span>
                    </button>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <button
                        onClick={() => changeViewMode('list')}
                        className={getQuickFilterButtonClass(viewMode === 'list')}
                        title="List View"
                    >
                        <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
                        <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
                        <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
                        <span className="relative z-10">List</span>
                    </button>
                    <button
                        onClick={() => changeViewMode('grid')}
                        className={getQuickFilterButtonClass(viewMode === 'grid')}
                        title="Grid View"
                    >
                        <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
                        <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
                        <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
                        <span className="relative z-10">Grid</span>
                    </button>
                    <button
                        onClick={() => changeViewMode('kanban')}
                        className={getQuickFilterButtonClass(viewMode === 'kanban')}
                        title="Kanban View"
                    >
                        <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
                        <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
                        <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
                        <span className="relative z-10">Kanban</span>
                    </button>
                </div>

                {/* Bulk Action Buttons - Always visible next to filters */}
                <div className="flex items-center gap-2 ml-4">
                    <button
                        onClick={toggleSelectAll}
                        className="rounded-full border border-border-color px-4 py-2 text-sm font-medium transition hover:border-primary hover:bg-primary/10 disabled:opacity-50"
                        disabled={visibleTaskIds.length === 0}
                        title={allSelected ? "Deselect all visible tasks" : "Select all visible tasks"}
                    >
                        {allSelected ? "Deselect All" : "Select All"}
                    </button>
                    {/* <button
                        onClick={deselectAllTasks}
                        className="rounded-full border border-border-color px-4 py-2 text-sm font-medium transition hover:border-primary hover:bg-primary/10 disabled:opacity-50"
                        disabled={selectedTaskIds.size === 0}
                        title="Deselect all selected tasks"
                    >
                        Deselect All
                    </button> */}
                    <button
                        onClick={handleBulkDelete}
                        className="rounded-full border border-red-400/50 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 hover:border-red-400 disabled:opacity-50 disabled:border-gray-300 disabled:text-gray-400"
                        disabled={selectedTaskIds.size === 0}
                        title="Delete all selected tasks"
                    >
                        Delete Selected ({selectedTaskIds.size})
                    </button>
                </div>
            </div>

            <div className="grid gap-4">
                {viewMode === 'list' && pagedTasks.map((task) => {
                    const theme = { ...DEFAULT_THEME, ...(TASK_STATUS_THEME[task.status] || {}) };
                    const showReadMore = task.description.trim().length > 100;
                    return (
                        <div
                            key={task.id}
                            className={`rounded-2xl border border-border-color p-4 bg-gradient-to-r ${theme.gradient} ${theme.glow} transition-all duration-300 hover:scale-[1.02] cursor-pointer`}
                            onMouseEnter={() => prefetchTaskDetail(task.id)}
                            onFocus={() => prefetchTaskDetail(task.id)}
                            onClick={() => handleTaskClick(task.id)}
                        >
                            <div className="flex items-center gap-4">
                                <input
                                    type="checkbox"
                                    checked={selectedTaskIds.has(task.id)}
                                    onChange={(e) => {
                                        toggleSelectTask(task.id);
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="rounded border-border-color bg-surface/50 text-primary focus:ring-primary"
                                />
                                <div className="flex-1">
                                    <h3 className="font-semibold text-text-primary line-clamp-2">{task.title}</h3>
                                    <p className="text-sm text-text-secondary line-clamp-2 break-words overflow-hidden">{task.description}</p>
                                    {showReadMore && (
                                      <span className="mt-1 inline-block text-xs font-semibold text-primary/80">Read more..</span>
                                    )}
                                    <div className="mt-2 flex items-center gap-2">
                                        <TaskStatusBadge status={task.status} />
                                        <TaskPriorityBadge priority={task.priority} />
                                        <span className="text-xs text-text-secondary">
                                            Assigned to: {formatAssigneeNames(task.assignedTo)}
                                        </span>
                                    </div>
                                    {renderPointsBadge(task)}
                                </div>
                            </div>
                        </div>
                    );
                })}
                {viewMode === 'grid' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                        {pagedTasks.map((task) => {
                            const theme = TASK_STATUS_THEME[task.status] || DEFAULT_THEME;
                            const showReadMore = task.description.trim().length > 100;
                            return (
                                <div
                                    key={task.id}
                                    className={`relative rounded-2xl border border-border-color p-4 bg-gradient-to-r ${theme.gradient} ${theme.glow} transition-all duration-300 hover:scale-[1.02] cursor-pointer`}
                                    onMouseEnter={() => prefetchTaskDetail(task.id)}
                                    onFocus={() => prefetchTaskDetail(task.id)}
                                    onClick={() => handleTaskClick(task.id)}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedTaskIds.has(task.id)}
                                        onChange={(e) => {
                                            toggleSelectTask(task.id);
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                        className="absolute top-3 left-3 z-10 rounded border-border-color bg-surface/50 text-primary focus:ring-primary h-4 w-4"
                                    />
                                    <div className="pt-1 pl-8"> {/* Padding for checkbox space */}
                                        <h3 className="min-h-[3rem] font-semibold text-text-primary line-clamp-2">{task.title}</h3>
                                        <p className="min-h-[2.5rem] text-sm text-text-secondary line-clamp-2 break-words overflow-hidden">{task.description}</p>
                                        {showReadMore && (
                                            <span className="mt-1 inline-block text-xs font-semibold text-primary/80">Read more..</span>
                                        )}
                                        <div className="mt-2 flex items-center gap-2">
                                            <TaskStatusBadge status={task.status} />
                                            <TaskPriorityBadge priority={task.priority} />
                                        </div>
                                        <div className="mt-2 text-xs text-text-secondary">
                                            Assigned to: {formatAssigneeNames(task.assignedTo)}
                                        </div>
                                        {renderPointsBadge(task)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
                {viewMode === 'kanban' && (
                    <div className="flex gap-4 overflow-x-auto">
                        {kanbanLoading && (
                            <div className="rounded-lg border border-border-color bg-surface/70 p-4 text-sm text-text-secondary">
                                Loading kanban...
                            </div>
                        )}
                        {!kanbanLoading && (kanbanData?.columns ?? []).length === 0 && (
                            <div className="rounded-lg border border-border-color bg-surface/70 p-4 text-sm text-text-secondary">
                                No tasks available.
                            </div>
                        )}
                        {(kanbanData?.columns ?? []).map((column) => (
                            <div key={column.status} className="min-w-[300px] bg-surface rounded-lg p-4">
                                <h2
                                    className="mb-4 font-semibold text-text-primary"
                                    title={CUSTOM_STATUS_NAMES[column.status]?.tooltip ?? 'Status info unavailable'}
                                >
                                    {column.title || CUSTOM_STATUS_NAMES[column.status]?.name || column.status}
                                </h2>
                                <div className="flex flex-col gap-3">
                                    {column.items.map((task) => {
                                        const showReadMore = task.description.trim().length > 100;
                                        return (
                                            <div
                                                key={task.id}
                                                className="rounded-lg border border-border-color bg-white p-3 shadow-sm"
                                                onMouseEnter={() => prefetchTaskDetail(task.id)}
                                            >
                                                <h3 className="min-h-[3rem] font-semibold text-text-primary line-clamp-2">
                                                    {task.title}
                                                </h3>
                                                <p className="min-h-[2.5rem] text-sm text-text-secondary line-clamp-2 break-words overflow-hidden">
                                                    {task.description}
                                                </p>
                                                {showReadMore && (
                                                    <span className="mt-1 inline-block text-xs font-semibold text-primary/80">
                                                        Read more..
                                                    </span>
                                                )}
                                                <div className="mt-2 flex items-center gap-2">
                                                    <TaskPriorityBadge priority={task.priority} />
                                                    <span className="text-xs text-text-secondary">
                                                        Assigned to: {formatAssigneeNames(task.assignedTo)}
                                                    </span>
                                                </div>
                                                <button
                                                    onMouseEnter={() => prefetchTaskDetail(task.id)}
                                                    onClick={() => handleTaskClick(task.id)}
                                                    className="mt-2 w-full rounded-full border border-primary/60 bg-primary/20 px-3 py-1 text-sm font-semibold text-primary transition hover:bg-primary/30 hover:border-primary"
                                                >
                                                    View
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Bottom buttons removed - now at top */}
            <div className="mt-6 grid gap-3 text-xs text-text-secondary md:grid-cols-[1fr_auto_1fr] md:items-center">
                <div className="flex items-center gap-2 md:justify-start">
                    <span className="text-xs uppercase tracking-[0.2em]">Rows</span>
                    <select
                        value={pageSize}
                        onChange={(event) => {
                            const nextValue = Number(event.target.value);
                            setPageSizeByView((prev) => ({ ...prev, [viewMode]: nextValue }));
                        }}
                        className="rounded-full border border-border-color bg-transparent px-3 py-2 text-sm font-medium text-text-primary shadow-[0_0_12px_rgba(56,189,248,0.2)]"
                    >
                        {[10, 20, 50, 100].map((value) => (
                            <option key={value} value={value}>
                                {value} per page
                            </option>
                        ))}
                    </select>
                </div>
                {totalPages > 1 && (
                    <div className="flex flex-wrap items-center justify-center gap-2">
                        <button
                            type="button"
                            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                            disabled={currentPage === 1}
                            className="rounded-full border border-border-color px-4 py-2 text-sm font-semibold uppercase tracking-[0.18em] text-text-primary shadow-[0_0_14px_rgba(56,189,248,0.2)] transition hover:border-primary hover:bg-primary/10 disabled:opacity-50"
                        >
                            Prev page
                        </button>
                        <button
                            type="button"
                            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                            disabled={currentPage === totalPages}
                            className="rounded-full border border-border-color px-4 py-2 text-sm font-semibold uppercase tracking-[0.18em] text-text-primary shadow-[0_0_14px_rgba(56,189,248,0.2)] transition hover:border-primary hover:bg-primary/10 disabled:opacity-50"
                        >
                            Next page
                        </button>
                        <span className="text-xs uppercase tracking-[0.2em]">
                            Page {currentPage} of {totalPages}
                        </span>
                    </div>
                )}
                <div className="hidden md:block" />
            </div>

            {isCreateModalOpen && (
                <CreateTaskModal
                    isOpen={isCreateModalOpen}
                    onClose={() => setCreateModalOpen(false)}
                    onTaskCreated={handleTaskCreated}
                />
            )}

            {selectedTaskId && (
                <TaskDetailModal
                    taskId={selectedTaskId}
                    isOpen={Boolean(selectedTaskId)}
                    initialTask={selectedTaskPreview}
                    onClose={handleCloseDetailModal}
                    usersMap={usersMap}
                    onTaskDeleted={() => {
                        setSelectedTaskId(null);
                        refreshTasks();
                    }}
                />
            )}

            {isTemplateModalOpen && (
                <TaskTemplateModal
                    isOpen={isTemplateModalOpen}
                    onClose={() => setTemplateModalOpen(false)}
                    onTemplateAssigned={() => {
                        setTemplateModalOpen(false);
                        refreshTasks();
                    }}
                />
            )}
        </div>
    );
};

export default Tasks;
