import React, { useMemo, useState } from 'react';
import { ChatBubbleLeftEllipsisIcon, MagnifyingGlassIcon, PlusIcon, SparklesIcon, UsersIcon } from '../../../components/icons';
import { User } from '../../../types';
import { ChatConversation } from '../types';
import ConversationList from './ConversationList';

type Props = {
  currentUser?: User | null;
  conversations: ChatConversation[];
  selectedConversationId: string | null;
  loading: boolean;
  presenceByUserId: Record<string, 'ONLINE' | 'AWAY' | 'OFFLINE'>;
  onSelect: (id: string) => void;
  onOpenCreate: (mode: 'DIRECT' | 'GROUP' | 'SPACE') => void;
  onOpenSearch: () => void;
};

const ChatSidebar: React.FC<Props> = ({
  currentUser,
  conversations,
  selectedConversationId,
  loading,
  presenceByUserId,
  onSelect,
  onOpenCreate,
  onOpenSearch,
}) => {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'UNREAD' | 'DIRECT' | 'GROUP' | 'SPACE'>('ALL');
  const normalizedQuery = query.trim().toLowerCase();

  const filteredConversations = useMemo(() => conversations.filter((conversation) => {
    if (filter === 'UNREAD' && conversation.unreadCount < 1) return false;
    if (filter !== 'ALL' && filter !== 'UNREAD' && conversation.type !== filter) return false;
    if (!normalizedQuery) return true;
    const title = conversation.type === 'DIRECT'
      ? conversation.members.find((member) => member.userId !== currentUser?.id)?.name || 'Direct message'
      : conversation.name || 'Untitled conversation';
    const preview = conversation.lastMessage?.content || conversation.description || '';
    return `${title} ${preview}`.toLowerCase().includes(normalizedQuery);
  }), [conversations, currentUser?.id, filter, normalizedQuery]);

  const filters = [
    ['ALL', 'All'],
    ['UNREAD', 'Unread'],
    ['DIRECT', 'Direct'],
    ['GROUP', 'Groups'],
    ['SPACE', 'Spaces'],
  ] as const;

  return (
    <aside className="flex min-h-0 w-full flex-col border-r border-slate-200 bg-white/95 lg:w-[280px] lg:shrink-0">
      <div className="border-b border-slate-200 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-violet-600">Chat</p>
            <h1 className="text-xl font-black text-slate-950">Messages</h1>
          </div>
          <button type="button" onClick={() => onOpenCreate('DIRECT')} aria-label="New message" className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 to-blue-500 text-white shadow-lg shadow-violet-500/20 transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500">
            <PlusIcon className="h-5 w-5" />
          </button>
        </div>

        <button type="button" onClick={onOpenSearch} className="mt-4 flex w-full items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-sm text-slate-500 transition hover:border-sky-200 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500">
          <MagnifyingGlassIcon className="h-4 w-4" />
          Search
          <span className="ml-auto rounded-lg border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-400">Ctrl K</span>
        </button>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <button type="button" onClick={() => onOpenCreate('DIRECT')} className="rounded-2xl border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-700 transition hover:border-violet-200 hover:bg-violet-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500">New</button>
          <button type="button" onClick={() => onOpenCreate('GROUP')} className="rounded-2xl border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-700 transition hover:border-sky-200 hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500">Group</button>
          <button type="button" onClick={() => onOpenCreate('SPACE')} className="rounded-2xl border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500">Space</button>
        </div>

        <label className="mt-3 block">
          <span className="sr-only">Search conversations</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations..." className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-100" />
        </label>

        <div className="mt-3 flex gap-1 overflow-x-auto pb-1">
          {filters.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 ${filter === value ? 'bg-slate-950 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <ConversationList
        conversations={filteredConversations}
        currentUser={currentUser}
        selectedConversationId={selectedConversationId}
        loading={loading}
        presenceByUserId={presenceByUserId}
        onSelect={onSelect}
        sectionIcons={{
          pinned: <SparklesIcon className="h-4 w-4" />,
          direct: <ChatBubbleLeftEllipsisIcon className="h-4 w-4" />,
          group: <UsersIcon className="h-4 w-4" />,
        }}
      />
    </aside>
  );
};

export default ChatSidebar;
