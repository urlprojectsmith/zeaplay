import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Task, User, TaskStatus, TaskPriority, Role } from '../types';
import { useAuth, useSearch, useTheme } from '../hooks/useAuth';
import api from '../services/mockApi';
import TaskStatusBadge from '../components/ui/TaskStatusBadge';
import TaskPriorityBadge from '../components/ui/TaskPriorityBadge';
import { formatDate } from '../utils';
import TaskDetailModal from '../components/TaskDetailModal';
import { augmentTasksWithPoints, calculateUserPointsFromTasks } from '../utils/taskPoints';
import { loadPointsConfig, POINTS_CONFIG_UPDATED_EVENT } from '../utils/pointsConfigStorage';
import { LEVELS_CONFIG_UPDATED_EVENT, getLevelProgress, loadLevelsConfig } from '../utils/levelsConfigStorage';

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

const statusOrder: TaskStatus[] = [
    TaskStatus.WAITING_FOR_REQUIREMENT,
    TaskStatus.TODO,
    TaskStatus.IN_PROGRESS,
    TaskStatus.IN_REVIEW,
    TaskStatus.BLOCKED,
    TaskStatus.ON_HOLD,
    TaskStatus.DONE,
    TaskStatus.FAILED,
    TaskStatus.GRAVEYARD,
];

const focusStatuses: TaskStatus[] = [
    TaskStatus.TODO,
    TaskStatus.IN_PROGRESS,
    TaskStatus.IN_REVIEW,
];

const focusQueueStatusSet = new Set<TaskStatus>([
    TaskStatus.WAITING_FOR_REQUIREMENT,
    TaskStatus.TODO,
    TaskStatus.IN_PROGRESS,
]);

const completedStatuses = new Set<TaskStatus>([
    TaskStatus.DONE,
    TaskStatus.FAILED,
]);

const statusDetails: Record<TaskStatus, { label: string; legend: string; gradient: string; glow: string }> = {
    [TaskStatus.WAITING_FOR_REQUIREMENT]: {
        label: 'Awaiting Brief',
        legend: 'Gather intel',
        gradient: 'from-slate-500/25 via-slate-600/25 to-slate-800/30',
        glow: 'shadow-[0_25px_45px_rgba(100,116,139,0.35)]',
    },
    [TaskStatus.TODO]: {
        label: 'Ready Queue',
        legend: 'Prep to launch',
        gradient: 'from-indigo-500/25 via-sky-500/25 to-cyan-500/30',
        glow: 'shadow-[0_25px_45px_rgba(59,130,246,0.35)]',
    },
    [TaskStatus.IN_PROGRESS]: {
        label: 'Active Quest',
        legend: 'Stay in the zone',
        gradient: 'from-purple-500/25 via-fuchsia-500/25 to-rose-500/30',
        glow: 'shadow-[0_25px_45px_rgba(192,132,252,0.35)]',
    },
    [TaskStatus.IN_REVIEW]: {
        label: 'Review Bay',
        legend: 'Awaiting verdict',
        gradient: 'from-emerald-500/25 via-teal-500/25 to-sky-400/30',
        glow: 'shadow-[0_25px_45px_rgba(16,185,129,0.35)]',
    },
    [TaskStatus.BLOCKED]: {
        label: 'Blocked Path',
        legend: 'Needs assistance',
        gradient: 'from-rose-500/25 via-red-500/25 to-orange-500/30',
        glow: 'shadow-[0_25px_45px_rgba(248,113,113,0.35)]',
    },
    [TaskStatus.ON_HOLD]: {
        label: 'Paused Run',
        legend: 'Resume later',
        gradient: 'from-slate-400/25 via-slate-500/25 to-slate-600/30',
        glow: 'shadow-[0_25px_45px_rgba(148,163,184,0.3)]',
    },
    [TaskStatus.DONE]: {
        label: 'Completed',
        legend: 'Claim your XP',
        gradient: 'from-emerald-400/25 via-lime-400/25 to-amber-300/30',
        glow: 'shadow-[0_25px_45px_rgba(74,222,128,0.35)]',
    },
    [TaskStatus.FAILED]: {
        label: 'Failed',
        legend: 'Mission failed',
        gradient: 'from-cyan-400/25 via-emerald-400/25 to-teal-400/30',
        glow: 'shadow-[0_25px_45px_rgba(45,212,191,0.35)]',
    },
    [TaskStatus.GRAVEYARD]: {
        label: 'Archived',
        legend: 'Archived quests',
        gradient: 'from-gray-400/25 via-gray-500/25 to-gray-600/30',
        glow: 'shadow-[0_25px_45px_rgba(107,114,128,0.35)]',
    },
};

const getStatusDetails = (status: TaskStatus) => {
    return (
        statusDetails[status] || {
            label: status,
            legend: 'Track progress',
            gradient: 'from-slate-500/25 via-slate-600/25 to-slate-800/30',
            glow: 'shadow-[0_25px_45px_rgba(100,116,139,0.35)]',
        }
    );
};

const Dashboard: React.FC = () => {
    console.log('Dashboard.tsx: Dashboard component rendering');
    const [tasks, setTasks] = useState<Task[]>([]);
    const [allTasks, setAllTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [usersMap, setUsersMap] = useState<Map<string, User>>(new Map());
    const [levelsConfig, setLevelsConfig] = useState(() => loadLevelsConfig());
    const { user } = useAuth();
    const { debouncedSearchQuery } = useSearch();
    const { theme } = useTheme();
    const resolvedTheme = useResolvedTheme(theme as ThemeMode);
    const isDark = resolvedTheme === 'dark';
    const isColorful = resolvedTheme === 'colorful';

    const fetchDashboardData = useCallback(async () => {
        if (!user) {
            return;
        }
        setLoading(true);
        try {
            const [fetchedTasks, allUsers] = await Promise.all([
                api.getTasks(user.id, user.role),
                api.getUsers(),
            ]);

            const tasksWithPoints = augmentTasksWithPoints(fetchedTasks, { config: loadPointsConfig() });
            setAllTasks(tasksWithPoints);
            const myTasks = tasksWithPoints.filter((task) => task.assignedTo?.includes(user.id));
            setTasks(myTasks);

            const map = new Map<string, User>();
            allUsers.forEach((entry) => map.set(entry.id, entry));
            setUsersMap(map);
        } catch (error) {
            console.error('Failed to fetch dashboard data:', error);
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        fetchDashboardData();
    }, [fetchDashboardData]);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const handlePointsConfigChange = () => {
            setAllTasks((previous) => augmentTasksWithPoints(previous, { config: loadPointsConfig() }));
            setTasks((previous) => augmentTasksWithPoints(previous, { config: loadPointsConfig() }));
        };

        window.addEventListener(POINTS_CONFIG_UPDATED_EVENT, handlePointsConfigChange);
        return () => {
            window.removeEventListener(POINTS_CONFIG_UPDATED_EVENT, handlePointsConfigChange);
        };
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const handleLevelsConfigChange = (event: Event) => {
            const detail = (event as CustomEvent).detail as { levels?: unknown } | undefined;
            setLevelsConfig(Array.isArray(detail?.levels) ? (detail?.levels as ReturnType<typeof loadLevelsConfig>) : loadLevelsConfig());
        };

        window.addEventListener(LEVELS_CONFIG_UPDATED_EVENT, handleLevelsConfigChange);
        return () => {
            window.removeEventListener(LEVELS_CONFIG_UPDATED_EVENT, handleLevelsConfigChange);
        };
    }, []);

    const priorityLabel: Record<TaskPriority, string> = {
        [TaskPriority.LOW]: 'Low',
        [TaskPriority.MEDIUM]: 'Medium',
        [TaskPriority.HIGH]: 'High',
        [TaskPriority.URGENT]: 'Urgent',
    };

    const filteredTasks = useMemo(() => {
        if (!debouncedSearchQuery) {
            return tasks;
        }
        const query = debouncedSearchQuery.toLowerCase();
        return tasks.filter((task) => {
            const label = priorityLabel[task.priority as TaskPriority] || '';
            return (
                task.title.toLowerCase().includes(query) ||
                task.description.toLowerCase().includes(query) ||
                task.team.toLowerCase().includes(query) ||
                task.priority.toLowerCase().includes(query) ||
                label.toLowerCase().includes(query)
            );
        });
    }, [tasks, debouncedSearchQuery]);

    const focusQueueTasks = useMemo(() => {
        const roleWeight: Record<Role, number> = {
            [Role.OWNER]: 3,
            [Role.MANAGER]: 2,
            [Role.ADMIN]: 1,
            [Role.USER]: 0,
        };

        const priorityWeight: Record<TaskPriority, number> = {
            [TaskPriority.URGENT]: 3,
            [TaskPriority.HIGH]: 2,
            [TaskPriority.MEDIUM]: 1,
            [TaskPriority.LOW]: 0,
        };

        return [...filteredTasks]
            .filter((task) => focusQueueStatusSet.has(task.status))
            .sort((a, b) => {
                const aRole = usersMap.get(a.createdBy)?.role ?? Role.USER;
                const bRole = usersMap.get(b.createdBy)?.role ?? Role.USER;
                const roleDelta = (roleWeight[bRole] ?? 0) - (roleWeight[aRole] ?? 0);
                if (roleDelta !== 0) return roleDelta;

                const priorityDelta =
                    (priorityWeight[b.priority as TaskPriority] ?? 0) -
                    (priorityWeight[a.priority as TaskPriority] ?? 0);
                if (priorityDelta !== 0) return priorityDelta;

                const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
                const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
                return aDue - bDue;
            })
            .slice(0, 5);
    }, [filteredTasks, usersMap]);

    const tasksByStatus = useMemo(() => {
        return filteredTasks.reduce((acc, task) => {
            const key = task.status;
            if (!acc[key]) {
                acc[key] = [];
            }
            acc[key].push(task);
            return acc;
        }, {} as Record<TaskStatus, Task[]>);
    }, [filteredTasks]);

    const totalTasks = filteredTasks.length;
    const completedCount = filteredTasks.filter((task) => completedStatuses.has(task.status)).length;
    const focusCount = filteredTasks.filter((task) => focusStatuses.includes(task.status)).length;
    const blockedCount = filteredTasks.filter((task) => task.status === TaskStatus.BLOCKED).length;

    const xpScore = user ? calculateUserPointsFromTasks(allTasks, user.id, { user }) : 0;
    const levelProgressData = useMemo(() => getLevelProgress(xpScore, levelsConfig), [xpScore, levelsConfig]);
    const level = levelProgressData.level;
    const xpIntoLevel = levelProgressData.pointsIntoLevel;
    const levelProgress = levelProgressData.progressPercent;
    const levelSpan = levelProgressData.levelSpan;
    const xpToNextLevel = levelProgressData.pointsToNextLevel;
    const nextLevel = levelProgressData.nextLevel;

    const streakLength = Math.max(1, Math.min(30, completedCount + Math.floor(focusCount / 2)));
    const dailyObjective = Math.max(3, Math.ceil(totalTasks / 3));
    const momentumScore = Math.min(100, Math.round(((completedCount + focusCount) / Math.max(1, totalTasks)) * 100));

    const handleTaskClick = (taskId: string) => {
        setSelectedTaskId(taskId);
    };

    const handleCloseModal = () => {
        setSelectedTaskId(null);
    };

    const handleTaskDeleted = useCallback((_taskId: string) => {
        setSelectedTaskId(null);
        fetchDashboardData();
    }, [fetchDashboardData]);

    if (loading) {
        return <div className="text-center p-8">Loading your quests...</div>;
    }

    const heroBorder = isDark ? 'border-primary/40' : isColorful ? 'border-pink-200/60' : 'border-indigo-200/80';
    const heroGradient = isDark
        ? 'from-[#1e1b4b] via-[#312e81] to-[#4c1d95]'
        : isColorful
            ? 'from-[#a855f7]/40 via-[#ec4899]/50 to-[#38bdf8]/45'
            : 'from-[#ede9fe] via-[#dbeafe] to-[#fef9c3]';
    const heroTitle = isDark ? 'text-white' : 'text-slate-900';
    const heroSub = isDark ? 'text-white/80' : 'text-slate-600';
    const heroMeta = isDark ? 'text-white/60' : 'text-slate-500';
    const statCardBase = isDark
        ? 'border-white/15 bg-black/25 text-white/80'
        : isColorful
            ? 'border-white/60 bg-white/40 text-slate-900 shadow-[0_20px_45px_rgba(129,140,248,0.2)]'
            : 'border-slate-200 bg-white text-slate-800 shadow-sm';
    const statAccent = isDark ? 'text-white' : 'text-slate-900';

    const questCardBase = isDark
        ? 'bg-surface/70 border border-border-color/70 text-white'
        : 'bg-white/85 border border-slate-200 text-slate-800 shadow-sm';

    const pipelineSurface = isDark
        ? 'bg-surface/80 border border-border-color/70'
        : 'bg-white/85 border border-slate-200 shadow-sm';

    return (
        <div className="space-y-10">
            <style>
                {`
                    @keyframes dashboardPulse {
                        0%, 100% { transform: translate3d(0,0,0) scale(1); opacity: 0.9; }
                        50% { transform: translate3d(0,-8px,0) scale(1.02); opacity: 1; }
                    }
                    @keyframes dashboardGlow {
                        0%, 100% { box-shadow: 0 0 0 rgba(99,102,241,0.2); }
                        50% { box-shadow: 0 0 45px rgba(99,102,241,0.35); }
                    }
                    @keyframes dashboardSlide {
                        0% { transform: translateY(12px); opacity: 0; }
                        100% { transform: translateY(0); opacity: 1; }
                    }
                `}
            </style>

            <section className={`relative overflow-hidden rounded-3xl border ${heroBorder} bg-gradient-to-br ${heroGradient} p-8 shadow-[0_25px_70px_rgba(76,29,149,0.45)]`}>
                <div className={`pointer-events-none absolute -top-24 right-0 h-56 w-56 rounded-full ${isDark ? 'bg-primary/30' : 'bg-white/60'} blur-3xl`} />
                <div className={`pointer-events-none absolute bottom-0 left-0 h-52 w-52 rounded-full ${isDark ? 'bg-rose-500/30' : 'bg-amber-200/60'} blur-3xl`} />
                <div className="relative grid gap-6 lg:grid-cols-[1.2fr,1fr]">
                    <div>
                        <p className={`text-xs font-semibold uppercase tracking-[0.4em] ${heroMeta}`}>Command Center</p>
                        <h1 className={`mt-3 text-4xl font-extrabold drop-shadow ${heroTitle}`}>Welcome back, {user?.name?.split(' ')[0] || 'Pilot'}!</h1>
                        <p className={`mt-3 max-w-2xl text-sm ${heroSub}`}>
                            Your squad is counting on you. Check active quests, cash in rewards, and keep the streak alive. Complete your daily objectives to unlock bonus XP.
                        </p>
                        <div className="mt-6 grid gap-4 sm:grid-cols-2">
                            <div className={`${statCardBase} rounded-2xl border px-5 py-4 backdrop-blur animate-[dashboardSlide_0.6s_ease]`}>
                                <p className="text-xs uppercase tracking-[0.3em]">Level</p>
                                <p className="mt-2 text-3xl font-bold">Lv {level}</p>
                                <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
                                    <div
                                        className="h-full rounded-full bg-gradient-to-r from-amber-400 via-fuchsia-400 to-indigo-500"
                                        style={{ width: `${levelProgress}%` }}
                                    />
                                </div>
                                <p className={`mt-2 text-xs ${heroMeta}`}>
                                    {xpIntoLevel.toLocaleString()} / {levelSpan.toLocaleString()} XP &bull;{' '}
                                    {nextLevel ? `${xpToNextLevel.toLocaleString()} XP to Lv ${nextLevel.level}` : 'Max level reached'}
                                </p>
                            </div>
                            <div className={`${statCardBase} rounded-2xl border px-5 py-4 backdrop-blur animate-[dashboardSlide_0.75s_ease]`}>
                                <p className="text-xs uppercase tracking-[0.3em]">Momentum</p>
                                <p className="mt-2 text-3xl font-bold">{momentumScore}%</p>
                                <p className={`mt-3 text-sm ${heroSub}`}>
                                    {completedCount} quests cleared &bull; {focusCount} in focus lane &bull; {blockedCount} blocked
                                </p>
                                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                                    <span className={`rounded-full px-3 py-1 font-medium ${isDark ? 'bg-white/10 text-white/80' : 'bg-white/70 text-slate-700 shadow-sm'}`}>
                                        {streakLength}-day streak
                                    </span>
                                    <span className={`rounded-full px-3 py-1 font-medium ${isDark ? 'bg-white/10 text-white/80' : 'bg-white/70 text-slate-700 shadow-sm'}`}>
                                        Daily objective: {dailyObjective} quests
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="relative grid gap-4 sm:grid-cols-2">
                        {[
                            { label: 'Quests Assigned', value: totalTasks, accent: 'from-sky-400 via-indigo-400 to-purple-500', delay: '0s' },
                            { label: 'XP Banked', value: xpScore.toLocaleString(), accent: 'from-emerald-400 via-teal-400 to-cyan-400', delay: '0.08s' },
                            { label: 'Focus Lane', value: focusCount, accent: 'from-fuchsia-400 via-rose-400 to-orange-400', delay: '0.16s' },
                            { label: 'Unclaimed Rewards', value: Math.max(0, completedCount - 3), accent: 'from-amber-400 via-yellow-400 to-rose-400', delay: '0.24s' },
                        ].map((stat) => (
                            <div
                                key={stat.label}
                                className={`relative overflow-hidden rounded-2xl border ${statCardBase} px-4 py-5 animate-[dashboardSlide_0.6s_ease]`}
                                style={{ animationDelay: stat.delay }}
                            >
                                <div className="pointer-events-none absolute inset-0 opacity-60">
                                    <div className={`h-full w-full rounded-2xl bg-gradient-to-br ${stat.accent}`} />
                                </div>
                                <div className="relative">
                                    <p className="text-xs uppercase tracking-[0.3em]">{stat.label}</p>
                                    <p className={`mt-2 text-2xl font-bold ${statAccent}`}>{stat.value}</p>
                                    <p className={`mt-2 text-xs ${heroMeta}`}>Keep momentum high to unlock bonus loot.</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-[2fr,1fr]">
                <div className={`${pipelineSurface} rounded-3xl border p-6 backdrop-blur`}>
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-xs uppercase tracking-[0.3em] text-text-secondary">Quest Pipeline</p>
                            <h2 className="mt-2 text-2xl font-semibold text-text-primary">Mission Control</h2>
                        </div>
                        <div className="flex gap-2 text-xs text-text-secondary">
                            <span>Total: {totalTasks}</span>
                            <span>&bull; Completed: {completedCount}</span>
                        </div>
                    </div>
                    {totalTasks === 0 ? (
                        <div className="mt-6 rounded-2xl border border-dashed border-border-color/70 p-6 text-center text-text-secondary">
                            No quests assigned yet. Grab a mission from the Kanban board!
                        </div>
                    ) : (
                        <div className="mt-6 grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
                            {statusOrder
                                .filter((status) => tasksByStatus[status]?.length)
                                .map((status) => {
                                    const detail = getStatusDetails(status);
                                    const items = tasksByStatus[status];
                                    const progressValue = Math.min(100, Math.round((items.length / Math.max(1, totalTasks)) * 100));

                                    return (
                                        <div
                                            key={status}
                                            className={`relative overflow-hidden rounded-2xl border px-4 py-5 transition-transform duration-300 hover:-translate-y-1 hover:shadow-2xl ${detail.glow}`}
                                        >
                                            <div className="pointer-events-none absolute inset-0 opacity-80">
                                                <div className={`h-full w-full rounded-2xl bg-gradient-to-br ${detail.gradient}`} />
                                            </div>
                                            <div className="relative">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <p className="text-xs uppercase tracking-[0.3em] text-white/80">{detail.legend}</p>
                                                        <h3 className="mt-1 text-lg font-semibold text-white">{detail.label}</h3>
                                                    </div>
                                                    <span className="rounded-full bg-black/30 px-3 py-1 text-xs font-semibold text-white/80">
                                                        {items.length} quest{items.length > 1 ? 's' : ''}
                                                    </span>
                                                </div>
                                                <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-black/30">
                                                    <div
                                                        className="h-full rounded-full bg-white/70"
                                                        style={{ width: `${progressValue}%` }}
                                                    />
                                                </div>
                                                <p className="mt-3 text-xs text-white/70">{progressValue}% of current load</p>
                                                <div className="mt-4 space-y-3">
                                                    {items.slice(0, 3).map((task) => (
                                                        <button
                                                            type="button"
                                                            key={task.id}
                                                            onClick={() => handleTaskClick(task.id)}
                                                            className="group flex w-full items-start justify-between gap-3 rounded-xl bg-black/30 px-3 py-2 text-left transition hover:bg-black/40"
                                                        >
                                                            <div>
                                                                <p className="text-sm font-semibold text-white group-hover:text-amber-200">
                                                                    {task.title}
                                                                </p>
                                                                <p className="mt-1 text-xs text-white/70 line-clamp-2">{task.description}</p>
                                                            </div>
                                                            <TaskPriorityBadge priority={task.priority} />
                                                        </button>
                                                    ))}
                                                    {items.length > 3 && (
                                                        <p className="text-xs text-white/60">+{items.length - 3} more quests in this lane</p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>
                    )}
                </div>

                <div className="space-y-6">
                    <div className={`${questCardBase} rounded-3xl border p-6 backdrop-blur`}>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs uppercase tracking-[0.3em] text-text-secondary">Reporting</p>
                                <h2 className="mt-2 text-xl font-semibold text-text-primary">Daily Reports</h2>
                            </div>
                            <Link
                                to="/reporting"
                                className="rounded-full border border-border-color/70 px-3 py-1 text-xs font-semibold text-text-secondary transition hover:border-primary hover:text-primary"
                            >
                                Open
                            </Link>
                        </div>
                        <p className="mt-3 text-sm text-text-secondary">
                            Start your day, submit hourly checkpoints, and send your final report.
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2 text-xs text-text-secondary">
                            <span className="rounded-full border border-border-color/60 px-3 py-1">My Day</span>
                            <span className="rounded-full border border-border-color/60 px-3 py-1">Preview</span>
                            {(user?.role === Role.MANAGER || user?.role === Role.ADMIN || user?.role === Role.OWNER) && (
                                <span className="rounded-full border border-border-color/60 px-3 py-1">Team Status</span>
                            )}
                            {(user?.role === Role.ADMIN || user?.role === Role.OWNER) && (
                                <span className="rounded-full border border-border-color/60 px-3 py-1">Templates</span>
                            )}
                        </div>
                    </div>
                    <div className={`${questCardBase} rounded-3xl border p-6 backdrop-blur`}>
                        <h2 className="text-xl font-semibold text-text-primary">Focus Queue</h2>
                        <p className="text-sm text-text-secondary">These quests are closest to the loot timer.</p>
                        <div className="mt-4 space-y-4">
                            {focusQueueTasks.length === 0 ? (
                                <p className="text-sm text-text-secondary">No upcoming deadlines. Consider tackling backlog quests.</p>
                            ) : (
                                focusQueueTasks.map((task) => (
                                    <button
                                        type="button"
                                        key={task.id}
                                        onClick={() => handleTaskClick(task.id)}
                                        className="group w-full rounded-2xl border border-border-color/60 bg-background/60 px-4 py-3 text-left transition hover:border-primary hover:shadow-lg"
                                    >
                                        <div className="flex items-center justify-between">
                                            <p className="text-sm font-semibold text-text-primary group-hover:text-primary">{task.title}</p>
                                            <span className="text-xs text-text-secondary">
                                                {task.dueAt ? `Due ${formatDate(task.dueAt)}` : 'No due date'}
                                            </span>
                                        </div>
                                        <p className="mt-2 text-xs text-text-secondary line-clamp-2">{task.description}</p>
                                        <div className="mt-3 flex items-center gap-2 text-xs text-text-secondary">
                                            <TaskStatusBadge status={task.status} />
                                            <span>&bull;</span>
                                            <TaskPriorityBadge priority={task.priority} />
                                        </div>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>

                </div>
            </section>

            {selectedTaskId && (
                <TaskDetailModal
                    taskId={selectedTaskId}
                    isOpen={Boolean(selectedTaskId)}
                    onClose={handleCloseModal}
                    usersMap={usersMap}
                    onTaskDeleted={handleTaskDeleted}
                />
            )}
        </div>
    );
};

export default Dashboard;







