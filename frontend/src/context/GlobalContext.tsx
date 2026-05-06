import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

// === Toast Context ===
export interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ToastContextType {
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return context;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);

  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-50 space-y-2">
        {toasts.map(toast => (
          <div
            key={toast.id}
            style={{ animation: 'slideInToast 500ms cubic-bezier(0.16,1,0.3,1) both' }}
            className={`flex items-center gap-3 px-4 py-3 rounded-2xl backdrop-blur-xl border ${
              toast.type === 'success'
                ? 'bg-accent-mint/[0.08] border-accent-mint/30 text-accent-mint'
                : toast.type === 'error'
                ? 'bg-rose-400/[0.08] border-rose-400/30 text-rose-300'
                : 'bg-accent/[0.08] border-accent/30 text-accent'
            }`}
          >
            <i className={`text-[16px] ${
              toast.type === 'success' ? 'ph-check-circle' :
              toast.type === 'error' ? 'ph-warning-circle' : 'ph-info'
            }`} />
            <span className="text-[12px] font-medium tracking-tight text-chalk">{toast.message}</span>
          </div>
        ))}
      </div>
      <style>{`@keyframes slideInToast { from { opacity:0; transform: translateX(20px) } to { opacity:1; transform: translateX(0) } }`}</style>
    </ToastContext.Provider>
  );
};

// === Indexing Context ===
export interface ActivityLog {
  name: string;
  time: string;
  duration: string;
  status: 'SUCCESS' | 'FAILED';
  icon: string;
  chunks?: number;
}

export interface IndexingDocument {
  sourceName: string;
  textContent: string;
  wikiUrl: string;
}

interface IndexingContextType {
  document: IndexingDocument;
  setDocument: (doc: IndexingDocument) => void;
  activityLogs: ActivityLog[];
  addActivityLog: (log: ActivityLog) => void;
  clearActivityLogs: () => void;
  sessionStats: {
    indexedCount: number;
    totalChunks: number;
  };
  updateSessionStats: (chunks: number) => void;
}

const IndexingContext = createContext<IndexingContextType | null>(null);

export const useIndexing = () => {
  const context = useContext(IndexingContext);
  if (!context) {
    throw new Error('useIndexing must be used within IndexingProvider');
  }
  return context;
};

export const IndexingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [document, setDocument] = useState<IndexingDocument>({
    sourceName: '',
    textContent: '',
    wikiUrl: ''
  });
  
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>(() => {
    const saved = localStorage.getItem('indexingActivityLogs');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [sessionStats, setSessionStats] = useState({
    indexedCount: 0,
    totalChunks: 0
  });

  const addActivityLog = useCallback((log: ActivityLog) => {
    setActivityLogs(prev => {
      const newLogs = [log, ...prev.slice(0, 49)];
      localStorage.setItem('indexingActivityLogs', JSON.stringify(newLogs));
      return newLogs;
    });
    if (log.status === 'SUCCESS') {
      setSessionStats(prev => ({
        indexedCount: prev.indexedCount + 1,
        totalChunks: prev.totalChunks + (log.chunks || 0)
      }));
    }
  }, []);

  const clearActivityLogs = useCallback(() => {
    setActivityLogs([]);
    localStorage.removeItem('indexingActivityLogs');
  }, []);

  const updateSessionStats = useCallback((chunks: number) => {
    setSessionStats(prev => ({
      indexedCount: prev.indexedCount + 1,
      totalChunks: prev.totalChunks + chunks
    }));
  }, []);

  return (
    <IndexingContext.Provider value={{
      document,
      setDocument,
      activityLogs,
      addActivityLog,
      clearActivityLogs,
      sessionStats,
      updateSessionStats
    }}>
      {children}
    </IndexingContext.Provider>
  );
};
