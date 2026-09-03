import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom';
import type { Task, User, KanbanColumn } from '../types';
import KanbanDocumentationModal from '../components/KanbanDocumentationModal';
import { Role, TaskStatus, TaskPriority, CUSTOM_STATUS_NAMES } from '../types';
import { useAuth, useSearch, useTheme } from '../hooks/useAuth';
import api from '../services/mockApi';
import TaskDetailModal from '../components/TaskDetailModal';
import CreateColumnModal from '../components/CreateColumnModal';
import EditColumnModal from '../components/EditColumnModal';
import Tooltip from '../components/ui/Tooltip';
import { formatDate, formatTaskStatus } from '../utils';
import { loadPointsConfig, POINTS_CONFIG_UPDATED_EVENT } from '../utils/pointsConfigStorage';
import { augmentTasksWithPoints, summarizeTaskPoints, formatPointsValue, normalizeDepartmentKey } from '../utils/taskPoints';
import { priorityPillStyle, stageColumnStyle } from '../utils/themeTokens';
import {
  PlusIcon,
  TrashIcon,
  PencilIcon,
  RocketLaunchIcon,
  ClipboardDocumentListIcon,
  PuzzlePieceIcon,
  FireIcon,
  AcademicCapIcon,
  TrophyIcon,
  XMarkIcon,
  NoSymbolIcon,
  QuestionMarkCircleIcon,
} from '../components/icons';

type DragState = {
  taskId: string | null;
  sourceColumn: string | null;
};

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

type StatusDetail = {
  label: string;
  legend: string;
  stageToken: string;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
};

// 9 stages aligned with task statuses
const statusDetails: { [K in TaskStatus]: StatusDetail } = {
  [TaskStatus.WAITING_FOR_REQUIREMENT]: {
    label: 'Battle Plan',
    legend: 'New / Ready',
    stageToken: '--color-stage-battle',
    icon: RocketLaunchIcon,
  },
  [TaskStatus.TODO]: {
    label: 'Case Filed',
    legend: 'Assigned / To Do',
    stageToken: '--color-stage-case',
    icon: ClipboardDocumentListIcon,
  },
  [TaskStatus.IN_PROGRESS]: {
    label: 'In Progress',
    legend: 'In Progress',
    stageToken: '--color-stage-progress',
    icon: PuzzlePieceIcon,
  },
  [TaskStatus.BLOCKED]: {
    label: 'Boss Encounter',
    legend: 'Blocked / Critical',
    stageToken: '--color-stage-boss',
    icon: FireIcon,
  },
  [TaskStatus.IN_REVIEW]: {
    label: 'Tactical Shift',
    legend: 'Review / Adjust before completion',
    stageToken: '--color-stage-tactical',
    icon: AcademicCapIcon,
  },
  [TaskStatus.ON_HOLD]: {
    label: 'On Hold',
    legend: 'Paused / Waiting',
    stageToken: '--color-stage-hold',
    icon: QuestionMarkCircleIcon,
  },
  [TaskStatus.DONE]: {
    label: 'Conquered',
    legend: 'Completed – Level Rewards',
    stageToken: '--color-stage-conquered',
    icon: TrophyIcon,
  },
  [TaskStatus.FAILED]: {
    label: 'Fallen',
    legend: 'Mission Failed – Could not complete',
    stageToken: '--color-stage-fallen',
    icon: XMarkIcon,
  },
  [TaskStatus.GRAVEYARD]: {
    label: 'Graveyard',
    legend: 'For inactive / archived tasks',
    stageToken: '--color-stage-graveyard',
    icon: NoSymbolIcon,
  },
};

const overdueExcludedStatuses = new Set<TaskStatus>([
  TaskStatus.DONE,
  TaskStatus.FAILED,
  TaskStatus.GRAVEYARD,
]);

const formatPriority = (value: TaskPriority) =>
  value
    .toLowerCase()
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');

const parseRangeToken = (value: string): { start: string; end: string } => {
  if (!value) {
    return { start: '', end: '' };
  }
  const [start, end] = value.split('..');
  if (!end) {
    return { start: value, end: value };
  }
  return { start, end };
};

const formatRangeLabel = (value: string): string => {
  if (!value) {
    return 'Date Range';
  }
  const { start, end } = parseRangeToken(value);
  if (!start) {
    return 'Date Range';
  }
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end || start}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return 'Date Range';
  }
  const startLabel = startDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  const endLabel = endDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return start === (end || start) ? startLabel : `${startLabel} - ${endLabel}`;
};

const toIsoDate = (value: Date): string => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const KanbanTaskCard: React.FC<any> = ({ task, assignees, creator, onDragStart, onClick, onEdit, theme, user }) => {
  const isLight = theme === 'light';
  const cardSurface = isLight
    ? 'border-slate-200 bg-white shadow-sm'
    : 'border-white/10 bg-white/5 shadow-[0_18px_40px_rgba(15,23,42,0.45)]';
  const cardTextPrimaryClass = isLight ? 'text-black' : 'text-white';
  const cardTextMutedClass = isLight ? 'text-black/75' : 'text-white/75';

  const assigneeNames = assignees.length > 0 ? assignees.map((a: any) => a.name).join(', ') : 'Unassigned';
  const pointsSummary = task.pointsBreakdown ? summarizeTaskPoints(task.pointsBreakdown) : null;
  const showReadMore = (task.description ?? '').trim().length > 100;
  const createdByName = creator?.name ?? 'Unknown';

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      onClick={() => onClick(task.id)}
      className={`rounded-2xl border p-4 transition hover:-translate-y-2 hover:shadow-xl ${cardSurface}`}
    >
      <div className="flex justify-between items-start">
        <p className={`min-h-[4.5rem] font-semibold text-sm line-clamp-3 ${cardTextPrimaryClass}`}>{task.title}</p>
        <span className="rounded-full border px-3 py-1 text-xs font-semibold" style={priorityPillStyle(task.priority)}>
          {formatPriority(task.priority)}
        </span>
      </div>
      <p className={`min-h-[2.5rem] text-xs mt-2 leading-5 line-clamp-2 break-words overflow-hidden ${cardTextMutedClass}`}>{task.description}</p>
      {showReadMore && (
        <span className="mt-1 inline-block text-xs font-semibold text-primary/80">Read more..</span>
      )}
      <div className={`mt-3 grid gap-1 text-xs ${cardTextMutedClass}`}>
        <div>Created by: {createdByName}</div>
        <div>Created at: {formatDate(task.createdAt, true)}</div>
        <div>Assigned to: {assigneeNames}</div>
        <div>Due date: {formatDate(task.dueAt)}</div>
      </div>

      {pointsSummary && (
        <div className={`mt-2 text-[11px] ${cardTextMutedClass}`}>
          {pointsSummary.label}: {formatPointsValue(pointsSummary.value)}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => onClick(task.id)}
          className={`flex-1 rounded-full border border-blue-400 bg-blue-500/10 px-3 py-1 text-sm hover:bg-blue-500/20 ${cardTextPrimaryClass}`}
        >
          View
        </button>
        {(user?.role === Role.MANAGER || user?.role === Role.ADMIN || user?.role === Role.OWNER) && (
          <button
            onClick={() => onEdit(task.id)}
            className={`flex-1 rounded-full border border-amber-400 bg-amber-500/10 px-3 py-1 text-sm hover:bg-amber-500/20 ${cardTextPrimaryClass}`}
          >
            Edit
          </button>
        )}
      </div>
    </div>
  );
};

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

const KanbanBoard: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [usersMap, setUsersMap] = useState<Map<string, User>>(new Map());
  const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { searchQuery, setSearchQuery, debouncedSearchQuery } = useSearch();
  const { theme } = useTheme();
  const resolvedTheme = useResolvedTheme(theme as ThemeMode);
  const isColorful = resolvedTheme === 'colorful';
  const isLight = resolvedTheme === 'light';
  const boardTextClass = isLight ? 'text-black' : 'text-white';
  const boardMutedTextClass = isLight ? 'text-black/70' : 'text-white/70';
  const boardTextColorHex = isLight ? '#000000' : '#FFFFFF';
  const boardRef = useRef<HTMLDivElement | null>(null);
  const dateRangeRef = useRef<HTMLDivElement | null>(null);
  const boardDragState = useRef<{ isDragging: boolean; startX: number; scrollLeft: number }>({
    isDragging: false,
    startX: 0,
    scrollLeft: 0,
  });

  // Filtering and sorting state
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('');
  const [teamFilter, setTeamFilter] = useState<string>('');
  const [dueDateFilter, setDueDateFilter] = useState<string>('');
  const [isDateRangeOpen, setDateRangeOpen] = useState(false);
  const [activeDatePreset, setActiveDatePreset] = useState<'7d' | '30d' | 'mtd' | 'ytd' | 'custom' | ''>('');
  const [quickFilter, setQuickFilter] = useState<string>('');
  const [pageSize, setPageSize] = useState<number>(20);
  const [pageIndex, setPageIndex] = useState<number>(0);

  const dateRangeLabel = useMemo(() => formatRangeLabel(dueDateFilter), [dueDateFilter]);
  const dateRangeTokens = useMemo(() => parseRangeToken(dueDateFilter), [dueDateFilter]);

  const applyDatePreset = useCallback((preset: '7d' | '30d' | 'mtd' | 'ytd') => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start = new Date(today);
    if (preset === '7d') {
      start.setDate(today.getDate() - 6);
    } else if (preset === '30d') {
      start.setDate(today.getDate() - 29);
    } else if (preset === 'mtd') {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
    } else {
      start = new Date(today.getFullYear(), 0, 1);
    }
    const startIso = toIsoDate(start);
    const endIso = toIsoDate(today);
    setDueDateFilter(`${startIso}..${endIso}`);
    setActiveDatePreset(preset);
  }, []);

  const updateDateRange = useCallback((start: string, end: string) => {
    if (!start && !end) {
      setDueDateFilter('');
      setActiveDatePreset('');
      return;
    }

    const normalizedStart = start || end;
    const normalizedEnd = end || start;
    setDueDateFilter(
      normalizedStart === normalizedEnd ? normalizedStart : `${normalizedStart}..${normalizedEnd}`,
    );
    setActiveDatePreset('custom');
  }, []);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [fetchedTasks, allUsers, deptData] = await Promise.all([
        api.getTasks(user.id, user.role),
        api.getUsers(),
        api.getDepartments(),
      ]);
      const relevantTasks =
        user.role === Role.USER ? fetchedTasks.filter((t) => t.assignedTo?.includes(user.id)) : fetchedTasks;
      setTasks(augmentTasksWithPoints(relevantTasks));

      const fixedColumns = Object.values(TaskStatus).map((status) => ({
        id: status,
        title: statusDetails[status]?.label || formatTaskStatus(status),
        order: 0,
        pipelineId: 'default',
      }));
      setColumns(fixedColumns);

      const map = new Map<string, User>();
      allUsers.forEach((entry: User) => map.set(entry.id, entry));
      setUsersMap(map);
      const departmentNames = Array.from(
        new Set(
          (deptData ?? [])
            .map((dept) => dept.name)
            .filter((name): name is string => Boolean(name)),
        ),
      ).sort((a, b) => a.localeCompare(b));
      setDepartmentOptions(departmentNames);
    } catch (err) {
      console.error('Failed to fetch Kanban data:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!isDateRangeOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!dateRangeRef.current || dateRangeRef.current.contains(event.target as Node)) {
        return;
      }
      setDateRangeOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDateRangeOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown, { passive: true });
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onEscape);
    };
  }, [isDateRangeOpen]);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, taskId: string) => {
    e.dataTransfer.setData('taskId', taskId);
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>, newStatus: TaskStatus) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData('taskId');
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus || !user) return;

    try {
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)));
      await api.updateTask(taskId, { status: newStatus }, user.id);
    } catch (err) {
      console.error('Failed to update task:', err);
      fetchData();
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => e.preventDefault();
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const handleTaskClick = (id: string) => setSelectedTaskId(id);
  const handleTaskEdit = (id: string) => setSelectedTaskId(id);

  const scrollBoard = (direction: 'left' | 'right') => {
    if (!boardRef.current) return;
    const distance = direction === 'left' ? -320 : 320;
    boardRef.current.scrollBy({ left: distance, behavior: 'smooth' });
  };

  const stopBoardDrag = () => {
    boardDragState.current.isDragging = false;
    if (boardRef.current) {
      boardRef.current.classList.remove('cursor-grabbing', 'select-none');
    }
  };

  const handleBoardMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!boardRef.current) return;
    boardDragState.current.isDragging = true;
    boardDragState.current.startX = event.pageX - boardRef.current.offsetLeft;
    boardDragState.current.scrollLeft = boardRef.current.scrollLeft;
    boardRef.current.classList.add('cursor-grabbing', 'select-none');
  };

  const handleBoardMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!boardDragState.current.isDragging || !boardRef.current) return;
    event.preventDefault();
    const x = event.pageX - boardRef.current.offsetLeft;
    const walk = x - boardDragState.current.startX;
    boardRef.current.scrollLeft = boardDragState.current.scrollLeft - walk;
  };

  const handleBoardMouseUp = () => {
    if (!boardDragState.current.isDragging) return;
    stopBoardDrag();
  };

  const handleBoardMouseLeave = () => {
    if (!boardDragState.current.isDragging) return;
    stopBoardDrag();
  };

  useEffect(() => {
    const handleWindowMouseUp = () => {
      if (!boardDragState.current.isDragging) return;
      boardDragState.current.isDragging = false;
      if (boardRef.current) {
        boardRef.current.classList.remove('cursor-grabbing', 'select-none');
      }
    };
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => window.removeEventListener('mouseup', handleWindowMouseUp);
  }, []);
  const handleCloseModal = () => {
    setSelectedTaskId(null);
    fetchData();
  };

  const filteredTasks = useMemo(() => {
    let filtered: Task[] = tasks;

    // Apply search
    if (typeof debouncedSearchQuery === 'string' && debouncedSearchQuery.length > 0) {
      const lowercasedQuery = debouncedSearchQuery.toLowerCase();
      filtered = filtered.filter((task) => {
        const assigneeNames = (task.assignedTo ?? [])
          .map((id) => usersMap.get(id)?.name?.toLowerCase() || '')
          .filter((name) => name !== '');
        const matchesAssignee = assigneeNames.some(name => name.includes(lowercasedQuery));
        return (
          task.title.toLowerCase().includes(lowercasedQuery) ||
          task.description.toLowerCase().includes(lowercasedQuery) ||
          task.team.toLowerCase().includes(lowercasedQuery) ||
          matchesAssignee ||
          (task.tags && task.tags.some(tag => tag.toLowerCase().includes(lowercasedQuery)))
        );
      });
    }

    // Apply filters
    if (statusFilter) {
      filtered = filtered.filter((task) => task.status === statusFilter as TaskStatus);
    }
    if (priorityFilter) {
      filtered = filtered.filter((task) => task.priority === priorityFilter as TaskPriority);
    }
    if (assigneeFilter) {
      filtered = filtered.filter((task) => task.assignedTo?.includes(assigneeFilter));
    }
    if (teamFilter) {
      const normalizedFilter = normalizeDepartmentKey(teamFilter);
      filtered = filtered.filter((task) => normalizeDepartmentKey(task.team) === normalizedFilter);
    }
    if (dueDateFilter) {
      const { start, end } = parseRangeToken(dueDateFilter);
      const lower = start ? new Date(`${start}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
      const upper = end ? new Date(`${end}T23:59:59`).getTime() : Number.POSITIVE_INFINITY;
      filtered = filtered.filter((task) => {
        if (!task.dueAt) {
          return false;
        }
        const dueAt = new Date(task.dueAt).getTime();
        if (Number.isNaN(dueAt)) {
          return false;
        }
        return dueAt >= lower && dueAt <= upper;
      });
    }
    // Apply quick filters
    if (quickFilter === 'createdByMe') {
      filtered = filtered.filter((task) => (user?.id ? task.createdBy === user.id : false));
    } else if (quickFilter === 'myTasks') {
      filtered = filtered.filter((task) => (user?.id ? task.assignedTo?.includes(user.id) : false));
    } else if (quickFilter === 'overdue') {
      filtered = filtered.filter(
        (task) =>
          task.dueAt &&
          new Date(task.dueAt).getTime() < Date.now() &&
          !overdueExcludedStatuses.has(task.status),
      );
    } else if (quickFilter === 'completed') {
      filtered = filtered.filter((task) => task.status === TaskStatus.DONE);
    }

    return filtered;
  }, [tasks, debouncedSearchQuery, usersMap, statusFilter, priorityFilter, assigneeFilter, teamFilter, dueDateFilter, quickFilter, user?.id]);

  const maxTasksInColumn = useMemo(() => {
    if (!columns.length) return 0;
    return columns.reduce((max, column) => {
      const count = filteredTasks.filter(
        (t) => statusDetails[t.status]?.label === column.title
      ).length;
      return Math.max(max, count);
    }, 0);
  }, [columns, filteredTasks]);

  const totalPages = Math.max(1, Math.ceil(maxTasksInColumn / pageSize));
  const canGoPrev = pageIndex > 0;
  const canGoNext = pageIndex + 1 < totalPages;

  useEffect(() => {
    if (pageIndex >= totalPages) {
      setPageIndex(Math.max(0, totalPages - 1));
    }
  }, [pageIndex, totalPages]);

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
  const statusOptions = useMemo(
    () => [
      { value: '', label: 'All Statuses' },
      ...Object.values(TaskStatus).map((status) => ({
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

  if (loading) return <div className={`text-center p-8 ${boardMutedTextClass}`}>Loading Battle Board...</div>;

  return (
    <div className={`kanban-theme-text flex flex-col space-y-6 ${boardTextClass}`} style={{ color: boardTextColorHex }}>
      <h1 className={`text-3xl font-bold mb-4 ${boardTextClass}`}>Battle Board ⚔️</h1>

      <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          value={searchQuery}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
          className={`${filterInputClass} min-w-[220px] sm:min-w-[320px]`}
          placeholder="Search Tasks"
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
        <div ref={dateRangeRef} className="relative min-w-[190px]">
          <button
            type="button"
            onClick={() => setDateRangeOpen((prev) => !prev)}
            className={`${dropdownButtonClass} flex w-full items-center justify-between gap-3 text-left`}
            aria-haspopup="dialog"
            aria-expanded={isDateRangeOpen}
          >
            <span className={dueDateFilter ? '' : 'opacity-80'}>{dateRangeLabel}</span>
            <ChevronIcon open={isDateRangeOpen} className="h-4 w-4 shrink-0 opacity-80 transition" />
          </button>
          {isDateRangeOpen && (
            <div className={`absolute left-0 top-full z-50 mt-2 w-[320px] max-w-[calc(100vw-2rem)] rounded-xl border p-3 ${dropdownMenuClass}`}>
              <div className="mb-2 grid grid-cols-4 gap-2">
                {([
                  { key: '7d', label: '7D' },
                  { key: '30d', label: '30D' },
                  { key: 'mtd', label: 'MTD' },
                  { key: 'ytd', label: 'YTD' },
                ] as const).map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => applyDatePreset(option.key)}
                    className={[
                      'rounded-lg border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] transition',
                      activeDatePreset === option.key
                        ? 'border-cyan-300/80 bg-cyan-500/20 text-cyan-100'
                        : 'border-white/20 bg-black/20 text-white/80 hover:border-cyan-300/70 hover:text-white',
                    ].join(' ')}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                <label className="block text-[10px] uppercase tracking-[0.2em] text-white/60">From</label>
                <input
                  type="date"
                  value={dateRangeTokens.start}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    updateDateRange(event.target.value, dateRangeTokens.end)
                  }
                  className={filterInputClass}
                  style={{ colorScheme: filterColorScheme }}
                />
                <label className="block text-[10px] uppercase tracking-[0.2em] text-white/60">To</label>
                <input
                  type="date"
                  value={dateRangeTokens.end}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    updateDateRange(dateRangeTokens.start, event.target.value)
                  }
                  className={filterInputClass}
                  style={{ colorScheme: filterColorScheme }}
                />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <button
                  type="button"
                  className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/80 hover:text-cyan-100"
                  onClick={() => {
                    setDueDateFilter('');
                    setActiveDatePreset('');
                  }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/80 hover:text-white"
                  onClick={() => setDateRangeOpen(false)}
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
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
            onClick={() => setQuickFilter(quickFilter === 'createdByMe' ? '' : 'createdByMe')}
            className={getQuickFilterButtonClass(quickFilter === 'createdByMe')}
          >
            <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
            <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
            <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
            <span className="relative z-10">Task Created By Me</span>
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

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className={getQuickFilterButtonClass(true)}
            title="Kanban View"
            aria-current="true"
          >
            <span className={`pointer-events-none absolute inset-0 rounded-[10px] ${quickFilterButtonTheme.overlay} opacity-80`} />
            <span className={`pointer-events-none absolute inset-x-2 top-1 h-px ${quickFilterButtonTheme.edgeTop}`} />
            <span className={`pointer-events-none absolute inset-x-2 bottom-1 h-px ${quickFilterButtonTheme.edgeBottom}`} />
            <span className="relative z-10">Kanban</span>
          </button>

        <button
          type="button"
          onClick={() => scrollBoard('left')}
          className="group relative z-20 inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-cyan-300/45 bg-slate-950/70 text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_10px_18px_rgba(2,6,23,0.55)] transition duration-200 hover:border-cyan-200/80 hover:text-cyan-50 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_0_18px_rgba(34,211,238,0.45)]"
          aria-label="Scroll board left"
        >
          <span className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.16),transparent_50%,rgba(14,116,144,0.45))] opacity-90" />
          <span className="pointer-events-none absolute inset-x-2 top-1 z-0 h-px bg-white/35" />
          <span className="pointer-events-none relative z-10 text-lg leading-none">{String.fromCharCode(0x2039)}</span>
        </button>
        <button
          type="button"
          onClick={() => scrollBoard('right')}
          className="group relative z-20 inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-cyan-300/45 bg-slate-950/70 text-cyan-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_10px_18px_rgba(2,6,23,0.55)] transition duration-200 hover:border-cyan-200/80 hover:text-cyan-50 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_0_18px_rgba(34,211,238,0.45)]"
          aria-label="Scroll board right"
        >
          <span className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.16),transparent_50%,rgba(14,116,144,0.45))] opacity-90" />
          <span className="pointer-events-none absolute inset-x-2 top-1 z-0 h-px bg-white/35" />
          <span className="pointer-events-none relative z-10 text-lg leading-none">{String.fromCharCode(0x203A)}</span>
        </button>
        </div>
      </div>
      </div>

      <div
        ref={boardRef}
        className="flex gap-6 overflow-x-auto overflow-y-visible pb-6 cursor-grab active:cursor-grabbing"
        onMouseDown={handleBoardMouseDown}
        onMouseMove={handleBoardMouseMove}
        onMouseLeave={handleBoardMouseLeave}
        onMouseUp={handleBoardMouseUp}
      >
        {columns.map((column) => {
          const tasksInColumn = filteredTasks.filter(
            (t) => statusDetails[t.status]?.label === column.title
          );
          const startIndex = pageIndex * pageSize;
          const visibleTasks = tasksInColumn.slice(startIndex, startIndex + pageSize);
          const detail = Object.values(statusDetails).find((s) => s.label === column.title);
          if (!detail) return null;
          const Icon = detail.icon;

          return (
            <div
              key={column.id}
              className="w-72 flex-shrink-0 rounded-3xl border border-white/15 p-5 backdrop-blur relative"
              onDrop={(e) => handleDrop(e, column.id as TaskStatus)}
              onDragOver={handleDragOver}
            >
              <div className="absolute inset-0 rounded-3xl opacity-90" style={stageColumnStyle(column.id as TaskStatus)} />
              <div className="relative flex flex-col gap-4">
                <div className="flex justify-between items-center">
                  <h3 className={`flex items-center gap-2 font-semibold ${boardTextClass}`}>
                    <Icon className="h-5 w-5" />
                    <Tooltip text={String(column.id)} triggerClassName="inline-flex items-center">
                      <span>{detail.label}</span>
                    </Tooltip>
                  </h3>
                  <span className={`text-xs ${boardMutedTextClass}`}>{tasksInColumn.length}</span>
                </div>

                <div className="space-y-4">
                  {visibleTasks.map((task) => {
                    const assignees = (task.assignedTo || []).map((id) => usersMap.get(id)).filter(Boolean) as User[];
                    const creator = usersMap.get(task.createdBy);
                    return (
                      <KanbanTaskCard
                        key={task.id}
                        task={task}
                        assignees={assignees}
                        creator={creator}
                        onDragStart={handleDragStart}
                        onClick={handleTaskClick}
                        onEdit={handleTaskEdit}
                        theme={resolvedTheme}
                        user={user || null}
                      />
                    );
                  })}
                  {tasksInColumn.length === 0 && (
                    <div className={`text-xs text-center py-6 border border-dashed rounded-2xl ${isLight ? 'border-slate-300 text-black/60' : 'border-white/20 text-white/60'}`}>
                      Drop quests here
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        <div className="w-72 flex-shrink-0">
          <button
            onClick={() => {}}
            className={`group flex h-full w-full flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-border-color/70 bg-surface/40 p-8 text-sm font-semibold transition-all duration-300 hover:border-primary hover:bg-primary/5 ${boardMutedTextClass}`}
          >
            <div className="grid h-12 w-12 place-items-center rounded-xl border-2 border-dashed border-current bg-white/5 group-hover:scale-110">
              <PlusIcon className="h-6 w-6" />
            </div>
            <span>Add Stage</span>
          </button>
        </div>
      </div>

      <div className={`rounded-3xl border p-5 ${isLight ? 'border-slate-200 bg-white' : 'border-white/10 bg-black/40'}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPageIndex((prev) => Math.max(0, prev - 1))}
              disabled={!canGoPrev}
              className={`rounded border px-4 py-2 text-sm font-semibold transition ${
                canGoPrev
                  ? (isLight ? 'border-slate-300 bg-white text-black hover:bg-slate-100' : 'border-white/20 bg-white/5 text-white hover:bg-white/10')
                  : (isLight ? 'border-slate-200 bg-slate-100 text-black/50 cursor-not-allowed' : 'border-white/10 bg-white/5 text-white/50 cursor-not-allowed')
              }`}
            >
              Prev page
            </button>
            <button
              type="button"
              onClick={() => setPageIndex((prev) => Math.min(totalPages - 1, prev + 1))}
              disabled={!canGoNext}
              className={`rounded border px-4 py-2 text-sm font-semibold transition ${
                canGoNext
                  ? (isLight ? 'border-slate-300 bg-white text-black hover:bg-slate-100' : 'border-white/20 bg-white/5 text-white hover:bg-white/10')
                  : (isLight ? 'border-slate-200 bg-slate-100 text-black/50 cursor-not-allowed' : 'border-white/10 bg-white/5 text-white/50 cursor-not-allowed')
              }`}
            >
              Next page
            </button>
            <span className={`text-xs ${boardMutedTextClass}`}>Page {pageIndex + 1} of {totalPages}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setPageSize(20);
                setPageIndex(0);
              }}
              className={`rounded border px-3 py-2 text-sm font-semibold transition ${
                pageSize === 20
                  ? (isLight ? 'border-cyan-400/70 bg-cyan-50 text-black' : 'border-cyan-300/70 bg-cyan-500/10 text-white')
                  : (isLight ? 'border-slate-300 bg-white text-black hover:bg-slate-100' : 'border-white/20 bg-white/5 text-white hover:bg-white/10')
              }`}
            >
              20 per page
            </button>
            <button
              type="button"
              onClick={() => {
                setPageSize(100);
                setPageIndex(0);
              }}
              className={`rounded border px-3 py-2 text-sm font-semibold transition ${
                pageSize === 100
                  ? (isLight ? 'border-cyan-400/70 bg-cyan-50 text-black' : 'border-cyan-300/70 bg-cyan-500/10 text-white')
                  : (isLight ? 'border-slate-300 bg-white text-black hover:bg-slate-100' : 'border-white/20 bg-white/5 text-white hover:bg-white/10')
              }`}
            >
              100 per page
            </button>
          </div>
        </div>
      </div>

      {selectedTaskId &&
        typeof window !== 'undefined' &&
        ReactDOM.createPortal(
          <TaskDetailModal
            taskId={selectedTaskId}
            isOpen={!!selectedTaskId}
            onClose={handleCloseModal}
            usersMap={usersMap}
            onTaskDeleted={() => setSelectedTaskId(null)}
          />,
          document.body
        )}
    </div>
  );
};

export default KanbanBoard;


