import React from 'react';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  color: 'blue' | 'green' | 'yellow' | 'red' | 'gray' | 'purple';
  children: React.ReactNode;
}

const baseClasses =
  'group inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] shadow-lg backdrop-blur-sm transition-transform duration-200 hover:-translate-y-0.5';

const palette = {
  blue: 'bg-gradient-to-r from-sky-500/90 via-indigo-500/90 to-blue-500/90 text-white border border-white/20 shadow-[0_14px_30px_rgba(59,130,246,0.35)]',
  green: 'bg-gradient-to-r from-emerald-400/90 via-lime-400/90 to-amber-300/90 text-emerald-950 border border-white/30 shadow-[0_14px_30px_rgba(74,222,128,0.35)]',
  yellow: 'bg-gradient-to-r from-amber-300/90 via-amber-400/90 to-orange-400/90 text-amber-950 border border-white/30 shadow-[0_14px_30px_rgba(251,191,36,0.35)]',
  red: 'bg-gradient-to-r from-rose-500/90 via-red-500/90 to-orange-500/90 text-white border border-white/20 shadow-[0_14px_30px_rgba(248,113,113,0.4)]',
  gray: 'bg-gradient-to-r from-slate-500/90 via-slate-600/90 to-slate-700/90 text-white border border-white/10 shadow-[0_14px_30px_rgba(148,163,184,0.3)]',
  purple: 'bg-gradient-to-r from-violet-500/90 via-fuchsia-500/90 to-pink-500/90 text-white border border-white/20 shadow-[0_14px_30px_rgba(192,132,252,0.4)]',
} satisfies Record<string, string>;

const Badge: React.FC<BadgeProps> = ({ color, children, className = '', ...rest }) => {
  const paletteClasses = palette[color] ?? palette.blue;

  return (
    <span
      {...rest}
      className={`relative overflow-hidden ${baseClasses} ${paletteClasses} ${className}`.trim()}
    >
      <span className="relative z-10 drop-shadow-sm">{children}</span>
      <span className="pointer-events-none absolute inset-0 bg-white/15 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
    </span>
  );
};

export default Badge;
