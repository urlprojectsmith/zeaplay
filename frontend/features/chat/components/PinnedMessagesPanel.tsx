import React, { useEffect } from 'react';
import { SparklesIcon, XMarkIcon } from '../../../components/icons';
import { ChatPinnedMessage } from '../types';

type Props = {
  open: boolean;
  loading: boolean;
  pins: ChatPinnedMessage[];
  canManage?: boolean;
  onClose: () => void;
  onJump: (messageId: string) => void;
  onUnpin: (messageId: string) => void;
};

const PinnedMessagesPanel: React.FC<Props> = ({ open, loading, pins, canManage, onClose, onJump, onUnpin }) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-slate-200 bg-white shadow-2xl">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-gradient-to-r from-amber-50 to-violet-50 px-4 py-4">
        <SparklesIcon className="h-5 w-5 text-amber-500" />
        <h2 className="flex-1 text-base font-black text-slate-950">Pinned messages</h2>
        <button type="button" aria-label="Close pinned messages" onClick={onClose} className="rounded-xl p-2 text-slate-500 hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500">
          <XMarkIcon className="h-5 w-5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading && <div className="space-y-2">{[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-2xl bg-slate-100" />)}</div>}
        {!loading && pins.length === 0 && <p className="p-6 text-center text-sm text-slate-500">No pinned messages yet.</p>}
        {!loading && pins.map((pin) => (
          <article key={pin.id} className="mb-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm font-black text-slate-950">{pin.message.senderName}</p>
              <p className="text-xs text-slate-400">{new Date(pin.createdAt).toLocaleDateString()}</p>
            </div>
            <p className="mt-2 line-clamp-4 text-sm leading-6 text-slate-600">{pin.message.content || 'Attachment'}</p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => onJump(pin.messageId)} className="rounded-full bg-violet-50 px-3 py-1.5 text-xs font-black text-violet-700 hover:bg-violet-100">Jump</button>
              {canManage && <button type="button" onClick={() => onUnpin(pin.messageId)} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600 hover:bg-slate-200">Unpin</button>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
};

export default PinnedMessagesPanel;
