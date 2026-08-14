import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../services/api';
import { useAuth } from '../hooks/useAuth';
import { User } from '../types';
import { timeAgo } from '../utils';
import {
  ChatAttachment,
  ChatRealtimeMessage,
  ChatReactionEvent,
  ChatSpaceSnapshot,
  ChatTypingEvent,
  useChatRealtime,
} from '../hooks/useChatRealtime';
import {
  MagnifyingGlassIcon,
  PlusIcon,
  PaperAirplaneIcon,
  UsersIcon,
  UserIcon,
  SparklesIcon,
  XMarkIcon,
  PaperClipIcon,
  GiftIcon,
  TagIcon,
  EllipsisVerticalIcon,
  StarIcon,
} from '../components/icons';

type ChatSpaceType = 'direct' | 'group' | 'personal';

type ChatSpace = {
  id: string;
  name: string;
  type: ChatSpaceType;
  memberIds: string[];
  createdBy: string;
  updatedAt: string;
  lastMessage?: string;
};

type ChatMessage = ChatRealtimeMessage & {
  reactions?: Record<string, string[]>;
};

type TypingPresence = {
  userId: string;
  preview: string;
  at: number;
};

type ChatStore = {
  spaces: ChatSpace[];
  messages: ChatMessage[];
  lastActiveSpaceId?: string;
};

const CHAT_STORAGE_PREFIX = 'zea-chat:';
const ATTACHMENT_LIMIT = 4;
const ATTACHMENT_MAX_BYTES = 350000;
const TYPING_IDLE_MS = 2200;
const TYPING_THROTTLE_MS = 900;
const TYPING_TTL_MS = 8000;

const createId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `chat_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const nowIso = () => new Date().toISOString();

const buildStorageKey = (userId: string) => `${CHAT_STORAGE_PREFIX}${userId}`;

const readStore = (userId: string): ChatStore => {
  if (typeof window === 'undefined') {
    return { spaces: [], messages: [] };
  }
  try {
    const raw = window.localStorage.getItem(buildStorageKey(userId));
    if (!raw) {
      return { spaces: [], messages: [] };
    }
    const parsed = JSON.parse(raw) as ChatStore;
    if (!parsed || !Array.isArray(parsed.spaces) || !Array.isArray(parsed.messages)) {
      return { spaces: [], messages: [] };
    }
    return parsed;
  } catch {
    return { spaces: [], messages: [] };
  }
};

const writeStore = (userId: string, store: ChatStore) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(buildStorageKey(userId), JSON.stringify(store));
  } catch {
  }
};

const ensurePersonalSpace = (store: ChatStore, user: User): ChatStore => {
  const hasPersonal = store.spaces.some(
    (space) => space.type === 'personal' && space.memberIds.includes(user.id),
  );
  if (hasPersonal) {
    return store;
  }
  const personalSpace: ChatSpace = {
    id: createId(),
    name: 'Personal Space',
    type: 'personal',
    memberIds: [user.id],
    createdBy: user.id,
    updatedAt: nowIso(),
    lastMessage: '',
  };
  return {
    ...store,
    spaces: [personalSpace, ...store.spaces],
    lastActiveSpaceId: store.lastActiveSpaceId ?? personalSpace.id,
  };
};

const Chat: React.FC = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [spaces, setSpaces] = useState<ChatSpace[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [spaceFilter, setSpaceFilter] = useState<'all' | 'direct' | 'spaces'>('all');
  const [composer, setComposer] = useState('');
  const [composerAttachments, setComposerAttachments] = useState<ChatAttachment[]>([]);
  const [composerError, setComposerError] = useState('');
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<Record<string, TypingPresence>>({});
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createType, setCreateType] = useState<ChatSpaceType>('direct');
  const [directUserId, setDirectUserId] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [personalName, setPersonalName] = useState('');
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const typingStopTimerRef = useRef<number | null>(null);
  const lastTypingSentRef = useRef(0);

  const normalizeMemberIds = useCallback((memberIds?: string[]) => {
    if (!memberIds) {
      return [];
    }
    return Array.from(new Set(memberIds.filter(Boolean)));
  }, []);

  const resolveSpaceType = useCallback(
    (snapshot: ChatSpaceSnapshot, memberIds: string[]): ChatSpaceType => {
      if (snapshot.type === 'direct' || snapshot.type === 'group' || snapshot.type === 'personal') {
        return snapshot.type;
      }
      if (memberIds.length === 1) {
        return 'personal';
      }
      if (memberIds.length === 2) {
        return 'direct';
      }
      return 'group';
    },
    [],
  );

  const ensureSpace = useCallback(
    (snapshot: ChatSpaceSnapshot) => {
      if (!snapshot?.id) {
        return;
      }
      const memberIds = normalizeMemberIds(snapshot.memberIds);
      setSpaces((prev) => {
        if (prev.some((space) => space.id === snapshot.id)) {
          return prev;
        }
        const createdBy = snapshot.createdBy || memberIds[0] || user?.id || '';
        const newSpace: ChatSpace = {
          id: snapshot.id,
          name: snapshot.name || 'New Space',
          type: resolveSpaceType(snapshot, memberIds),
          memberIds,
          createdBy,
          updatedAt: snapshot.updatedAt || nowIso(),
          lastMessage: snapshot.lastMessage || '',
        };
        return [newSpace, ...prev];
      });
    },
    [normalizeMemberIds, resolveSpaceType, user?.id],
  );

  useEffect(() => {
    if (!user) return;
    const initial = ensurePersonalSpace(readStore(user.id), user);
    setSpaces(initial.spaces);
    setMessages(initial.messages);
    setActiveSpaceId(initial.lastActiveSpaceId ?? initial.spaces[0]?.id ?? null);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    writeStore(user.id, {
      spaces,
      messages,
      lastActiveSpaceId: activeSpaceId ?? undefined,
    });
  }, [user, spaces, messages, activeSpaceId]);

  useEffect(() => {
    if (!user) return;
    api.getUsers()
      .then(setUsers)
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!activeSpaceId && spaces.length > 0) {
      setActiveSpaceId(spaces[0].id);
    }
  }, [activeSpaceId, spaces]);

  useEffect(() => {
    if (!messageEndRef.current) return;
    messageEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [activeSpaceId, messages.length]);

  const userMap = useMemo(() => new Map(users.map((item) => [item.id, item])), [users]);
  const messageMap = useMemo(() => new Map(messages.map((item) => [item.id, item])), [messages]);

  const updateSpaceOnMessage = useCallback(
    (spaceId: string, message: ChatMessage) => {
      const preview =
        message.body ||
        (message.attachments && message.attachments.length > 0
          ? `${message.attachments.length} attachment${message.attachments.length === 1 ? '' : 's'}`
          : '');
      setSpaces((prev) =>
        prev.map((space) =>
          space.id === spaceId
            ? { ...space, lastMessage: preview, updatedAt: message.createdAt }
            : space,
        ),
      );
    },
    [setSpaces],
  );

  const appendMessage = useCallback(
    (incoming: ChatMessage) => {
      if (incoming.space) {
        ensureSpace(incoming.space);
      } else if (incoming.memberIds && incoming.memberIds.length > 0) {
        ensureSpace({
          id: incoming.spaceId,
          memberIds: incoming.memberIds,
          updatedAt: incoming.createdAt,
        });
      }
      setMessages((prev) => {
        if (prev.some((message) => message.id === incoming.id)) {
          return prev;
        }
        return [...prev, incoming];
      });
      updateSpaceOnMessage(incoming.spaceId, incoming);
    },
    [ensureSpace, updateSpaceOnMessage],
  );

  const mergeHistory = useCallback(
    (history: ChatMessage[]) => {
      if (!history.length) {
        return;
      }
      setMessages((prev) => {
        const existingIds = new Set(prev.map((message) => message.id));
        const merged = [...prev];
        history.forEach((message) => {
          if (!existingIds.has(message.id)) {
            merged.push(message);
          }
        });
        return merged;
      });
      const last = history[history.length - 1];
      if (last) {
        updateSpaceOnMessage(last.spaceId, last);
      }
    },
    [updateSpaceOnMessage],
  );

  const handleTypingEvent = useCallback(
    (payload: ChatTypingEvent) => {
      if (!activeSpaceId || payload.spaceId !== activeSpaceId || payload.userId === user?.id) {
        return;
      }
      setTypingUsers((prev) => {
        const next = { ...prev };
        if (!payload.isTyping) {
          delete next[payload.userId];
          return next;
        }
        next[payload.userId] = {
          userId: payload.userId,
          preview: payload.preview ?? '',
          at: Date.now(),
        };
        return next;
      });
    },
    [activeSpaceId, user?.id],
  );

  const handleReactionEvent = useCallback((payload: ChatReactionEvent) => {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== payload.messageId || message.spaceId !== payload.spaceId) {
          return message;
        }
        const reactions = { ...(message.reactions ?? {}) };
        const existing = new Set(reactions[payload.reaction] ?? []);
        if (existing.has(payload.userId)) {
          existing.delete(payload.userId);
        } else {
          existing.add(payload.userId);
        }
        reactions[payload.reaction] = Array.from(existing);
        return { ...message, reactions };
      }),
    );
  }, []);

  const {
    status: chatStatus,
    error: chatError,
    sendMessage: sendRealtimeMessage,
    sendTyping: sendRealtimeTyping,
    sendReaction: sendRealtimeReaction,
    sendSpace: sendRealtimeSpace,
  } = useChatRealtime({
    spaceId: activeSpaceId,
    onMessage: appendMessage,
    onHistory: mergeHistory,
    onTyping: handleTypingEvent,
    onReaction: handleReactionEvent,
    onSpace: (space) => {
      ensureSpace(space);
    },
  });

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTypingUsers((prev) => {
        const now = Date.now();
        const next: Record<string, TypingPresence> = {};
        Object.values(prev).forEach((entry) => {
          if (now - entry.at < TYPING_TTL_MS) {
            next[entry.userId] = entry;
          }
        });
        return next;
      });
    }, 2000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    setTypingUsers({});
  }, [activeSpaceId]);

  useEffect(() => {
    setComposer('');
    setComposerAttachments([]);
    setReplyToId(null);
    setComposerError('');
  }, [activeSpaceId]);

  const getSpaceTitle = (space: ChatSpace) => {
    if (space.type === 'direct') {
      const otherId = space.memberIds.find((id) => id !== user?.id);
      return userMap.get(otherId ?? '')?.name ?? space.name ?? 'Direct Chat';
    }
    return space.name || 'Untitled Space';
  };

  const getSpaceSubtitle = (space: ChatSpace) => {
    if (space.type === 'direct') return 'Direct message';
    if (space.type === 'group') return `${space.memberIds.length} members`;
    return 'Private workspace';
  };

  const activeSpace = useMemo(
    () => spaces.find((space) => space.id === activeSpaceId) ?? null,
    [spaces, activeSpaceId],
  );

  const activeMessages = useMemo(() => {
    if (!activeSpace) return [];
    return messages
      .filter((message) => message.spaceId === activeSpace.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [messages, activeSpace]);

  const replyTarget = useMemo(
    () => (replyToId ? messageMap.get(replyToId) ?? null : null),
    [messageMap, replyToId],
  );

  const typingLabel = useMemo(() => {
    const entries = Object.values(typingUsers);
    if (!entries.length) {
      return '';
    }
    const names = entries
      .map((entry) => userMap.get(entry.userId)?.name ?? 'Someone')
      .slice(0, 3);
    if (names.length === 1) {
      return `${names[0]} is typing`;
    }
    if (names.length === 2) {
      return `${names[0]} and ${names[1]} are typing`;
    }
    return `${names[0]}, ${names[1]} and others are typing`;
  }, [typingUsers, userMap]);

  const availableUsers = useMemo(
    () => users.filter((item) => item.id !== user?.id),
    [users, user],
  );

  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return availableUsers;
    }
    return availableUsers.filter((person) => {
      const name = person.name?.toLowerCase() ?? '';
      const department = person.department?.toLowerCase() ?? '';
      return name.includes(normalizedQuery) || department.includes(normalizedQuery);
    });
  }, [availableUsers, query]);

  const filteredSpaces = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const list = [...spaces].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!normalizedQuery) return list;
    return list.filter((space) => {
      const title = getSpaceTitle(space);
      return (
        title.toLowerCase().includes(normalizedQuery) ||
        (space.lastMessage ?? '').toLowerCase().includes(normalizedQuery)
      );
    });
  }, [spaces, query, userMap]);

  const filteredByTab = useMemo(() => {
    if (spaceFilter === 'direct') {
      return filteredSpaces.filter((space) => space.type === 'direct');
    }
    if (spaceFilter === 'spaces') {
      return filteredSpaces.filter((space) => space.type !== 'direct');
    }
    return filteredSpaces;
  }, [filteredSpaces, spaceFilter]);

  const groupedSpaces = useMemo(() => {
    const byType: Record<ChatSpaceType, ChatSpace[]> = {
      direct: [],
      group: [],
      personal: [],
    };
    filteredByTab.forEach((space) => {
      byType[space.type].push(space);
    });
    return byType;
  }, [filteredByTab]);

  const getMembers = (space: ChatSpace | null) => {
    if (!space) return [];
    return space.memberIds
      .map((id) => userMap.get(id))
      .filter((member): member is User => Boolean(member));
  };

  const findDirectSpace = (targetUserId: string) => {
    if (!user) return null;
    return spaces.find(
      (space) =>
        space.type === 'direct' &&
        space.memberIds.length === 2 &&
        space.memberIds.includes(user.id) &&
        space.memberIds.includes(targetUserId),
    );
  };

  const startDirectChat = (targetUserId: string) => {
    if (!user) return;
    const existing = findDirectSpace(targetUserId);
    if (existing) {
      setActiveSpaceId(existing.id);
      return;
    }
    const targetUser = userMap.get(targetUserId);
    if (!targetUser) return;
    const newSpace: ChatSpace = {
      id: createId(),
      name: targetUser.name,
      type: 'direct',
      memberIds: [user.id, targetUserId],
      createdBy: user.id,
      updatedAt: nowIso(),
      lastMessage: '',
    };
    setSpaces((prev) => [newSpace, ...prev]);
    setActiveSpaceId(newSpace.id);
    sendRealtimeSpace(newSpace);
  };

  const handleCreateSpace = () => {
    if (!user) return;
    if (createType === 'direct') {
      if (!directUserId) return;
      startDirectChat(directUserId);
      setIsCreateOpen(false);
      return;
    }
    if (createType === 'group') {
      const name = groupName.trim();
      if (!name) return;
      const members = Array.from(new Set([user.id, ...groupMembers]));
      if (members.length < 2) return;
      const newSpace: ChatSpace = {
        id: createId(),
        name,
        type: 'group',
        memberIds: members,
        createdBy: user.id,
        updatedAt: nowIso(),
        lastMessage: '',
      };
      setSpaces((prev) => [newSpace, ...prev]);
      setActiveSpaceId(newSpace.id);
      sendRealtimeSpace(newSpace);
      setIsCreateOpen(false);
      return;
    }
    if (createType === 'personal') {
      const name = personalName.trim() || 'Personal Space';
      const newSpace: ChatSpace = {
        id: createId(),
        name,
        type: 'personal',
        memberIds: [user.id],
        createdBy: user.id,
        updatedAt: nowIso(),
        lastMessage: '',
      };
      setSpaces((prev) => [newSpace, ...prev]);
      setActiveSpaceId(newSpace.id);
      sendRealtimeSpace(newSpace);
      setIsCreateOpen(false);
    }
  };

  const handleSendMessage = useCallback(() => {
    if (!user || !activeSpace) return;
    const body = composer.trim();
    if (!body && composerAttachments.length === 0) return;
    const message: ChatMessage = {
      id: createId(),
      spaceId: activeSpace.id,
      authorId: user.id,
      body,
      createdAt: nowIso(),
      replyTo: replyToId,
      attachments: composerAttachments.length > 0 ? composerAttachments : undefined,
      memberIds: activeSpace.memberIds && activeSpace.memberIds.length > 0 ? activeSpace.memberIds : [user.id],
      space: {
        id: activeSpace.id,
        name: activeSpace.name,
        type: activeSpace.type,
        memberIds: activeSpace.memberIds && activeSpace.memberIds.length > 0 ? activeSpace.memberIds : [user.id],
        createdBy: activeSpace.createdBy,
        updatedAt: activeSpace.updatedAt,
        lastMessage: activeSpace.lastMessage,
      },
    };
    appendMessage(message);
    setComposer('');
    setComposerAttachments([]);
    setReplyToId(null);
    setComposerError('');
    if (typingStopTimerRef.current) {
      window.clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }
    if (activeSpaceId) {
      sendRealtimeTyping({ spaceId: activeSpaceId, isTyping: false });
    }
    sendRealtimeMessage(message).catch((error) => {
      console.error('Failed to send message:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to send message';
      setComposerError(errorMessage);
      // Re-add the message content to composer so user can retry
      setComposer(body);
      // Restore attachments
      if (message.attachments && message.attachments.length > 0) {
        setComposerAttachments(message.attachments.map((att) => ({
          id: att.id,
          name: att.name,
          type: att.type,
          size: att.size,
          dataUrl: att.dataUrl,
        })));
      }
      // Remove from messages since it failed
      setMessages((prev) => prev.filter((m) => m.id !== message.id));
    });
  }, [
    activeSpace,
    activeSpaceId,
    appendMessage,
    composer,
    composerAttachments,
    replyToId,
    sendRealtimeMessage,
    sendRealtimeTyping,
    user,
  ]);

  const handleComposerChange = useCallback(
    (value: string) => {
      setComposer(value);
      if (!activeSpaceId) {
        return;
      }
      const trimmed = value.trim();
      const now = Date.now();
      if (now - lastTypingSentRef.current > TYPING_THROTTLE_MS) {
        sendRealtimeTyping({
          spaceId: activeSpaceId,
          isTyping: Boolean(trimmed),
          preview: trimmed.slice(0, 48),
        });
        lastTypingSentRef.current = now;
      }
      if (typingStopTimerRef.current) {
        window.clearTimeout(typingStopTimerRef.current);
      }
      typingStopTimerRef.current = window.setTimeout(() => {
        sendRealtimeTyping({ spaceId: activeSpaceId, isTyping: false });
      }, TYPING_IDLE_MS);
    },
    [activeSpaceId, sendRealtimeTyping],
  );

  const handleAttachmentSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      if (!files.length) {
        return;
      }
      setComposerError('');
      const remaining = Math.max(ATTACHMENT_LIMIT - composerAttachments.length, 0);
      if (!remaining) {
        setComposerError('Attachment limit reached.');
        return;
      }
      const selection = files.slice(0, remaining);
      const readFile = (file: File) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ''));
          reader.onerror = () => reject(new Error('Failed to read file'));
          reader.readAsDataURL(file);
        });

      const nextAttachments: ChatAttachment[] = [];
      for (const file of selection) {
        if (file.size > ATTACHMENT_MAX_BYTES) {
          setComposerError(`"${file.name}" is too large for realtime chat.`);
          continue;
        }
        try {
          const dataUrl = await readFile(file);
          nextAttachments.push({
            id: createId(),
            name: file.name,
            type: file.type || 'application/octet-stream',
            size: file.size,
            dataUrl,
          });
        } catch {
          setComposerError(`Unable to read "${file.name}".`);
        }
      }
      if (nextAttachments.length > 0) {
        setComposerAttachments((prev) => [...prev, ...nextAttachments]);
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [composerAttachments.length],
  );

  const handleRemoveAttachment = useCallback((attachmentId: string) => {
    setComposerAttachments((prev) => prev.filter((item) => item.id !== attachmentId));
  }, []);

  const handleReaction = useCallback(
    (messageId: string, reaction = 'star') => {
      if (!activeSpaceId || !user) {
        return;
      }
      setMessages((prev) =>
        prev.map((message) => {
          if (message.id !== messageId) {
            return message;
          }
          const reactions = { ...(message.reactions ?? {}) };
          const existing = new Set(reactions[reaction] ?? []);
          if (existing.has(user.id)) {
            existing.delete(user.id);
          } else {
            existing.add(user.id);
          }
          reactions[reaction] = Array.from(existing);
          return { ...message, reactions };
        }),
      );
      sendRealtimeReaction({ spaceId: activeSpaceId, messageId, reaction });
    },
    [activeSpaceId, sendRealtimeReaction, user],
  );

  const renderSpaceButton = (space: ChatSpace, index: number) => {
    const isActive = space.id === activeSpaceId;
    return (
      <button
        key={space.id}
        type="button"
        onClick={() => setActiveSpaceId(space.id)}
        className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
          isActive
            ? 'border-sky-200 bg-sky-100/70 text-slate-900 shadow-md dark:border-slate-600/80 dark:bg-slate-800/80 dark:text-white'
            : 'border-slate-200/80 bg-white/70 text-slate-700 hover:-translate-y-0.5 hover:border-slate-300 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200'
        }`}
        style={{ animation: `fadeSlide_up 0.35s ease ${index * 0.03}s both` }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">{getSpaceTitle(space)}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {getSpaceSubtitle(space)}
            </p>
          </div>
          <span className="rounded-full border border-slate-200/70 bg-white/70 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-500 dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-300">
            {space.type}
          </span>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          {space.lastMessage ? space.lastMessage : 'No messages yet.'}
        </p>
        <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-slate-400">
          <span>{space.memberIds.length} members</span>
          <span>{timeAgo(space.updatedAt)}</span>
        </div>
      </button>
    );
  };

  const chatStyles: React.CSSProperties = {
    '--chat-accent': '#0ea5e9',
    '--chat-ember': '#f97316',
    '--chat-panel': 'rgba(255, 255, 255, 0.85)',
    '--chat-panel-dark': 'rgba(15, 23, 42, 0.88)',
    '--chat-muted': '#64748b',
  } as React.CSSProperties;

  if (!user) {
    return (
      <div className="rounded-3xl border border-border-color bg-surface p-8 text-center text-sm text-text-secondary">
        Sign in to access chat spaces.
      </div>
    );
  }

  return (
    <div className="relative space-y-6" style={chatStyles}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Fraunces:wght@500;600&display=swap');
      `}</style>
      <header className="relative overflow-hidden rounded-[26px] border border-white/30 bg-[var(--chat-panel)] p-6 shadow-[0_25px_70px_rgba(15,23,42,0.15)] backdrop-blur-2xl dark:border-slate-700/60 dark:bg-[var(--chat-panel-dark)]">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-16 left-6 h-40 w-40 rounded-full bg-[radial-gradient(circle,_rgba(14,165,233,0.35)_0%,_rgba(14,165,233,0)_70%)] blur-3xl" />
          <div className="absolute -bottom-20 right-6 h-48 w-48 rounded-full bg-[radial-gradient(circle,_rgba(249,115,22,0.28)_0%,_rgba(249,115,22,0)_70%)] blur-3xl" />
        </div>
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.35em] text-[var(--chat-muted)]">
              Chat workspace
            </p>
            <h1
              className="mt-2 text-3xl font-semibold text-slate-900 dark:text-white"
              style={{ fontFamily: '"Fraunces", "Space Grotesk", serif' }}
            >
              Direct, group, and personal spaces
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Keep conversations focused and create new rooms in seconds.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex items-center gap-2 rounded-full border border-sky-200/70 bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-100"
            >
              <PlusIcon className="h-4 w-4" />
              Create space
            </button>
            <div className="rounded-full border border-slate-200/60 bg-white/70 px-4 py-2 text-xs text-slate-600 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-300">
              {spaces.length} spaces
            </div>
          </div>
        </div>
      </header>
      <div
        className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)_280px]"
        style={{ fontFamily: '"Space Grotesk", "Trebuchet MS", sans-serif' }}
      >
        <aside className="rounded-[26px] border border-white/30 bg-[var(--chat-panel)] p-4 shadow-[0_20px_60px_rgba(15,23,42,0.14)] backdrop-blur-2xl dark:border-slate-700/60 dark:bg-[var(--chat-panel-dark)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-[var(--chat-muted)]">Spaces</p>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Chat list</h2>
            </div>
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="rounded-full border border-sky-200/70 bg-white/80 p-2 text-slate-700 transition hover:-translate-y-0.5 hover:border-sky-300 dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-200"
              aria-label="Create chat space"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/70 px-3 py-2 text-sm text-slate-600 shadow-sm focus-within:border-sky-300 dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-200">
            <MagnifyingGlassIcon className="h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={spaceFilter === 'direct' ? 'Search users...' : 'Search chats...'}
              className="w-full bg-transparent text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none dark:text-slate-200"
            />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            {(['all', 'direct', 'spaces'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setSpaceFilter(tab)}
                className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] transition ${
                  spaceFilter === tab
                    ? 'border-sky-300 bg-sky-100 text-slate-900 dark:border-slate-500 dark:bg-slate-800 dark:text-white'
                    : 'border-slate-200/80 bg-white/70 text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="mt-4 max-h-[62vh] space-y-5 overflow-auto pr-1 custom-scrollbar">
            {spaceFilter === 'all' && (
              <div className="space-y-2">
                {filteredByTab.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-200/80 bg-white/60 p-3 text-xs text-slate-500 dark:border-slate-700/60 dark:bg-slate-900/50 dark:text-slate-300">
                    No chats yet. Start a new direct message or space.
                  </div>
                )}
                {filteredByTab.map((space, index) => renderSpaceButton(space, index))}
              </div>
            )}

            {spaceFilter === 'direct' && (
              <div className="space-y-5">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--chat-muted)]">
                    Direct
                  </p>
                  <div className="mt-2 space-y-2">
                    {groupedSpaces.direct.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-slate-200/80 bg-white/60 p-3 text-xs text-slate-500 dark:border-slate-700/60 dark:bg-slate-900/50 dark:text-slate-300">
                        No direct chats yet.
                      </div>
                    )}
                    {groupedSpaces.direct.map((space, index) => renderSpaceButton(space, index))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--chat-muted)]">
                      All users
                    </p>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
                      {filteredUsers.length} users
                    </span>
                  </div>
                  <div className="mt-2 space-y-2">
                    {filteredUsers.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-slate-200/80 bg-white/60 p-3 text-xs text-slate-500 dark:border-slate-700/60 dark:bg-slate-900/50 dark:text-slate-300">
                        No users found.
                      </div>
                    )}
                    {filteredUsers.map((person) => (
                      <button
                        key={person.id}
                        type="button"
                        onClick={() => startDirectChat(person.id)}
                        className="flex w-full items-center justify-between rounded-2xl border border-slate-200/80 bg-white/70 px-3 py-2 text-left text-sm text-slate-700 transition hover:-translate-y-0.5 hover:border-slate-300 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
                      >
                        <div>
                          <p className="font-semibold">{person.name}</p>
                          <p className="text-[11px] text-slate-400">{person.department ?? 'Team'}</p>
                        </div>
                        <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
                          {person.status === 'ACTIVE' ? 'Online' : 'Offline'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {spaceFilter === 'spaces' && (
              <div className="space-y-5">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--chat-muted)]">
                    Spaces
                  </p>
                  <div className="mt-2 space-y-2">
                    {groupedSpaces.group.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-slate-200/80 bg-white/60 p-3 text-xs text-slate-500 dark:border-slate-700/60 dark:bg-slate-900/50 dark:text-slate-300">
                        No group spaces yet.
                      </div>
                    )}
                    {groupedSpaces.group.map((space, index) => renderSpaceButton(space, index))}
                  </div>
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--chat-muted)]">
                    Personal
                  </p>
                  <div className="mt-2 space-y-2">
                    {groupedSpaces.personal.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-slate-200/80 bg-white/60 p-3 text-xs text-slate-500 dark:border-slate-700/60 dark:bg-slate-900/50 dark:text-slate-300">
                        No personal spaces yet.
                      </div>
                    )}
                    {groupedSpaces.personal.map((space, index) => renderSpaceButton(space, index))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
        <section className="flex min-h-[62vh] flex-col rounded-[26px] border border-white/30 bg-[var(--chat-panel)] shadow-[0_25px_70px_rgba(15,23,42,0.14)] backdrop-blur-2xl dark:border-slate-700/60 dark:bg-[var(--chat-panel-dark)]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/70 px-5 py-4 dark:border-slate-700/60">
            <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--chat-muted)]">
                {activeSpace ? activeSpace.type : 'Select a space'}
              </p>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                {activeSpace ? getSpaceTitle(activeSpace) : 'Choose a space'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {activeSpace ? getSpaceSubtitle(activeSpace) : 'Pick a chat or create a new one.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/70 px-3 py-1 text-xs text-slate-500 dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-300">
                <UsersIcon className="h-4 w-4" />
                {activeSpace ? activeSpace.memberIds.length : 0} members
              </div>
              <div className="flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/70 px-3 py-1 text-xs text-slate-500 dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-300">
                <span
                  className={`h-2 w-2 rounded-full ${
                    chatStatus === 'connected' ? 'bg-emerald-400' : 'bg-slate-400'
                  }`}
                />
                {chatStatus === 'connected' ? 'Live' : 'Offline'}
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-auto p-5 custom-scrollbar">
            {!activeSpace && (
              <div className="rounded-2xl border border-dashed border-slate-200/80 bg-white/70 p-6 text-center text-sm text-slate-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300">
                Select a space from the left or create one to start messaging.
              </div>
            )}
            {activeSpace && activeMessages.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200/80 bg-white/70 p-6 text-center text-sm text-slate-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300">
                No messages yet. Send the first message.
              </div>
            )}
            {activeSpace && activeMessages.map((message) => {
              const isSelf = message.authorId === user.id;
              const author = userMap.get(message.authorId);
              const replyMessage = message.replyTo ? messageMap.get(message.replyTo) : null;
              const reactions = message.reactions ?? {};
              return (
                <div key={message.id} className={`flex ${isSelf ? 'justify-end' : 'justify-start'}`}>
                  <div className={`group max-w-[72%] space-y-2 ${isSelf ? 'items-end text-right' : ''}`}>
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      {!isSelf && (
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          {author?.name?.slice(0, 1) ?? 'U'}
                        </span>
                      )}
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        {isSelf ? 'You' : author?.name ?? 'User'}
                      </span>
                      <span>{timeAgo(message.createdAt)}</span>
                    </div>
                    <div className="space-y-2">
                      {replyMessage && (
                        <div className="rounded-xl border border-slate-200/70 bg-white/70 px-3 py-2 text-xs text-slate-600 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300">
                          Replying to {replyMessage.authorId === user.id ? 'you' : userMap.get(replyMessage.authorId)?.name ?? 'user'}: {replyMessage.body.slice(0, 80) || 'Attachment'}
                        </div>
                      )}
                      {message.attachments && message.attachments.length > 0 && (
                        <div className="grid gap-2">
                          {message.attachments.map((attachment) => {
                            const isImage = attachment.type.startsWith('image/');
                            return (
                              <div
                                key={attachment.id}
                                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-xs text-slate-600 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300"
                              >
                                <div className="flex items-center gap-3">
                                  {isImage && attachment.dataUrl ? (
                                    <img
                                      src={attachment.dataUrl}
                                      alt={attachment.name}
                                      className="h-12 w-12 rounded-lg object-cover"
                                    />
                                  ) : (
                                    <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-200 text-[10px] font-semibold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                      File
                                    </span>
                                  )}
                                  <div>
                                    <p className="font-semibold">{attachment.name}</p>
                                    <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
                                      {(attachment.size / 1024).toFixed(1)} KB
                                    </p>
                                  </div>
                                </div>
                                {attachment.dataUrl && (
                                  <a
                                    href={attachment.dataUrl}
                                    download={attachment.name}
                                    className="rounded-full border border-slate-200/70 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-500 transition hover:border-slate-300 dark:border-slate-700/60 dark:text-slate-300"
                                  >
                                    Download
                                  </a>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {message.body && (
                        <div
                          className={`rounded-2xl px-4 py-3 text-sm shadow-sm ${
                            isSelf
                              ? 'bg-sky-500 text-white'
                              : 'bg-white text-slate-700 dark:bg-slate-900 dark:text-slate-200'
                          }`}
                        >
                          {message.body}
                        </div>
                      )}
                    </div>
                    <div
                      className={`flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-400 ${
                        isSelf ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setReplyToId(message.id)}
                        className="rounded-full border border-slate-200/70 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-500 transition hover:border-slate-300 dark:border-slate-700/60 dark:text-slate-300"
                      >
                        Reply
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReaction(message.id)}
                        className="flex items-center gap-1 rounded-full border border-slate-200/70 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-500 transition hover:border-slate-300 dark:border-slate-700/60 dark:text-slate-300"
                      >
                        <StarIcon className="h-3 w-3" />
                        Star
                      </button>
                      <span className="hidden items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-slate-400 group-hover:inline-flex">
                        <EllipsisVerticalIcon className="h-3 w-3" />
                        More
                      </span>
                    </div>
                    {Object.keys(reactions).length > 0 && (
                      <div
                        className={`flex flex-wrap gap-2 text-[11px] ${
                          isSelf ? 'justify-end' : 'justify-start'
                        }`}
                      >
                        {Object.entries(reactions).map(([key, userIds]) => (
                          <span
                            key={`${message.id}-${key}`}
                            className="rounded-full border border-slate-200/70 bg-white/70 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300"
                          >
                            {key} {userIds.length}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {activeSpace && typingLabel && (
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="h-2 w-2 rounded-full bg-sky-400" />
                <span>{typingLabel}</span>
              </div>
            )}
            <div ref={messageEndRef} />
          </div>

          <div className="border-t border-slate-200/70 p-4 dark:border-slate-700/60">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleAttachmentSelect}
              className="hidden"
            />
            <div className="space-y-3 rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-3 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/70">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/70 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-600 transition hover:border-slate-300 dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-300"
                >
                  <PaperClipIcon className="h-4 w-4" />
                  Attach
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/70 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-600 transition hover:border-slate-300 dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-300"
                >
                  <GiftIcon className="h-4 w-4" />
                  Gif
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/70 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-600 transition hover:border-slate-300 dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-300"
                >
                  <TagIcon className="h-4 w-4" />
                  Mention
                </button>
              </div>

              {replyTarget && (
                <div className="flex items-center justify-between rounded-xl border border-slate-200/70 bg-white/70 px-3 py-2 text-xs text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300">
                  <span>
                    Replying to {replyTarget.authorId === user.id ? 'you' : userMap.get(replyTarget.authorId)?.name ?? 'user'}: {replyTarget.body.slice(0, 80) || 'Attachment'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setReplyToId(null)}
                    className="rounded-full border border-slate-200/70 bg-white/80 p-1 text-slate-500 transition hover:border-slate-300 dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-300"
                    aria-label="Cancel reply"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </div>
              )}

              {composerAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {composerAttachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/70 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300"
                    >
                      <span>{attachment.name}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(attachment.id)}
                        className="text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
                      >
                        <XMarkIcon className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-end gap-3">
                <textarea
                  value={composer}
                  onChange={(event) => handleComposerChange(event.target.value)}
                  onBlur={() => {
                    if (activeSpaceId) {
                      sendRealtimeTyping({ spaceId: activeSpaceId, isTyping: false });
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  rows={2}
                  placeholder="Write a message..."
                  className="min-h-[48px] w-full resize-none bg-transparent text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none dark:text-slate-200"
                />
                <button
                  type="button"
                  onClick={handleSendMessage}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-500 text-white shadow transition hover:-translate-y-0.5 hover:bg-sky-600"
                  aria-label="Send message"
                >
                  <PaperAirplaneIcon className="h-5 w-5" />
                </button>
              </div>
            </div>
            {composerError && (
              <p className="mt-2 text-xs text-amber-500">{composerError}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-400">
              <span>Press Enter to send, Shift+Enter for a new line.</span>
              <span>
                {chatStatus === 'connected' ? 'Live' : 'Offline'} {chatError ? `- ${chatError}` : ''}
              </span>
            </div>
          </div>
        </section>
        <aside className="flex flex-col gap-4 rounded-[26px] border border-white/30 bg-[var(--chat-panel)] p-4 shadow-[0_20px_60px_rgba(15,23,42,0.14)] backdrop-blur-2xl dark:border-slate-700/60 dark:bg-[var(--chat-panel-dark)]">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--chat-muted)]">Space details</p>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
              {activeSpace ? getSpaceTitle(activeSpace) : 'No space selected'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {activeSpace ? getSpaceSubtitle(activeSpace) : 'Choose a space to see details.'}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white/70 p-3 dark:border-slate-700/60 dark:bg-slate-900/60">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              <SparklesIcon className="h-4 w-4" />
              Space stats
            </div>
            <div className="mt-3 grid gap-2 text-sm text-slate-700 dark:text-slate-200">
              <div className="flex items-center justify-between">
                <span>Type</span>
                <span className="font-semibold">{activeSpace?.type ?? '-'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Members</span>
                <span className="font-semibold">{activeSpace?.memberIds.length ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Last update</span>
                <span className="font-semibold">
                  {activeSpace ? timeAgo(activeSpace.updatedAt) : '-'}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white/70 p-3 dark:border-slate-700/60 dark:bg-slate-900/60">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              <UsersIcon className="h-4 w-4" />
              Members
            </div>
            <div className="mt-3 space-y-2">
              {getMembers(activeSpace).length === 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400">No members yet.</p>
              )}
              {getMembers(activeSpace).map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-200"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {member.name.slice(0, 1)}
                    </span>
                    <div>
                      <p className="font-semibold">{member.name}</p>
                      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                        {member.role}
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                    {member.status === 'ACTIVE' ? 'Online' : 'Offline'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white/70 p-3 dark:border-slate-700/60 dark:bg-slate-900/60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                <UserIcon className="h-4 w-4" />
                Quick direct messages
              </div>
              <button
                type="button"
                onClick={() => setIsCreateOpen(true)}
                className="text-xs uppercase tracking-[0.2em] text-sky-500"
              >
                New
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {availableUsers.slice(0, 4).map((person) => (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => startDirectChat(person.id)}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-left text-sm text-slate-700 transition hover:-translate-y-0.5 dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-200"
                >
                  <div>
                    <p className="font-semibold">{person.name}</p>
                    <p className="text-[11px] text-slate-400">{person.department ?? 'Team'}</p>
                  </div>
                  <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
                    {person.status === 'ACTIVE' ? 'Online' : 'Offline'}
                  </span>
                </button>
              ))}
              {availableUsers.length === 0 && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No other users found.
                </p>
              )}
            </div>
          </div>
        </aside>
      </div>
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-2xl rounded-[26px] border border-white/30 bg-[var(--chat-panel)] p-6 shadow-[0_30px_80px_rgba(15,23,42,0.2)] backdrop-blur-2xl dark:border-slate-700/60 dark:bg-[var(--chat-panel-dark)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--chat-muted)]">Create space</p>
                <h2 className="text-2xl font-semibold text-slate-900 dark:text-white">
                  Build a new chat space
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="rounded-full border border-slate-200/70 bg-white/80 p-2 text-slate-600 transition hover:-translate-y-0.5 dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-200"
                aria-label="Close"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {(['direct', 'group', 'personal'] as ChatSpaceType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setCreateType(type)}
                  className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                    createType === type
                      ? 'border-sky-300 bg-sky-100 text-slate-900 dark:border-slate-500 dark:bg-slate-800 dark:text-white'
                      : 'border-slate-200/80 bg-white/70 text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>

            <div className="mt-6 space-y-4">
              {createType === 'direct' && (
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--chat-muted)]">Choose a user</p>
                  <div className="mt-3 max-h-56 space-y-2 overflow-auto custom-scrollbar">
                    {availableUsers.map((person) => (
                      <button
                        key={person.id}
                        type="button"
                        onClick={() => setDirectUserId(person.id)}
                        className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2 text-left text-sm transition ${
                          directUserId === person.id
                            ? 'border-sky-300 bg-sky-100 text-slate-900 dark:border-slate-500 dark:bg-slate-800 dark:text-white'
                            : 'border-slate-200/80 bg-white/70 text-slate-700 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200'
                        }`}
                      >
                        <div>
                          <p className="font-semibold">{person.name}</p>
                          <p className="text-[11px] text-slate-400">{person.department ?? 'Team'}</p>
                        </div>
                        <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                          {person.status === 'ACTIVE' ? 'Online' : 'Offline'}
                        </span>
                      </button>
                    ))}
                    {availableUsers.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-slate-200/80 bg-white/60 p-4 text-xs text-slate-500 dark:border-slate-700/60 dark:bg-slate-900/50 dark:text-slate-300">
                        No users available.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {createType === 'group' && (
                <div className="space-y-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-[var(--chat-muted)]">Group name</p>
                    <input
                      value={groupName}
                      onChange={(event) => setGroupName(event.target.value)}
                      placeholder="Enter group name"
                      className="mt-2 w-full rounded-2xl border border-slate-200/70 bg-white/70 px-3 py-2 text-sm text-slate-700 focus:outline-none dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-200"
                    />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-[var(--chat-muted)]">Add members</p>
                    <div className="mt-3 max-h-56 space-y-2 overflow-auto custom-scrollbar">
                      {availableUsers.map((person) => (
                        <label
                          key={person.id}
                          className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white/70 px-3 py-2 text-sm text-slate-700 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
                        >
                          <span>
                            <p className="font-semibold">{person.name}</p>
                            <p className="text-[11px] text-slate-400">{person.department ?? 'Team'}</p>
                          </span>
                          <input
                            type="checkbox"
                            checked={groupMembers.includes(person.id)}
                            onChange={(event) => {
                              if (event.target.checked) {
                                setGroupMembers((prev) => [...prev, person.id]);
                              } else {
                                setGroupMembers((prev) => prev.filter((id) => id !== person.id));
                              }
                            }}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {createType === 'personal' && (
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--chat-muted)]">
                    Personal space name
                  </p>
                  <input
                    value={personalName}
                    onChange={(event) => setPersonalName(event.target.value)}
                    placeholder="Personal Space"
                    className="mt-2 w-full rounded-2xl border border-slate-200/70 bg-white/70 px-3 py-2 text-sm text-slate-700 focus:outline-none dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-200"
                  />
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Personal spaces are visible only to you.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Spaces are stored locally. Realtime sync works when the chat server is running.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="rounded-full border border-slate-200/80 bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateSpace}
                  className="rounded-full bg-sky-500 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white shadow transition hover:-translate-y-0.5 hover:bg-sky-600"
                >
                  Create space
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Chat;
