import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

import { ToastProvider, IndexingProvider } from './context/GlobalContext';

import ChatView from './views/ChatView';
import IndexingView from './views/IndexingView';
import ArchitectureView from './views/ArchitectureView';

const NAV_ITEMS = [
  { to: '/', label: 'Chat',         icon: 'ph-chat-circle-text' },
  { to: '/index', label: 'Indexing',icon: 'ph-stack' },
  { to: '/architecture', label: 'Architecture', icon: 'ph-graph' },
] as const;

const FloatingNav: React.FC = () => {
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => { setOpen(false); }, [location.pathname]);

  return (
    <>
      {/* Desktop pill nav — floating, detached */}
      <nav className="hidden md:flex fixed top-6 left-1/2 -translate-x-1/2 z-40 items-center gap-1 px-2 py-2 rounded-full bg-ink-900/70 backdrop-blur-xl border border-white/[0.06] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]">
        <div className="flex items-center gap-2 pl-3 pr-5 border-r border-white/[0.06]">
          <div className="relative">
            <div className="size-2 rounded-full bg-accent shadow-[0_0_10px_#C9B8FF] animate-breathe" />
          </div>
          <span className="text-[11px] font-medium tracking-tightest text-chalk">
            Ragnarok
          </span>
          <span className="text-[9px] font-mono text-chalk-mute uppercase tracking-[0.2em] ml-1 hidden lg:inline">
            v1.0
          </span>
        </div>

        {NAV_ITEMS.map((item) => {
          const active = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);
          return (
            <NavLink key={item.to} to={item.to} className="relative">
              <span
                className={`relative z-10 flex items-center gap-2 px-4 py-2 rounded-full text-[12px] font-medium tracking-tight transition-colors duration-700 ease-spring ${
                  active ? 'text-ink' : 'text-chalk-dim hover:text-chalk'
                }`}
              >
                <i className={`${item.icon} text-[16px] ${active ? '' : 'opacity-60'}`} />
                {item.label}
              </span>
              {active && (
                <motion.div
                  layoutId="nav-pill"
                  className="absolute inset-0 rounded-full bg-chalk shadow-[0_8px_24px_-8px_rgba(255,255,255,0.4)]"
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                />
              )}
            </NavLink>
          );
        })}

        <a
          href="https://github.com/Waqar-743/RAG_Chatbot"
          target="_blank"
          rel="noreferrer"
          className="ml-2 flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-medium text-chalk-dim hover:text-chalk transition-colors duration-500 ease-spring border border-white/[0.06]"
          title="View source"
        >
          <i className="ph-github-logo text-[14px]" />
          <span className="hidden lg:inline">Source</span>
          <i className="ph-arrow-up-right text-[11px] opacity-60" />
        </a>
      </nav>

      {/* Mobile floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="md:hidden fixed top-5 right-5 z-50 size-12 rounded-full bg-ink-900/80 backdrop-blur-xl border border-white/[0.08] flex items-center justify-center shadow-2xl"
        aria-label="Toggle menu"
      >
        <span className="relative w-5 h-5 flex flex-col items-center justify-center">
          <span
            className={`absolute h-[1.5px] w-5 bg-chalk transition-all duration-500 ease-spring ${
              open ? 'rotate-45' : '-translate-y-[5px]'
            }`}
          />
          <span
            className={`absolute h-[1.5px] w-5 bg-chalk transition-all duration-500 ease-spring ${
              open ? '-rotate-45' : 'translate-y-[5px]'
            }`}
          />
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
            className="md:hidden fixed inset-0 z-40 bg-ink/85 backdrop-blur-3xl flex flex-col items-center justify-center gap-2"
          >
            {NAV_ITEMS.map((item, i) => (
              <motion.div
                key={item.to}
                initial={{ y: 40, opacity: 0, filter: 'blur(8px)' }}
                animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
                exit={{ y: 20, opacity: 0 }}
                transition={{ delay: 0.08 + i * 0.06, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              >
                <NavLink
                  to={item.to}
                  className="flex items-center gap-4 px-8 py-4 rounded-full text-2xl font-medium tracking-editorial text-chalk"
                >
                  <i className={`${item.icon} text-2xl text-accent`} />
                  {item.label}
                </NavLink>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="relative min-h-[100dvh] bg-ink text-chalk overflow-x-hidden">
      <div className="ambient-mesh" />
      <FloatingNav />
      <main className="relative z-10 pt-24 md:pt-28">
        {children}
      </main>
      <div className="grain-layer" />
    </div>
  );
};

const App: React.FC = () => {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
        <IndexingProvider>
          <Layout>
            <Routes>
              <Route path="/" element={<ChatView />} />
              <Route path="/index" element={<IndexingView />} />
              <Route path="/architecture" element={<ArchitectureView />} />
              <Route path="*" element={<ChatView />} />
            </Routes>
          </Layout>
        </IndexingProvider>
      </ToastProvider>
    </BrowserRouter>
  );
};

export default App;
