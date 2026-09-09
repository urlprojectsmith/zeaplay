import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatAttachment, ChatConversation, ChatMessage } from '../types';
import { chatService } from '../services/chatService';
import { useChatRealtime, ChatRealtimeEvent } from './useChatRealtime';

export const useChat = (initialConversationId?: string | null) => {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(initialConversationId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typingByConversation, setTypingByConversation] = useState<Record<string, Record<string, string>>>({});
  const [presenceByUserId, setPresenceByUserId] = useState<Record<string, 'ONLINE' | 'AWAY' | 'OFFLINE'>>({});
  const selectedConversationIdRef = useRef<string | null>(selectedConversationId);
  const messageRequestSeqRef = useRef(0);
  const messageCursorInFlightRef = useRef<Set<string>>(new Set());
  const pendingSendTimersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );

  useEffect(() => {
    if (initialConversationId) {
      setSelectedConversationId(initialConversationId);
    }
  }, [initialConversationId]);

  const loadConversations = useCallback(async () => {
    setLoadingConversations(true);
    setError(null);
    try {
      const data = await chatService.listConversations();
      setConversations(data);
      setSelectedConversationId((current) => {
        if (current && data.some((conversation) => conversation.id === current)) {
          return current;
        }
        if (initialConversationId && data.some((conversation) => conversation.id === initialConversationId)) {
          return initialConversationId;
        }
        return data[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load conversations');
    } finally {
      setLoadingConversations(false);
    }
  }, [initialConversationId]);

  const mergeMessage = useCallback((message: ChatMessage, clientId?: string | null) => {
    setMessages((current) => {
      const existingIndex = current.findIndex((item) => item.id === message.id || (clientId && item.clientId === clientId));
      const nextMessage = { ...message, clientId: clientId ?? message.clientId ?? null, deliveryStatus: 'sent' as const };
      if (nextMessage.clientId && pendingSendTimersRef.current[nextMessage.clientId]) {
        window.clearTimeout(pendingSendTimersRef.current[nextMessage.clientId]);
        delete pendingSendTimersRef.current[nextMessage.clientId];
      }
      if (existingIndex === -1) return [...current, nextMessage];
      const next = [...current];
      next[existingIndex] = nextMessage;
      return next;
    });
  }, []);

  const handleRealtimeEvent = useCallback((event: ChatRealtimeEvent) => {
    const payload = event.payload || {};
    if (event.type === 'message:new' && payload.message) {
      if (payload.conversation_id === selectedConversationIdRef.current) {
        mergeMessage(payload.message as ChatMessage, payload.client_id);
      }
      void loadConversations();
      return;
    }
    if ((event.type === 'message:updated' || event.type === 'message:deleted' || event.type === 'reaction:added' || event.type === 'reaction:removed') && payload.message) {
      if (payload.conversation_id === selectedConversationIdRef.current) {
        setMessages((current) => current.map((item) => (item.id === payload.message.id ? { ...(payload.message as ChatMessage), deliveryStatus: item.deliveryStatus } : item)));
      }
      void loadConversations();
      return;
    }
    if (event.type === 'typing:started') {
      setTypingByConversation((current) => ({
        ...current,
        [payload.conversation_id]: { ...(current[payload.conversation_id] ?? {}), [payload.user_id]: payload.name },
      }));
      return;
    }
    if (event.type === 'typing:stopped') {
      setTypingByConversation((current) => {
        const nextConversation = { ...(current[payload.conversation_id] ?? {}) };
        delete nextConversation[payload.user_id];
        return { ...current, [payload.conversation_id]: nextConversation };
      });
      return;
    }
    if (event.type === 'presence:changed') {
      setPresenceByUserId((current) => ({ ...current, [payload.user_id]: payload.status }));
      return;
    }
    if (event.type === 'unread:updated') {
      setConversations((current) => current.map((conversation) => (
        conversation.id === payload.conversation_id ? { ...conversation, unreadCount: payload.unread_count } : conversation
      )));
    }
  }, [loadConversations, mergeMessage]);

  const { connected: realtimeConnected, send: sendRealtime, join: joinRealtime, leave: leaveRealtime } = useChatRealtime(handleRealtimeEvent);

  const loadMessages = useCallback(async (conversationId: string, cursor?: string | null) => {
    const cursorKey = cursor ?? '__latest__';
    if (messageCursorInFlightRef.current.has(`${conversationId}:${cursorKey}`)) return;
    messageCursorInFlightRef.current.add(`${conversationId}:${cursorKey}`);
    const requestSeq = ++messageRequestSeqRef.current;
    setLoadingMessages(true);
    setError(null);
    try {
      const page = await chatService.listMessages(conversationId, cursor);
      if (selectedConversationIdRef.current !== conversationId) return;
      if (!cursor && requestSeq !== messageRequestSeqRef.current) return;
      setMessages((current) => {
        const merged = cursor ? [...page.items, ...current] : page.items;
        const byId = new Map<string, ChatMessage>();
        for (const message of merged) {
          const key = message.clientId || message.id;
          byId.set(key, { ...byId.get(key), ...message });
        }
        return Array.from(byId.values()).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      });
      setNextCursor(page.nextCursor ?? null);
      setHasMore(page.hasMore);
      if (!cursor) {
        const latestMessage = page.items[page.items.length - 1];
        void chatService.markRead(conversationId, latestMessage?.id ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load messages');
    } finally {
      messageCursorInFlightRef.current.delete(`${conversationId}:${cursorKey}`);
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      return;
    }
    joinRealtime(selectedConversationId);
    void loadMessages(selectedConversationId);
    return () => leaveRealtime(selectedConversationId);
  }, [joinRealtime, leaveRealtime, loadMessages, selectedConversationId]);

  const sendMessage = useCallback(async (content: string, options?: { replyToMessageId?: string | null; attachments?: ChatAttachment[] }) => {
    const attachments = options?.attachments ?? [];
    if (!selectedConversationId || (!content.trim() && attachments.length === 0)) return;
    setError(null);
    const clientId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: ChatMessage = {
      id: clientId,
      clientId,
      conversationId: selectedConversationId,
      senderId: 'me',
      senderName: 'You',
      senderRole: 'USER' as any,
      messageType: attachments.length ? 'FILE' : 'TEXT',
      content: content.trim(),
      replyToMessageId: options?.replyToMessageId ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deliveryStatus: 'sending',
      reactions: [],
      attachments,
      mentions: [],
    };
    setMessages((current) => [...current, optimistic]);
    try {
      const payloadAttachments = attachments.map(({ id, messageId, createdAt, ...attachment }) => attachment);
      if (realtimeConnected && sendRealtime('message:send', {
        conversation_id: selectedConversationId,
        client_id: clientId,
        content: content.trim(),
        reply_to_message_id: options?.replyToMessageId ?? null,
        attachments: payloadAttachments,
      })) {
        pendingSendTimersRef.current[clientId] = window.setTimeout(async () => {
          try {
            const message = await chatService.sendMessage(selectedConversationId, {
              content: content.trim(),
              clientId,
              replyToMessageId: options?.replyToMessageId ?? null,
              attachments: payloadAttachments,
            });
            mergeMessage(message, clientId);
            void chatService.markRead(selectedConversationId, message.id);
            void loadConversations();
          } catch (err) {
            setMessages((current) => current.map((message) => (message.clientId === clientId ? { ...message, deliveryStatus: 'failed' } : message)));
            setError(err instanceof Error ? err.message : 'Unable to send message');
          }
        }, 8000);
        return;
      }
      const message = await chatService.sendMessage(selectedConversationId, {
        content: content.trim(),
        clientId,
        replyToMessageId: options?.replyToMessageId ?? null,
        attachments: payloadAttachments,
      });
      mergeMessage(message, clientId);
      void chatService.markRead(selectedConversationId, message.id);
      void loadConversations();
    } catch (err) {
      setMessages((current) => current.map((message) => (message.clientId === clientId ? { ...message, deliveryStatus: 'failed' } : message)));
      setError(err instanceof Error ? err.message : 'Unable to send message');
    }
  }, [loadConversations, mergeMessage, realtimeConnected, selectedConversationId, sendRealtime]);

  useEffect(() => () => {
    Object.values(pendingSendTimersRef.current).forEach((timer) => window.clearTimeout(timer));
    pendingSendTimersRef.current = {};
  }, []);

  const retryMessage = useCallback((message: ChatMessage) => {
    void sendMessage(message.content, { replyToMessageId: message.replyToMessageId, attachments: message.attachments });
    setMessages((current) => current.filter((item) => item.id !== message.id));
  }, [sendMessage]);

  const setTyping = useCallback((typing: boolean) => {
    if (!selectedConversationId) return;
    sendRealtime(typing ? 'typing:start' : 'typing:stop', { conversation_id: selectedConversationId });
  }, [selectedConversationId, sendRealtime]);

  const toggleReaction = useCallback((message: ChatMessage, emoji: string, currentUserId?: string) => {
    const hasReacted = message.reactions.some((reaction) => reaction.emoji === emoji && reaction.userId === currentUserId);
    if (realtimeConnected && sendRealtime(hasReacted ? 'reaction:remove' : 'reaction:add', { message_id: message.id, emoji })) {
      return;
    }
    const action = hasReacted ? chatService.removeReaction(message.id, emoji) : chatService.addReaction(message.id, emoji);
    void action.then((updated) => mergeMessage(updated));
  }, [mergeMessage, realtimeConnected, sendRealtime]);

  const editMessage = useCallback(async (message: ChatMessage, content: string) => {
    if (!content.trim()) return;
    if (realtimeConnected && sendRealtime('message:edit', { message_id: message.id, content: content.trim() })) {
      return;
    }
    const updated = await chatService.updateMessage(message.id, content.trim());
    mergeMessage(updated);
  }, [mergeMessage, realtimeConnected, sendRealtime]);

  const deleteMessage = useCallback(async (message: ChatMessage) => {
    if (realtimeConnected && sendRealtime('message:delete', { message_id: message.id })) {
      return;
    }
    await chatService.deleteMessage(message.id);
    setMessages((current) => current.map((item) => (
      item.id === message.id ? { ...item, content: '', deletedAt: new Date().toISOString() } : item
    )));
  }, [realtimeConnected, sendRealtime]);

  const pinMessage = useCallback(async (message: ChatMessage) => {
    if (!selectedConversationId || message.deletedAt) return;
    await chatService.pinMessage(selectedConversationId, message.id);
    void loadConversations();
  }, [loadConversations, selectedConversationId]);

  const unpinMessage = useCallback(async (messageId: string) => {
    if (!selectedConversationId) return;
    await chatService.unpinMessage(selectedConversationId, messageId);
    void loadConversations();
  }, [loadConversations, selectedConversationId]);

  const startDirect = useCallback(async (userId: string) => {
    setError(null);
    try {
      const conversation = await chatService.startDirect({ userId });
      setConversations((current) => {
        const exists = current.some((item) => item.id === conversation.id);
        return exists ? current.map((item) => (item.id === conversation.id ? conversation : item)) : [conversation, ...current];
      });
      setSelectedConversationId(conversation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start direct message');
    }
  }, []);

  const createConversation = useCallback(async (payload: Parameters<typeof chatService.createConversation>[0]) => {
    setError(null);
    try {
      const conversation = await chatService.createConversation(payload);
      setConversations((current) => [conversation, ...current]);
      setSelectedConversationId(conversation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create conversation');
    }
  }, []);

  return {
    conversations,
    selectedConversation,
    selectedConversationId,
    messages,
    nextCursor,
    hasMore,
    loadingConversations,
    loadingMessages,
    error,
    setSelectedConversationId,
    loadMoreMessages: () => selectedConversationId && nextCursor ? loadMessages(selectedConversationId, nextCursor) : undefined,
    sendMessage,
    startDirect,
    createConversation,
    retryMessage,
    setTyping,
    toggleReaction,
    editMessage,
    deleteMessage,
    pinMessage,
    unpinMessage,
    uploadAttachment: chatService.uploadAttachment,
    typingUsers: selectedConversationId ? Object.values(typingByConversation[selectedConversationId] ?? {}) : [],
    presenceByUserId,
    realtimeConnected,
    reload: loadConversations,
  };
};
