import { useState } from 'react';
import { motion } from 'framer-motion';
import { AppShell } from './components/layout/AppShell';
import { Sidebar, type SidebarTab } from './components/layout/Sidebar';
import { ConversationsPanel } from './components/conversations/ConversationsPanel';
import { NewConversationButton } from './components/conversations/NewConversationButton';
import { DocumentsPanel } from './components/documents/DocumentsPanel';
import { ChatPanel } from './components/chat/ChatPanel';
import { CommandPalette } from './components/command/CommandPalette';

/**
 * Everything needed once a person actually enters the app - the markdown
 * renderer, command palette (cmdk), and all the panel components. This is
 * a meaningful chunk of the JS bundle (react-markdown + remark-gfm alone
 * are sizeable), and a portfolio project's landing page is often the ONLY
 * thing many visitors ever load - no reason to make them download the
 * whole app to see the hero section. Lazy-loaded from App.tsx via
 * React.lazy(); this file being its own module is what makes that split
 * actually happen at the bundler level.
 */
interface MainAppViewProps {
  onGoHome: () => void;
}

export default function MainAppView({ onGoHome }: MainAppViewProps) {
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('chats');

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="signal-theme h-svh font-signal-body"
    >
      <CommandPalette onNavigateToDocuments={() => setSidebarTab('documents')} onGoHome={onGoHome} />
      <AppShell
        sidebar={
          <Sidebar
            tab={sidebarTab}
            onTabChange={setSidebarTab}
            onGoHome={onGoHome}
            newConversationSlot={<NewConversationButton />}
            chatsSlot={<ConversationsPanel />}
            documentsSlot={<DocumentsPanel />}
          />
        }
        main={<ChatPanel />}
      />
    </motion.div>
  );
}
