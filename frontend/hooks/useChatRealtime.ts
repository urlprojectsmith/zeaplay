import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

import { useAuth } from './useAuth';
import { getAccessToken } from '../services/tokenStorage';

export type ChatAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
};

export type ChatSpaceSnapshot = {
  id: string;
  name?: string;
  type?: string;
  memberIds?: string[];
  createdBy?: string;
  updatedAt?: string;
  lastMessage?: string;
};

export type ChatRealtimeMessage = {
  id: string;
  spaceId: string;
  authorId: string;
  body: string;
  createdAt: string;
  replyTo?: string | null;
  attachments?: ChatAttachment[];
  memberIds?: string[];
  space?: ChatSpaceSnapshot | null;
};

export type ChatTypingEvent = {
  spaceId: string;
  userId: string;
  isTyping: boolean;
  preview?: string;
};

export type ChatReactionEvent = {
  spaceId: string;
  messageId: string;
  reaction: string;
  userId: string;
};

export type ChatSpaceEvent = ChatSpaceSnapshot;

type ChatHistoryPayload = {
  ok: boolean;
  history?: ChatRealtimeMessage[];
  error?: string;
};

type ChatSendPayload = {
  ok: boolean;
  message?: ChatRealtimeMessage;
  error?: string;
};

type ChatReactionAck = {
  ok: boolean;
  error?: string;
};

type UseChatRealtimeOptions = {
  spaceId?: string | null;
  onMessage?: (message: ChatRealtimeMessage) => void;
  onHistory?: (history: ChatRealtimeMessage[]) => void;
  onTyping?: (event: ChatTypingEvent) => void;
  onReaction?: (event: ChatReactionEvent) => void;
  onSpace?: (space: ChatSpaceEvent) => void;
};

type ChatRealtimeState = {
  status: 'connecting' | 'connected' | 'offline';
  error?: string;
  sendMessage: (message: ChatRealtimeMessage) => Promise<ChatRealtimeMessage>;
  sendTyping: (payload: { spaceId: string; isTyping: boolean; preview?: string }) => void;
  sendReaction: (payload: { spaceId: string; messageId: string; reaction: string }) => void;
  sendSpace: (space: ChatSpaceSnapshot) => void;
};

const readRuntimeChatUrl = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }
  const runtimeConfig = (window as typeof window & {
    __RUNTIME_CONFIG__?: { CHAT_URL?: string; PRESENCE_URL?: string };
  }).__RUNTIME_CONFIG__;
  if (runtimeConfig?.CHAT_URL && typeof runtimeConfig.CHAT_URL === 'string') {
    return runtimeConfig.CHAT_URL.trim();
  }
  if (runtimeConfig?.PRESENCE_URL && typeof runtimeConfig.PRESENCE_URL === 'string') {
    return runtimeConfig.PRESENCE_URL.trim();
  }
  return '';
};

const resolveChatUrl = (): string | null => {
  const runtimeUrl = readRuntimeChatUrl();
  if (runtimeUrl) {
    return runtimeUrl;
  }
  const envUrl = import.meta.env.VITE_CHAT_URL || import.meta.env.VITE_PRESENCE_URL;
  if (envUrl && typeof envUrl === 'string') {
    return envUrl;
  }
  if (typeof window === 'undefined') {
    return null;
  }
  const host = window.location.hostname;
  const isLocalhost = host === 'localhost' || host === '127.0.0.1';
  return isLocalhost ? 'http://localhost:6212' : null;
};

export const useChatRealtime = ({
  spaceId,
  onMessage,
  onHistory,
  onTyping,
  onReaction,
  onSpace,
}: UseChatRealtimeOptions): ChatRealtimeState => {
  const { user } = useAuth();
  const [status, setStatus] = useState<ChatRealtimeState['status']>('offline');
  const [error, setError] = useState<string | undefined>(undefined);
  const socketRef = useRef<Socket | null>(null);
  const joinedSpaceRef = useRef<string | null>(null);

  const disconnectSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    joinedSpaceRef.current = null;
  }, []);

  const connectSocket = useCallback(() => {
    const token = getAccessToken();
    if (!user || !token) {
      setStatus('offline');
      setError(undefined);
      disconnectSocket();
      return;
    }

    const chatUrl = resolveChatUrl();
    if (!chatUrl) {
      setStatus('offline');
      setError('Chat realtime not configured');
      disconnectSocket();
      return;
    }

    setStatus('connecting');
    setError(undefined);
    disconnectSocket();

    const socket = io(chatUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      timeout: 10000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Chat] Connected to realtime server');
      setStatus('connected');
      setError(undefined);
    });

    socket.on('disconnect', () => {
      console.log('[Chat] Disconnected from realtime server');
      setStatus('offline');
      setError('Chat offline');
    });

    socket.on('connect_error', (err) => {
      console.error('[Chat] Connection error:', err?.message);
      setStatus('offline');
      setError(err?.message || 'Chat offline');
    });

    socket.on('chat:message', (message: ChatRealtimeMessage) => {
      if (onMessage) {
        onMessage(message);
      }
    });

    socket.on('chat:typing', (payload: ChatTypingEvent) => {
      if (onTyping) {
        onTyping(payload);
      }
    });

    socket.on('chat:reaction', (payload: ChatReactionEvent) => {
      if (onReaction) {
        onReaction(payload);
      }
    });

    socket.on('chat:space', (payload: ChatSpaceEvent) => {
      if (onSpace) {
        onSpace(payload);
      }
    });
  }, [disconnectSocket, onMessage, onReaction, onSpace, onTyping, user]);

  useEffect(() => {
    connectSocket();
    return () => {
      disconnectSocket();
    };
  }, [connectSocket, disconnectSocket, user?.id]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || status !== 'connected') {
      return;
    }

    const nextSpaceId = typeof spaceId === 'string' ? spaceId.trim() : '';
    if (!nextSpaceId) {
      if (joinedSpaceRef.current) {
        console.log('[Chat] Leaving space:', joinedSpaceRef.current);
        socket.emit('chat:leave', { spaceId: joinedSpaceRef.current });
        joinedSpaceRef.current = null;
      }
      return;
    }

    if (joinedSpaceRef.current === nextSpaceId) {
      return;
    }

    if (joinedSpaceRef.current) {
      console.log('[Chat] Leaving space:', joinedSpaceRef.current);
      socket.emit('chat:leave', { spaceId: joinedSpaceRef.current });
    }

    console.log('[Chat] Joining space:', nextSpaceId);
    socket.emit('chat:join', { spaceId: nextSpaceId }, (payload: ChatHistoryPayload) => {
      if (payload?.ok) {
        console.log('[Chat] Joined space successfully:', nextSpaceId, 'History items:', payload.history?.length ?? 0);
        if (payload.history && onHistory) {
          onHistory(payload.history);
        }
      } else if (payload?.error) {
        console.error('[Chat] Failed to join space:', nextSpaceId, 'Error:', payload.error);
        setError(payload.error);
      }
    });
    joinedSpaceRef.current = nextSpaceId;
  }, [onHistory, spaceId, status]);

  const sendMessage = useCallback(async (message: ChatRealtimeMessage) => {
    const socket = socketRef.current;
    if (!socket || status !== 'connected') {
      throw new Error('Chat is offline. Please check your connection.');
    }
    return new Promise<ChatRealtimeMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Message send timeout. Please try again.'));
      }, 10000);

      socket.emit('chat:message', message, (payload: ChatSendPayload) => {
        clearTimeout(timeout);
        if (payload?.ok && payload.message) {
          resolve(payload.message);
          return;
        }
        if (payload?.error) {
          setError(payload.error);
          reject(new Error(payload.error));
          return;
        }
        reject(new Error('Failed to send message'));
      });
    });
  }, [status]);

  const sendTyping = useCallback((payload: { spaceId: string; isTyping: boolean; preview?: string }) => {
    const socket = socketRef.current;
    if (!socket || status !== 'connected') {
      return;
    }
    socket.emit('chat:typing', payload);
  }, [status]);

  const sendReaction = useCallback((payload: { spaceId: string; messageId: string; reaction: string }) => {
    const socket = socketRef.current;
    if (!socket || status !== 'connected') {
      return;
    }
    socket.emit('chat:reaction', payload, (ack: ChatReactionAck) => {
      if (!ack?.ok && ack?.error) {
        setError(ack.error);
      }
    });
  }, [status]);

  const sendSpace = useCallback((space: ChatSpaceSnapshot) => {
    const socket = socketRef.current;
    if (!socket || status !== 'connected') {
      return;
    }
    socket.emit('chat:space', { space });
  }, [status]);

  return useMemo(
    () => ({
      status,
      error,
      sendMessage,
      sendTyping,
      sendReaction,
      sendSpace,
    }),
    [error, sendMessage, sendReaction, sendSpace, sendTyping, status],
  );
};
