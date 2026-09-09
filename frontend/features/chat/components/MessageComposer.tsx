import React, { useEffect, useRef, useState } from 'react';
import { PaperAirplaneIcon, PaperClipIcon, XMarkIcon } from '../../../components/icons';
import { ChatAttachment, ChatMessage } from '../types';

type Props = {
  disabled?: boolean;
  placeholder?: string;
  replyTo?: ChatMessage | null;
  onCancelReply?: () => void;
  onSend: (content: string, options?: { replyToMessageId?: string | null; attachments?: ChatAttachment[] }) => Promise<void> | void;
  onTyping?: (typing: boolean) => void;
  onUploadAttachment?: (file: File, onProgress?: (progress: number) => void) => Promise<ChatAttachment>;
};

const pickerEmojis = ['👍', '🎉', '✨', '✅', '👀', '💜', '🔥', '🚀', '😊', '🙌', '💡', '📌'];

const MessageComposer: React.FC<Props> = ({ disabled, placeholder, replyTo, onCancelReply, onSend, onTyping, onUploadAttachment }) => {
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const typingTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => () => {
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setEmojiOpen(false);
        onCancelReply?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancelReply]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const next = content.trim();
    if ((!next && attachments.length === 0) || disabled) return;
    setContent('');
    const files = attachments;
    setAttachments([]);
    onTyping?.(false);
    await onSend(next, { replyToMessageId: replyTo?.id ?? null, attachments: files });
    onCancelReply?.();
  };

  const handleTyping = (value: string) => {
    setContent(value);
    onTyping?.(true);
    if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => onTyping?.(false), 1200);
  };

  const uploadFiles = async (files: FileList | File[]) => {
    if (!onUploadAttachment || disabled) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(files)) {
        const attachment = await onUploadAttachment(file, setUploadProgress);
        setAttachments((current) => [...current, attachment]);
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const insertText = (value: string) => {
    setContent((current) => `${current}${value}`);
    setEmojiOpen(false);
    textareaRef.current?.focus();
  };

  return (
    <form
      onSubmit={submit}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void uploadFiles(event.dataTransfer.files);
      }}
      className="border-t border-slate-200 bg-white/95 p-3 sm:p-4"
    >
      {replyTo && (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-2xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs text-slate-600">
          <span className="truncate">Replying to {replyTo.senderName}: {replyTo.content.slice(0, 96)}</span>
          <button type="button" aria-label="Cancel reply" onClick={onCancelReply} className="rounded-full p-1 font-semibold text-slate-500 hover:bg-white hover:text-slate-900">
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <span key={attachment.storageKey} className="rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700">
              {attachment.originalFileName}
            </span>
          ))}
        </div>
      )}

      {uploading && <div className="mb-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all" style={{ width: `${uploadProgress}%` }} /></div>}
      {uploadError && <div className="mb-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{uploadError}</div>}

      <div className="relative rounded-3xl border border-slate-200 bg-white p-2 shadow-[0_12px_34px_rgba(15,23,42,0.08)] transition focus-within:border-violet-300 focus-within:ring-4 focus-within:ring-violet-100">
        <div className="mb-1 flex items-center gap-1 px-1">
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => event.target.files && void uploadFiles(event.target.files)} />
          <button type="button" aria-label="Attach files" disabled={disabled || uploading} onClick={() => fileInputRef.current?.click()} className="grid h-8 w-8 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-sky-600 disabled:opacity-50">
            <PaperClipIcon className="h-5 w-5" />
          </button>
          <button type="button" aria-label="Open emoji picker" disabled={disabled} onClick={() => setEmojiOpen((value) => !value)} className="grid h-8 w-8 place-items-center rounded-xl text-sm font-black text-slate-500 transition hover:bg-slate-100 hover:text-violet-600 disabled:opacity-50">
            :)
          </button>
          <button type="button" aria-label="Insert mention" disabled={disabled} onClick={() => insertText('@')} className="grid h-8 w-8 place-items-center rounded-xl text-sm font-black text-slate-500 transition hover:bg-slate-100 hover:text-pink-600 disabled:opacity-50">
            @
          </button>
          <span className="ml-auto hidden text-[11px] font-semibold text-slate-400 sm:inline">Ctrl Enter to send</span>
        </div>

        {emojiOpen && (
          <div className="absolute bottom-full left-3 mb-2 grid grid-cols-6 gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
            {pickerEmojis.map((emoji) => (
              <button key={emoji} type="button" onClick={() => insertText(emoji)} className="grid h-8 w-8 place-items-center rounded-xl text-lg hover:bg-slate-100">{emoji}</button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(event) => handleTyping(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            disabled={disabled}
            rows={1}
            placeholder={disabled ? 'Select a conversation' : placeholder ?? 'Message this chat'}
            className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
          <button type="submit" aria-label="Send message" disabled={disabled || uploading || (!content.trim() && attachments.length === 0)} className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-600 to-blue-500 text-white shadow-lg shadow-violet-500/20 transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50">
            <PaperAirplaneIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
    </form>
  );
};

export default MessageComposer;
