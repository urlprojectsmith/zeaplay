import api from '../../../services/api';
import { ChatConversationCreatePayload, ChatDirectCreatePayload, ChatMessageCreatePayload } from '../types';

export const chatService = {
  listConversations: () => api.getChatConversations(),
  getConversation: (conversationId: string) => api.getChatConversation(conversationId),
  createConversation: (payload: ChatConversationCreatePayload) => api.createChatConversation(payload),
  startDirect: (payload: ChatDirectCreatePayload) => api.startDirectChat(payload),
  listMessages: (conversationId: string, cursor?: string | null, limit = 50) =>
    api.getChatMessages(conversationId, { cursor, limit }),
  sendMessage: (conversationId: string, payload: ChatMessageCreatePayload) =>
    api.sendChatMessage(conversationId, payload),
  updateMessage: (messageId: string, content: string) => api.updateChatMessage(messageId, content),
  deleteMessage: (messageId: string) => api.deleteChatMessage(messageId),
  addMembers: (conversationId: string, userIds: string[]) => api.addChatMembers(conversationId, userIds),
  removeMember: (conversationId: string, userId: string) => api.removeChatMember(conversationId, userId),
  markRead: (conversationId: string, lastReadMessageId?: string | null) => api.markChatRead(conversationId, lastReadMessageId),
  addReaction: (messageId: string, emoji: string) => api.addChatReaction(messageId, emoji),
  removeReaction: (messageId: string, emoji: string) => api.removeChatReaction(messageId, emoji),
  uploadAttachment: (conversationId: string, file: File, onProgress?: (progress: number) => void) =>
    api.uploadChatAttachment(conversationId, file, onProgress),
  searchMessages: (options: { q: string; conversationId?: string | null; senderId?: string | null; cursor?: string | null; limit?: number }) =>
    api.searchChatMessages(options),
  listPins: (conversationId: string) => api.getChatPinnedMessages(conversationId),
  pinMessage: (conversationId: string, messageId: string) => api.pinChatMessage(conversationId, messageId),
  unpinMessage: (conversationId: string, messageId: string) => api.unpinChatMessage(conversationId, messageId),
};
