import React, { memo, useMemo, useState } from 'react';
import { EllipsisVerticalIcon, PaperClipIcon, PencilIcon, SparklesIcon, TrashIcon } from '../../../components/icons';
import { User } from '../../../types';
import { timeAgo } from '../../../utils';
import { ChatConversation, ChatMessage } from '../types';

type Props = {
  message: ChatMessage;
  currentUser?: User | null;
  conversation?: ChatConversation | null;
  grouped?: boolean;
  replyTo?: ChatMessage | null;
  onReply?: (message: ChatMessage) => void;
  onRetry?: (message: ChatMessage) => void;
  onToggleReaction?: (message: ChatMessage, emoji: string) => void;
  onEdit?: (message: ChatMessage, content: string) => void;
  onDelete?: (message: ChatMessage) => void;
  canManage?: boolean;
  onPin?: (message: ChatMessage) => void;
};

const quickReactions = ['👍', '🎉', '✨', '✅', '👀', '💜'];

const MessageItem: React.FC<Props> = ({ message, currentUser, conversation, grouped, replyTo, onReply, onRetry, onToggleReaction, onEdit, onDelete, canManage = false, onPin }) => {
  const mine = message.senderId === currentUser?.id;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactionOpen, setReactionOpen] = useState(false);
  const groupedReactions = useMemo(() => message.reactions.reduce<Record<string, number>>((acc, reaction) => {
    acc[reaction.emoji] = (acc[reaction.emoji] ?? 0) + 1;
    return acc;
  }, {}), [message.reactions]);

  if (message.messageType === 'SYSTEM') {
    return (
      <div className="flex justify-center py-1">
        <p className="rounded-full bg-slate-200/80 px-3 py-1 text-xs font-semibold text-slate-600">{message.content}</p>
      </div>
    );
  }

  const useBubble = conversation?.type === 'DIRECT';
  const canModify = mine && !message.deletedAt;
  const rowClass = useBubble ? `flex ${mine ? 'justify-end' : 'justify-start'}` : 'group flex gap-3';
  const containerClass = useBubble
    ? `max-w-[82%] rounded-3xl px-4 py-3 shadow-sm ${mine ? 'bg-gradient-to-br from-violet-600 to-blue-500 text-white' : 'bg-white text-slate-900 ring-1 ring-slate-200'}`
    : 'w-full rounded-2xl px-3 py-2 text-slate-900 transition hover:bg-white hover:shadow-sm';

  return (
    <div className={rowClass}>
      {!useBubble && !grouped && (
        <span className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-sky-500 text-xs font-black text-white">
          {(mine ? 'You' : message.senderName).slice(0, 2).toUpperCase()}
        </span>
      )}
      {!useBubble && grouped && <span className="w-9 shrink-0" />}
      <div className={`group/message relative ${containerClass}`}>
        {!grouped && (
          <div className="mb-1 flex items-center gap-2 text-xs opacity-75">
            <span className="font-semibold">{mine ? 'You' : message.senderName}</span>
            <span>{timeAgo(message.createdAt)}</span>
            {message.editedAt && <span>edited</span>}
          </div>
        )}
        {replyTo && (
          <button type="button" className="mb-2 block max-w-full truncate rounded-xl border-l-4 border-cyan-400 bg-slate-100/70 px-3 py-2 text-left text-xs text-slate-600 opacity-90">
            {replyTo.senderName}: {replyTo.content.slice(0, 80)}
          </button>
        )}
        {editing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onEdit?.(message, draft);
              setEditing(false);
            }}
            className="space-y-2"
          >
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} className="w-full rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100" />
            <div className="flex gap-2 text-xs">
              <button type="submit" className="rounded-full bg-violet-600 px-3 py-1 font-semibold text-white">Save</button>
              <button type="button" onClick={() => setEditing(false)} className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">Cancel</button>
            </div>
          </form>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.deletedAt ? 'This message was deleted' : message.content}</p>
        )}
        {message.attachments.length > 0 && (
          <div className="mt-3 grid gap-2">
            {message.attachments.map((attachment) => (
              attachment.mimeType.startsWith('image/') && attachment.url ? (
                <a key={attachment.storageKey} href={attachment.url} target="_blank" rel="noreferrer">
                  <img src={attachment.url} alt={attachment.originalFileName} loading="lazy" className="max-h-64 rounded-2xl border border-white/40 object-cover" />
                </a>
              ) : (
                <a key={attachment.storageKey} href={attachment.url ?? '#'} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white/80 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-sky-200">
                  <PaperClipIcon className="h-4 w-4 text-sky-500" />
                  <span className="min-w-0 flex-1 truncate">{attachment.originalFileName}</span>
                  <span className="text-slate-400">{Math.ceil(attachment.fileSize / 1024)} KB</span>
                </a>
              )
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {Object.entries(groupedReactions).map(([emoji, count]) => (
            <button key={emoji} type="button" onClick={() => onToggleReaction?.(message, emoji)} className="rounded-full border border-slate-200 bg-white/80 px-2 py-0.5 text-slate-700 shadow-sm transition hover:scale-105">
              {emoji} {count}
            </button>
          ))}
          {message.deliveryStatus === 'failed' && <button type="button" onClick={() => onRetry?.(message)} className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">Retry</button>}
          {message.deliveryStatus && <span className="text-slate-400">{message.deliveryStatus}</span>}
        </div>
        {!message.deletedAt && (
          <div className="absolute -top-4 right-3 flex items-center gap-1 rounded-full border border-slate-200 bg-white px-1 py-1 text-slate-500 shadow-lg sm:hidden sm:group-hover/message:flex sm:group-focus-within/message:flex">
            <button type="button" aria-label="React" onClick={() => setReactionOpen((value) => !value)} className="rounded-full px-2 py-1 text-xs font-bold hover:bg-violet-50 hover:text-violet-600">React</button>
            <button type="button" aria-label="Reply" onClick={() => onReply?.(message)} className="rounded-full px-2 py-1 text-xs font-bold hover:bg-sky-50 hover:text-sky-600">Reply</button>
            <button type="button" aria-label="More message actions" onClick={() => setMenuOpen((value) => !value)} className="rounded-full p-1 hover:bg-slate-100">
              <EllipsisVerticalIcon className="h-4 w-4" />
            </button>
          </div>
        )}
        {reactionOpen && (
          <div className="absolute right-8 top-6 z-10 flex gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
            {quickReactions.map((emoji) => (
              <button key={emoji} type="button" onClick={() => { onToggleReaction?.(message, emoji); setReactionOpen(false); }} className="grid h-8 w-8 place-items-center rounded-xl text-lg transition hover:scale-110 hover:bg-slate-100">
                {emoji}
              </button>
            ))}
          </div>
        )}
        {menuOpen && (
          <div className="absolute right-3 top-6 z-10 w-36 overflow-hidden rounded-2xl border border-slate-200 bg-white py-1 text-sm shadow-xl">
            {canModify && <button type="button" onClick={() => { setEditing(true); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-50"><PencilIcon className="h-4 w-4" /> Edit</button>}
            {canModify && <button type="button" onClick={() => { onDelete?.(message); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-rose-600 hover:bg-rose-50"><TrashIcon className="h-4 w-4" /> Delete</button>}
            {canManage && <button type="button" onClick={() => { onPin?.(message); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-amber-50"><SparklesIcon className="h-4 w-4" /> Pin</button>}
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(message.content); setMenuOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-50">Copy</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(MessageItem);
