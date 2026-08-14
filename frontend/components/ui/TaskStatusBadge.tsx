import React from 'react';
import { TaskStatus, CUSTOM_STATUS_NAMES } from '../../types';
import {
  RocketLaunchIcon,
  ClipboardDocumentListIcon,
  PuzzlePieceIcon,
  FireIcon,
  AcademicCapIcon,
  NoSymbolIcon,
  TrophyIcon,
  XMarkIcon,
  TrashIcon,
} from '../icons';

const STATUS_ICONS: Record<TaskStatus, React.FC<React.SVGProps<SVGSVGElement>>> = {
  [TaskStatus.WAITING_FOR_REQUIREMENT]: RocketLaunchIcon,
  [TaskStatus.TODO]: ClipboardDocumentListIcon,
  [TaskStatus.IN_PROGRESS]: PuzzlePieceIcon,
  [TaskStatus.BLOCKED]: FireIcon,
  [TaskStatus.IN_REVIEW]: AcademicCapIcon,
  [TaskStatus.ON_HOLD]: NoSymbolIcon,
  [TaskStatus.DONE]: TrophyIcon,
  [TaskStatus.FAILED]: XMarkIcon,
  [TaskStatus.GRAVEYARD]: TrashIcon,
};

const STATUS_GRADIENTS: Record<TaskStatus, string> = {
  [TaskStatus.WAITING_FOR_REQUIREMENT]: 'from-slate-500/60 via-slate-600/60 to-slate-900/80',
  [TaskStatus.TODO]: 'from-indigo-500/60 via-sky-500/60 to-cyan-500/80',
  [TaskStatus.IN_PROGRESS]: 'from-purple-500/60 via-fuchsia-500/60 to-rose-500/80',
  [TaskStatus.BLOCKED]: 'from-rose-500/60 via-red-500/60 to-orange-500/80',
  [TaskStatus.IN_REVIEW]: 'from-emerald-500/60 via-teal-500/60 to-sky-400/80',
  [TaskStatus.ON_HOLD]: 'from-slate-500/60 via-slate-600/60 to-slate-700/80',
  [TaskStatus.DONE]: 'from-emerald-400/60 via-lime-400/60 to-amber-300/80',
  [TaskStatus.FAILED]: 'from-red-500/60 via-rose-500/60 to-pink-500/80',
  [TaskStatus.GRAVEYARD]: 'from-gray-500/60 via-gray-600/60 to-gray-900/80',
};

interface TaskStatusBadgeProps {
  status: TaskStatus;
  onClick?: () => void;
}

const TaskStatusBadge: React.FC<TaskStatusBadgeProps> = ({ status, onClick }) => {
  const Icon = STATUS_ICONS[status] || STATUS_ICONS[TaskStatus.TODO];
  const gradient = STATUS_GRADIENTS[status] || STATUS_GRADIENTS[TaskStatus.TODO];
  const name = CUSTOM_STATUS_NAMES[status]?.name || status || 'Unknown';
  const tooltip = CUSTOM_STATUS_NAMES[status]?.tooltip || '';

  const baseClass = `
    inline-flex items-center gap-2 rounded-full border border-white/30
    bg-gradient-to-r ${gradient} px-3 py-1 text-sm font-semibold text-white
    shadow-[0_0_8px_rgba(255,255,255,0.6)]
    transition-all duration-300 ease-in-out
    animate-pulse
  `;
  const interactiveClass = `
    hover:scale-110 hover:shadow-[0_0_15px_rgba(255,255,255,0.9)] hover:-translate-y-1
    active:scale-95 active:shadow-[0_0_5px_rgba(255,255,255,0.4)]
    focus:outline-none focus:ring-2 focus:ring-white/80
    cursor-pointer
  `;

  if (!onClick) {
    return (
      <span title={tooltip} className={`${baseClass}`}>
        <Icon className="h-5 w-5 animate-spin" />
        {name}
      </span>
    );
  }

  return (
    <button
      onClick={onClick}
      title={tooltip}
      className={`${baseClass} ${interactiveClass}`}
      type="button"
    >
      <Icon className="h-5 w-5 animate-spin" />
      {name}
    </button>
  );
};

export default TaskStatusBadge;
