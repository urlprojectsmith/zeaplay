import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import { User } from '../../types';
import { getConversationTitle } from './utils/conversation';
import { useChat } from './hooks/useChat';
import ChatHeader from './components/ChatHeader';
import ChatModal from './components/ChatModal';
import ChatSearchModal from './components/ChatSearchModal';
import ChatSidebar from './components/ChatSidebar';
import EmptyChatState from './components/EmptyChatState';
import MemberPanel from './components/MemberPanel';
import MessageComposer from './components/MessageComposer';
import MessageList from './components/MessageList';
import PinnedMessagesPanel from './components/PinnedMessagesPanel';
import { chatService } from './services/chatService';
import { ChatPinnedMessage } from './types';

const ChatApp: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { conversationId } = useParams();
  const [users, setUsers] = useState<User[]>([]);
  const [replyTo, setReplyTo] = useState<ReturnType<typeof useChat>['messages'][number] | null>(null);
  const [creationMode, setCreationMode] = useState<'DIRECT' | 'GROUP' | 'SPACE' | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pinsOpen, setPinsOpen] = useState(false);
  const [pins, setPins] = useState<ChatPinnedMessage[]>([]);
  const [pinsLoading, setPinsLoading] = useState(false);
  const chat = useChat(conversationId ?? null);

  useEffect(() => {
    api.getUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    if (chat.selectedConversationId && chat.selectedConversationId !== conversationId) {
      navigate(`/chat/${chat.selectedConversationId}`, { replace: !conversationId });
    }
  }, [chat.selectedConversationId, conversationId, navigate]);

  useEffect(() => {
    const unread = chat.conversations.reduce((total, conversation) => total + conversation.unreadCount, 0);
    const baseTitle = document.title.replace(/^\(\d+\)\s+/, '');
    document.title = unread > 0 ? `(${unread}) ${baseTitle}` : baseTitle;
  }, [chat.conversations]);

  useEffect(() => {
    if (!chat.selectedConversationId) {
      setPins([]);
      return;
    }
    setPinsLoading(true);
    chatService.listPins(chat.selectedConversationId).then(setPins).catch(() => setPins([])).finally(() => setPinsLoading(false));
  }, [chat.selectedConversationId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === 'Escape') {
        setReplyTo(null);
        setPinsOpen(false);
        setSearchOpen(false);
        setCreationMode(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const selectConversation = (id: string) => {
    chat.setSelectedConversationId(id);
    navigate(`/chat/${id}`);
    setSidebarOpen(false);
  };

  const selectedPresence = useMemo(() => {
    const other = chat.selectedConversation?.members.find((member) => member.userId !== user?.id);
    return other ? chat.presenceByUserId[other.userId] ?? 'OFFLINE' : 'OFFLINE';
  }, [chat.presenceByUserId, chat.selectedConversation?.members, user?.id]);

  const selectedTitle = chat.selectedConversation ? getConversationTitle(chat.selectedConversation, user) : 'this chat';
  const canManageSelected = Boolean(chat.selectedConversation?.members.some((member) => member.userId === user?.id && ['OWNER', 'ADMIN'].includes(member.role)));

  const refreshPins = async () => {
    if (!chat.selectedConversationId) return;
    setPinsLoading(true);
    try {
      setPins(await chatService.listPins(chat.selectedConversationId));
    } finally {
      setPinsLoading(false);
    }
  };

  const pinMessage = async (message: ReturnType<typeof useChat>['messages'][number]) => {
    await chat.pinMessage(message);
    await refreshPins();
  };

  const unpinMessage = async (messageId: string) => {
    await chat.unpinMessage(messageId);
    await refreshPins();
  };

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[#F8FAFC] p-2 sm:p-4">
      <div className="mx-auto flex h-[calc(100vh-6rem)] min-h-[620px] max-w-[1500px] overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.14)]">
        <div className={`${sidebarOpen ? 'fixed inset-0 z-40 block bg-slate-950/30 p-3' : 'hidden'} lg:static lg:block lg:bg-transparent lg:p-0`}>
          <div className="h-full overflow-hidden rounded-[24px] lg:rounded-none">
            <ChatSidebar
              currentUser={user}
              conversations={chat.conversations}
              selectedConversationId={chat.selectedConversationId}
              loading={chat.loadingConversations}
              presenceByUserId={chat.presenceByUserId}
              onSelect={selectConversation}
              onOpenCreate={setCreationMode}
              onOpenSearch={() => setSearchOpen(true)}
            />
          </div>
        </div>

        <main className="flex min-w-0 flex-1 flex-col bg-white">
          <div className={`border-b px-4 py-2 text-center text-xs font-bold transition ${chat.realtimeConnected ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-amber-100 bg-amber-50 text-amber-700'}`}>
            {chat.realtimeConnected ? 'Connected' : 'Reconnecting...'}
          </div>
          <ChatHeader
            conversation={chat.selectedConversation}
            currentUser={user}
            presence={selectedPresence}
            detailsOpen={detailsOpen}
            onOpenSidebar={() => setSidebarOpen(true)}
            onOpenSearch={() => setSearchOpen(true)}
            onOpenPins={() => setPinsOpen(true)}
            onToggleDetails={() => setDetailsOpen((value) => !value)}
          />
          {chat.error && (
            <div className="border-b border-rose-200 bg-rose-50 px-5 py-2 text-sm font-semibold text-rose-700">{chat.error}</div>
          )}
          {chat.selectedConversation ? (
            <>
              <MessageList
                conversation={chat.selectedConversation}
                messages={chat.messages}
                currentUser={user}
                loading={chat.loadingMessages}
                hasMore={chat.hasMore}
                onLoadMore={() => void chat.loadMoreMessages()}
                typingUsers={chat.typingUsers.filter((name) => name !== user?.name)}
                onReply={setReplyTo}
                onRetry={chat.retryMessage}
                onToggleReaction={(message, emoji) => chat.toggleReaction(message, emoji, user?.id)}
                onEdit={chat.editMessage}
                onDelete={chat.deleteMessage}
                canManage={canManageSelected}
                onPin={(message) => void pinMessage(message)}
              />
              <MessageComposer
                disabled={!chat.selectedConversation}
                placeholder={`Message ${chat.selectedConversation.type === 'DIRECT' ? selectedTitle : `#${selectedTitle.toLowerCase().replace(/\s+/g, '-')}`}`}
                replyTo={replyTo}
                onCancelReply={() => setReplyTo(null)}
                onSend={chat.sendMessage}
                onTyping={chat.setTyping}
                onUploadAttachment={(file, onProgress) => chat.uploadAttachment(chat.selectedConversationId!, file, onProgress)}
              />
            </>
          ) : (
            <EmptyChatState />
          )}
        </main>

        <MemberPanel
          conversation={chat.selectedConversation}
          currentUser={user}
          open={detailsOpen}
          presenceByUserId={chat.presenceByUserId}
          pinnedMessages={pins}
          onClose={() => setDetailsOpen(false)}
        />
      </div>

      <ChatModal
        open={Boolean(creationMode)}
        mode={creationMode ?? 'DIRECT'}
        users={users}
        currentUser={user}
        presenceByUserId={chat.presenceByUserId}
        onClose={() => setCreationMode(null)}
        onStartDirect={chat.startDirect}
        onCreateConversation={chat.createConversation}
      />
      <ChatSearchModal open={searchOpen} conversationId={chat.selectedConversationId} onClose={() => setSearchOpen(false)} onSelectConversation={selectConversation} />
      <PinnedMessagesPanel open={pinsOpen} loading={pinsLoading} pins={pins} canManage={canManageSelected} onClose={() => setPinsOpen(false)} onJump={() => setPinsOpen(false)} onUnpin={(messageId) => void unpinMessage(messageId)} />
    </div>
  );
};

export default ChatApp;
