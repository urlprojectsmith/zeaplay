import React from 'react';
import { ChatConversation } from '../types';
import { User } from '../../../types';
import { getConversationSubtitle, getConversationTitle, initials } from '../utils/conversation';
import { Bars3Icon, MagnifyingGlassIcon, SparklesIcon, UsersIcon } from '../../../components/icons';

type Props = {
  conversation: ChatConversation | null;
  currentUser?: User | null;
  presence?: 'ONLINE' | 'AWAY' | 'OFFLINE';
  detailsOpen: boolean;
  onOpenSidebar: () => void;
  onOpenSearch: () => void;
  onToggleDetails: () => void;
  onOpenPins: () => void;
};

const presenceClass = {
  ONLINE: 'bg-emerald-500 text-emerald-700',
  AWAY: 'bg-amber-500 text-amber-700',
  OFFLINE: 'bg-slate-400 text-slate-500',
};

const ChatHeader: React.FC<Props> = ({ conversation, currentUser, presence = 'OFFLINE', detailsOpen, onOpenSidebar, onOpenSearch, onToggleDetails, onOpenPins }) => {
  if (!conversation) {
    return (
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 text-sm text-slate-500">
        <button type="button" aria-label="Open conversations" onClick={onOpenSidebar} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 lg:hidden">
          <Bars3Icon className="h-5 w-5" />
        </button>
        Select a conversation
      </div>
    );
  }
  const title = getConversationTitle(conversation, currentUser);
  const subtitle = conversation.type === 'DIRECT'
    ? `${presence === 'ONLINE' ? 'Online' : presence === 'AWAY' ? 'Away' : 'Offline'}`
    : `${conversation.members.length} members`;

  return (
    <div className="flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-3">
      <button type="button" aria-label="Open conversations" onClick={onOpenSidebar} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 lg:hidden">
        <Bars3Icon className="h-5 w-5" />
      </button>
      <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 via-blue-500 to-cyan-500 font-bold text-white shadow-sm">
        {initials(title)}
        {conversation.type === 'DIRECT' && <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${presenceClass[presence].split(' ')[0]}`} />}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-base font-black text-slate-950">{title}</h2>
        <p className={`truncate text-xs ${conversation.type === 'DIRECT' ? presenceClass[presence].split(' ')[1] : 'text-slate-500'}`}>
          {subtitle} · {getConversationSubtitle(conversation)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" aria-label="Search this chat" onClick={onOpenSearch} className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-violet-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500">
          <MagnifyingGlassIcon className="h-5 w-5" />
        </button>
        <button type="button" aria-label="Pinned messages" onClick={onOpenPins} className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-amber-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500">
          <SparklesIcon className="h-5 w-5" />
        </button>
        <button type="button" aria-label={detailsOpen ? 'Hide members and details' : 'Show members and details'} onClick={onToggleDetails} className={`rounded-xl p-2 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 ${detailsOpen ? 'bg-violet-50 text-violet-600' : 'text-slate-500 hover:bg-slate-100 hover:text-violet-600'}`}>
          <UsersIcon className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
};

export default ChatHeader;
