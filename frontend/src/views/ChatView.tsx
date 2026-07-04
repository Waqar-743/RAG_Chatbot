import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast, useIndexing } from '../context/GlobalContext';
import api, { Source, DocumentInput } from '../services/api';
import { AppIcon, CircularIconButton, type IconName } from '../components/Icon';

interface SpeechRecognitionEvent extends Event { results: SpeechRecognitionResultList }
interface SpeechRecognitionErrorEvent extends Event { error: string }
interface SpeechRecognitionResult { 0: { transcript: string; confidence: number }; length: number; isFinal: boolean }
interface SpeechRecognitionResultList { length: number; item(i: number): SpeechRecognitionResult; [i: number]: SpeechRecognitionResult }
interface SpeechRecognitionInstance {
  continuous: boolean; interimResults: boolean; lang: string;
  start(): void; stop(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
}

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  time: string;
  grounded?: boolean;
  sources?: Source[];
  processing_time_ms?: number;
}

const SUGGESTIONS = [
  { icon: 'lightning', label: 'Summarize my latest indexed document' },
  { icon: 'magnifying-glass', label: 'Find references to "embedding model"' },
  { icon: 'graph', label: 'How does the RAG pipeline work?' },
  { icon: 'file-arrow-up', label: 'Drag a file here to index instantly' },
] satisfies { icon: IconName; label: string }[];

const ChatView: React.FC = () => {
  const { showToast } = useToast();
  const { addActivityLog } = useIndexing();

  const [query, setQuery] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [sessionId] = useState(() => `session_${Date.now()}`);
  const [messages, setMessages] = useState<Message[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR() as SpeechRecognitionInstance;
    rec.continuous = false; rec.interimResults = true; rec.lang = 'en-US';
    rec.onresult = (e) => {
      let t = '';
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      setQuery(t);
    };
    rec.onend = () => setIsListening(false);
    rec.onerror = (e) => {
      setIsListening(false);
      showToast(e.error === 'not-allowed' ? 'Microphone access denied' : `Voice error: ${e.error}`, 'error');
    };
    recognitionRef.current = rec;
    return () => { recognitionRef.current?.stop(); };
  }, [showToast]);

  const toggleVoice = () => {
    if (!recognitionRef.current) return showToast('Voice input not supported in this browser', 'error');
    if (isListening) { recognitionRef.current.stop(); setIsListening(false); }
    else {
      try { recognitionRef.current.start(); setIsListening(true); }
      catch { showToast('Could not start voice input', 'error'); }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const valid = ['text/plain', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!valid.includes(file.type) && !/\.(txt|md)$/.test(file.name)) {
      return showToast('Upload a TXT, MD, PDF, or DOCX file', 'error');
    }
    setIsUploading(true);
    showToast(`Reading ${file.name}…`, 'info');
    const start = Date.now();
    try {
      const slug = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9]/g, '_');
      let text = '';
      if (file.type === 'text/plain' || /\.(txt|md)$/.test(file.name)) text = await file.text();
      else { const r = await api.uploadFile(file); text = r.text; }
      if (!text) throw new Error('No text extracted');
      const doc: DocumentInput = { source: slug, content: text, metadata: { indexed_via: 'chat_upload', timestamp: new Date().toISOString() } };
      const res = await api.indexDocuments([doc]);
      const dur = ((Date.now() - start) / 1000).toFixed(1) + 's';
      if (res.successful > 0) {
        showToast(`Indexed "${file.name}" — ${res.total_chunks} chunks`, 'success');
        addActivityLog({ name: file.name, time: new Date().toLocaleTimeString(), duration: dur, status: 'SUCCESS', icon: 'file-text', chunks: res.total_chunks });
        setQuery(`Tell me about the document "${slug}".`);
      } else throw new Error(res.details[0]?.message || 'Index failed');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSend = async (override?: string) => {
    const q = (override ?? query).trim();
    if (!q || isThinking) return;
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); }

    const user: Message = { id: Date.now(), role: 'user', content: q, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    setMessages(prev => [...prev, user]);
    setQuery('');
    setIsThinking(true);

    const urls = q.match(/https?:\/\/[^\s]+/g);
    if (urls?.[0]) {
      try { await api.indexUrl(urls[0]); } catch { /* silent */ }
    }

    try {
      const res = await api.query({ query: q, session_id: sessionId, top_k: 5 });
      const a: Message = {
        id: Date.now() + 1, role: 'assistant', content: res.answer,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        grounded: res.sources.length > 0, sources: res.sources, processing_time_ms: res.processing_time_ms,
      };
      setMessages(prev => [...prev, a]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Request failed', 'error');
      setMessages(prev => [...prev, {
        id: Date.now() + 1, role: 'assistant',
        content: 'I hit an error reaching the model. Please try again — and check that your backend is reachable.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }]);
    } finally {
      setIsThinking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="relative min-h-[calc(100dvh-7rem)] px-4 md:px-8 pb-40">
      <input ref={fileInputRef} type="file" onChange={handleFileChange} accept=".txt,.md,.pdf,.docx" className="hidden" />

      <div className="max-w-3xl mx-auto w-full">

        {isEmpty ? (
          <motion.div
            initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0)' }}
            transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className="pt-12 md:pt-20 text-center"
          >
            <span className="eyebrow mb-8">Grounded Intelligence</span>
            <h1 className="heading-xl text-balance mt-6">
              Ask anything.<br />
              Get answers <em>cited</em> from your<br />own knowledge base.
            </h1>
            <p className="mt-8 text-chalk-dim text-base md:text-lg max-w-xl mx-auto leading-relaxed">
              A retrieval-augmented assistant that thinks across <span className="text-chalk">your indexed documents</span>, not the open web.
            </p>

            <div className="mt-14 grid grid-cols-1 md:grid-cols-2 gap-3 text-left">
              {SUGGESTIONS.map((s, i) => (
                <motion.button
                  key={s.label}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.08, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                  onClick={() => handleSend(s.label)}
                  className="group bezel-shell hover:scale-[1.01] transition-transform duration-700 ease-spring text-left"
                >
                  <div className="bezel-core px-5 py-4 flex items-center gap-3">
                    <div className="size-9 rounded-full bg-accent/[0.15] border border-accent/30 flex items-center justify-center text-accent group-hover:text-chalk group-hover:bg-white/[0.10] group-hover:border-white/20 transition-all duration-500 ease-spring">
                      <AppIcon name={s.icon} size={16} />
                    </div>
                    <span className="text-[13px] text-chalk-dim group-hover:text-chalk transition-colors duration-500">
                      {s.label}
                    </span>
                  </div>
                </motion.button>
              ))}
            </div>
          </motion.div>
        ) : (
          <div className="pt-8 space-y-10">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} onCopy={() => {
                navigator.clipboard.writeText(msg.content);
                showToast('Copied', 'success');
              }} />
            ))}

            {isThinking && (
              <div className="flex items-center gap-3 px-2">
                <div className="size-1.5 rounded-full bg-accent animate-bounce" />
                <div className="size-1.5 rounded-full bg-accent animate-bounce [animation-delay:0.15s]" />
                <div className="size-1.5 rounded-full bg-accent animate-bounce [animation-delay:0.3s]" />
                <span className="text-[10px] tracking-[0.25em] uppercase font-medium text-chalk-mute ml-2">Thinking</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Floating composer — fixed at bottom, double-bezel */}
      <div className="fixed bottom-0 left-0 right-0 z-30 px-4 md:px-8 pb-6 pt-12 bg-gradient-to-t from-ink via-ink/85 to-transparent pointer-events-none">
        <div className="max-w-3xl mx-auto pointer-events-auto">
          <div className={`bezel-shell transition-all duration-700 ease-spring ${isListening ? 'ring-2 ring-rose-400/40' : ''}`}>
            <div className="bezel-core px-3 py-3">
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder={isListening ? 'Listening… speak now' : 'Ask your knowledge base anything…'}
                className="w-full bg-transparent border-none text-[15px] text-chalk placeholder:text-chalk-mute resize-none px-3 py-2 max-h-40 thin-scroll"
              />
              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-1">
                  <CircularIconButton
                    icon="plus"
                    label={isUploading ? 'Uploading document' : 'Add document'}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    size="lg"
                    tone="neutral"
                    iconSize={21}
                  />
                  <CircularIconButton
                    icon={isListening ? 'microphone-slash' : 'microphone'}
                    label={isListening ? 'Stop voice input' : 'Start voice input'}
                    onClick={toggleVoice}
                    size="lg"
                    tone={isListening ? 'active' : 'neutral'}
                    iconSize={20}
                  />
                  <span className="hidden md:inline text-[10px] tracking-[0.25em] uppercase font-medium text-chalk-mute ml-2">
                    Session {sessionId.slice(-6)}
                  </span>
                </div>

                <CircularIconButton
                  icon="paper-plane-right"
                  label="Send message"
                  onClick={() => handleSend()}
                  disabled={!query.trim() || isThinking}
                  size="lg"
                  tone="accent"
                  iconSize={21}
                />
              </div>
            </div>
          </div>
          <p className="text-center text-[10px] tracking-[0.25em] uppercase text-chalk-mute mt-4 font-medium">
            Grounded · cited · private
          </p>
        </div>
      </div>
    </div>
  );
};

const MessageBubble: React.FC<{ msg: Message; onCopy: () => void }> = ({ msg, onCopy }) => {
  const isUser = msg.role === 'user';
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, filter: 'blur(6px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0)' }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className={`flex gap-4 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      <div className={`size-8 shrink-0 rounded-full flex items-center justify-center border ${
        isUser ? 'bg-white/[0.10] border-white/[0.20] text-chalk-dim'
               : 'bg-accent/20 border-accent/40 text-accent'
      }`}>
        <AppIcon name={isUser ? 'user' : 'sparkle'} size={14} />
      </div>

      <div className={`flex-1 max-w-[88%] ${isUser ? 'text-right' : ''}`}>
        <div className="flex items-center gap-2 mb-2 text-[10px] tracking-[0.2em] uppercase text-chalk-mute font-medium">
          {isUser ? <span className="ml-auto">You · {msg.time}</span> : (
            <>
              <span>Ragnarok · {msg.time}</span>
              {msg.grounded && (
                <span className="px-2 py-0.5 rounded-full bg-accent-mint/10 text-accent-mint border border-accent-mint/20 normal-case tracking-tight text-[10px] font-medium flex items-center gap-1">
                  <AppIcon name="shield-check" size={11} />
                  Cited
                </span>
              )}
              {msg.processing_time_ms != null && (
                <span className="font-mono normal-case tracking-tight text-chalk-mute">{msg.processing_time_ms}ms</span>
              )}
            </>
          )}
        </div>

        {isUser ? (
          <div className="inline-block bezel-shell">
            <div className="bezel-core px-5 py-3 text-[14px] text-chalk text-left whitespace-pre-wrap leading-relaxed">
              {msg.content}
            </div>
          </div>
        ) : (
          <div className="text-[15px] text-chalk leading-[1.7] tracking-tight whitespace-pre-wrap text-pretty">
            {msg.content}
          </div>
        )}

        {!isUser && msg.sources && msg.sources.length > 0 && (
          <div className="mt-6">
            <div className="text-[10px] tracking-[0.25em] uppercase text-chalk-mute font-medium mb-3 flex items-center gap-2">
              <AppIcon name="bookmarks" size={12} />
              Sources <span className="text-chalk-ghost">·</span> {msg.sources.length}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {msg.sources.slice(0, 4).map((s, i) => (
                <SourcePill key={i} source={s} />
              ))}
            </div>
            <div className="mt-4 flex gap-1">
              <CircularIconButton icon="copy" onClick={onCopy} label="Copy answer" size="sm" />
              <CircularIconButton icon="thumbs-up" label="Mark answer helpful" size="sm" tone="mint" />
              <CircularIconButton icon="thumbs-down" label="Mark answer not helpful" size="sm" tone="danger" />
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};

const SourcePill: React.FC<{ source: Source }> = ({ source }) => {
  const [open, setOpen] = useState(false);
  const pct = Math.round(source.score * 100);
  return (
    <button onClick={() => setOpen(o => !o)} className="bezel-shell text-left transition-transform duration-700 ease-spring hover:scale-[1.01]">
      <div className="bezel-core px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <AppIcon name="file-text" size={14} className="text-accent" />
            <span className="text-[12px] font-medium text-chalk truncate">{source.source}</span>
          </div>
          <span className="text-[10px] font-mono text-accent-mint shrink-0">{pct}%</span>
        </div>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
              className="overflow-hidden"
            >
              <p className="mt-3 pt-3 border-t border-white/[0.05] text-[11px] text-chalk-dim italic leading-relaxed line-clamp-4">
                "{source.text}"
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </button>
  );
};

export default ChatView;
