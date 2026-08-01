import { useState } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { ThemeProvider } from './context/ThemeContext';
import { DocumentsProvider } from './context/DocumentsContext';
import { ConversationsProvider } from './context/ConversationsContext';
import { Hero } from './components/hero/Hero';
import { AppShell } from './components/layout/AppShell';
import { Sidebar, type SidebarTab } from './components/layout/Sidebar';
import { ConversationsPanel } from './components/conversations/ConversationsPanel';
import { NewConversationButton } from './components/conversations/NewConversationButton';
import { DocumentsPanel } from './components/documents/DocumentsPanel';
import { ChatPanel } from './components/chat/ChatPanel';
import { CommandPalette } from './components/command/CommandPalette';
import { GrainOverlay } from './components/GrainOverlay';
import { AmbientBackground } from './components/AmbientBackground';

type View = 'hero' | 'app';

function AppContent() {
  const [view, setView] = useState<View>('hero');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('chats');

  return (
    <AnimatePresence mode="wait">
      {view === 'hero' ? (
        <motion.div key="hero" exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
          <Hero onEnter={() => setView('app')} />
        </motion.div>
      ) : (
        <motion.div
          key="app"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="h-svh"
        >
          <CommandPalette onNavigateToDocuments={() => setSidebarTab('documents')} />
          <AppShell
            sidebar={
              <Sidebar
                tab={sidebarTab}
                onTabChange={setSidebarTab}
                newConversationSlot={<NewConversationButton />}
                chatsSlot={<ConversationsPanel />}
                documentsSlot={<DocumentsPanel />}
              />
            }
            main={<ChatPanel />}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <DocumentsProvider>
          <ConversationsProvider>
            <AmbientBackground />
            <GrainOverlay />
            <AppContent />
          </ConversationsProvider>
        </DocumentsProvider>
      </ThemeProvider>
    </MotionConfig>
  );
}

export default App;
