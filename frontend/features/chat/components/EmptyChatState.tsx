import React from 'react';
import { ChatConversation } from '../types';
import { User } from '../../../types';
import { getConversationTitle } from '../utils/conversation';

type Props = {
  conversation?: ChatConversation | null;
  currentUser?: User | null;
};

const EmptyChatState: React.FC<Props> = ({ conversation, currentUser }) => (
  <div className="flex h-full items-center justify-center p-8 text-center">
    <div className="max-w-sm">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-gradient-to-br from-violet-100 to-sky-100 text-2xl font-black text-violet-600">
        {conversation ? '#' : '+'}
      </div>
      <h2 className="mt-4 text-xl font-black text-slate-950">
        {conversation ? (conversation.type === 'DIRECT' ? 'No messages yet' : `Welcome to ${getConversationTitle(conversation, currentUser)}`) : 'Choose a conversation'}
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        {conversation
          ? conversation.type === 'DIRECT'
            ? `Start your conversation with ${getConversationTitle(conversation, currentUser)}.`
            : 'This is the beginning of this space.'
          : 'Direct messages, private groups, and spaces will appear here.'}
      </p>
    </div>
  </div>
);

export default EmptyChatState;
