import React, { useState, useRef, useEffect } from 'react';
import { useToast, useIndexing } from '../context/GlobalContext';
import api, { QueryResponse, Source, DocumentInput } from '../services/api';

// Web Speech API types
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionResult {
  0: SpeechRecognitionAlternative;
  length: number;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
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

const ChatView: React.FC = () => {
  const { showToast } = useToast();
  const { addActivityLog } = useIndexing();
  const [query, setQuery] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [sessionId] = useState(() => `session_${Date.now()}`);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 1,
      role: 'assistant',
      content: '👋 Welcome to the RAG Chatbot! I can help you find information from your indexed documents.\n\nTry asking me a question about your knowledge base.',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      grounded: false
    }
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isThinking]);

  // Initialize Speech Recognition
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognitionClass) {
      recognitionRef.current = new SpeechRecognitionClass() as SpeechRecognitionInstance;
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event: SpeechRecognitionEvent) => {
        const results = event.results;
        let transcript = '';
        for (let i = 0; i < results.length; i++) {
          transcript += results[i][0].transcript;
        }
        setQuery(transcript);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
        if (event.error === 'not-allowed') {
          showToast('Microphone access denied. Please allow microphone access.', 'error');
        } else {
          showToast(`Voice error: ${event.error}`, 'error');
        }
      };
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [showToast]);

  const toggleVoiceInput = () => {
    if (!recognitionRef.current) {
      showToast('Voice input is not supported in this browser. Try Chrome or Edge.', 'error');
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
      showToast('Voice input stopped', 'info');
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
        showToast('Listening... Speak now', 'info');
      } catch (error) {
        console.error('Failed to start speech recognition:', error);
        showToast('Failed to start voice input', 'error');
      }
    }
  };

  const handleFileAttach = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file type
    const validTypes = ['text/plain', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!validTypes.includes(file.type) && !file.name.endsWith('.txt') && !file.name.endsWith('.md')) {
      showToast('Please upload a text, PDF, or DOCX file', 'error');
      return;
    }

    setIsUploading(true);
    showToast(`Reading file: ${file.name}...`, 'info');
    const startTime = Date.now();

    try {
      let text = '';
      const fileName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9]/g, '_');

      // For text files, read directly
      if (file.type === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
        text = await file.text();
      } else {
        // For PDF/DOCX, extract via backend
        showToast(`Extracting text from ${file.name.split('.').pop()?.toUpperCase()}...`, 'info');
        const uploadResponse = await api.uploadFile(file);
        text = uploadResponse.text;
      }

      if (text) {
        showToast('Indexing document for RAG access...', 'info');
        
        // Auto-index the document so the model can access it
        try {
          const docInput: DocumentInput = {
            source: fileName,
            content: text,
            metadata: { indexed_via: 'chat_upload', timestamp: new Date().toISOString() }
          };
          
          const indexResponse = await api.indexDocuments([docInput]);
          const duration = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
          
          if (indexResponse.successful > 0) {
            showToast(`Document "${file.name}" indexed successfully! (${indexResponse.total_chunks} chunks)`, 'success');
            
            // Add to activity logs so it shows in the Indexing Dashboard
            addActivityLog({
              name: file.name,
              time: new Date().toLocaleTimeString(),
              duration: duration,
              status: 'SUCCESS',
              icon: 'description',
              chunks: indexResponse.total_chunks
            });

            setQuery(`I just uploaded a document called "${fileName}". `);
          } else {
            showToast('Failed to index document: ' + (indexResponse.details[0]?.message || 'Unknown error'), 'error');
            addActivityLog({
              name: file.name,
              time: new Date().toLocaleTimeString(),
              duration: duration,
              status: 'FAILED',
              icon: 'error'
            });
          }
        } catch (indexError) {
          console.error('Indexing error:', indexError);
          showToast(`Indexing failed: ${indexError instanceof Error ? indexError.message : 'Unknown error'}`, 'error');
        }
      }
    } catch (error) {
      showToast('Failed to read or extract file', 'error');
    } finally {
      setIsUploading(false);
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSend = async () => {
    if (!query.trim() || isThinking) return;

    // Stop voice if listening
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }

    const userMsg: Message = {
      id: Date.now(),
      role: 'user',
      content: query,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const currentQuery = query;
    setMessages(prev => [...prev, userMsg]);
    setQuery('');
    setIsThinking(true);

    // URL Detection and Auto-Indexing
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    const urls = currentQuery.match(urlPattern);
    
    if (urls && urls.length > 0) {
      const url = urls[0];
      showToast('Accessing link content...', 'info');
      try {
        await api.indexUrl(url);
        // No success toast here to keep it non-intrusive, 
        // the AI will use the content in its response
      } catch (err) {
        console.warn('Auto-indexing URL failed:', err);
      }
    }

    try {
      const response = await api.query({
        query: currentQuery,
        session_id: sessionId,
        top_k: 5
      });

      const assistantMsg: Message = {
        id: Date.now() + 1,
        role: 'assistant',
        content: response.answer,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        grounded: response.sources.length > 0,
        sources: response.sources,
        processing_time_ms: response.processing_time_ms
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (error) {
      showToast(`Error: ${error instanceof Error ? error.message : 'Failed to get response'}`, 'error');
      
      const errorMsg: Message = {
        id: Date.now() + 1,
        role: 'assistant',
        content: 'I apologize, but I encountered an error while processing your request. Please try again.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        grounded: false
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsThinking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const exportChat = () => {
    const chatContent = messages.map(msg => {
      const role = msg.role === 'user' ? 'You' : 'Assistant';
      const sources = msg.sources?.map(s => `  - ${s.source} (${Math.round(s.score * 100)}% match)`).join('\n') || '';
      return `[${msg.time}] ${role}:\n${msg.content}${sources ? `\n\nSources:\n${sources}` : ''}`;
    }).join('\n\n---\n\n');

    const blob = new Blob([chatContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rag-chat-${sessionId}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Chat exported successfully', 'success');
  };

  return (
    <div className="flex h-full">
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".txt,.md,.pdf,.docx"
        className="hidden"
      />

      {/* Local Sidebar for Chat History */}
      <aside className="w-80 bg-[#111418] border-r border-[#283039] flex flex-col shrink-0 p-6 hidden md:flex">
        <button 
          onClick={() => {
            setMessages([{
              id: Date.now(),
              role: 'assistant',
              content: '👋 Welcome to a new conversation! How can I help you today?',
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              grounded: false
            }]);
            showToast('New conversation started', 'success');
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 px-4 text-sm font-bold text-white hover:bg-primary/90 transition-colors mb-8 shadow-lg shadow-primary/20"
        >
          <span className="material-symbols-outlined text-sm">add</span> New Conversation
        </button>

        <div className="flex-1 overflow-y-auto no-scrollbar">
          <p className="text-[11px] font-black uppercase tracking-widest text-[#9dabb9] mb-4">Recent History</p>
          <div className="space-y-1">
             <HistoryItem active title="Current Session" onClick={() => showToast('Already in current session')} />
          </div>
        </div>

        <div className="mt-auto space-y-1 border-t border-[#283039] pt-6">
           <HistoryItem icon="download" title="Export Chat" onClick={exportChat} />
           <HistoryItem icon="settings" title="Assistant Settings" onClick={() => showToast('Settings coming soon...', 'info')} />
           <HistoryItem icon="help_center" title="Help Center" onClick={() => showToast('Help documentation coming soon...', 'info')} />
        </div>
      </aside>

      {/* Main Chat Interface */}
      <div className="flex-1 flex flex-col bg-background-dark overflow-hidden relative">
        <header className="h-16 border-b border-[#283039] px-8 flex items-center justify-between bg-[#111418]/50 backdrop-blur-md z-10">
          <div className="flex items-center gap-2">
            <span className="text-[#9dabb9] text-sm font-medium">Conversations</span>
            <span className="material-symbols-outlined text-[#9dabb9] text-sm">chevron_right</span>
            <span className="font-bold text-sm">RAG Query Session</span>
          </div>
          <div className="flex items-center gap-4">
             <button onClick={exportChat} className="p-2 hover:bg-white/5 rounded-lg text-[#9dabb9] hover:text-white transition-colors" title="Export Chat">
                <span className="material-symbols-outlined">download</span>
             </button>
             <button onClick={() => showToast('Sharing conversation...', 'info')} className="p-2 hover:bg-white/5 rounded-lg text-[#9dabb9]">
                <span className="material-symbols-outlined">share</span>
             </button>
             <div className="size-8 rounded-full bg-primary/20 border border-primary/30 overflow-hidden shrink-0">
                <img src="https://picsum.photos/seed/user1/40/40" alt="user" />
             </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 md:px-0 py-10 no-scrollbar">
           <div className="max-w-3xl mx-auto w-full space-y-10">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex items-start gap-4 ${msg.role === 'assistant' ? 'bg-white/5 p-6 rounded-2xl border border-white/5 shadow-2xl transition-all' : 'px-4'}`}>
                  {msg.role === 'user' ? (
                    <div className="size-9 shrink-0 rounded-full bg-slate-700 overflow-hidden ring-1 ring-[#3b4754]">
                      <img src="https://picsum.photos/seed/user2/40/40" alt="User" />
                    </div>
                  ) : (
                    <div className="size-9 shrink-0 rounded-full bg-primary flex items-center justify-center text-white shadow-lg shadow-primary/30">
                      <span className="material-symbols-outlined text-[20px]">smart_toy</span>
                    </div>
                  )}
                  
                  <div className="flex-1 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                       <span className={`text-sm font-bold ${msg.role === 'assistant' ? 'text-primary' : ''}`}>
                         {msg.role === 'user' ? 'You' : 'Knowledge Assistant'}
                       </span>
                       <span className="text-[10px] text-[#9dabb9]">{msg.time}</span>
                       {msg.grounded && (
                        <span className="ml-auto text-[9px] uppercase font-black text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full flex items-center gap-1 border border-emerald-500/20">
                          <span className="material-symbols-outlined text-[12px] font-bold">verified</span> Grounded
                        </span>
                       )}
                       {msg.processing_time_ms && (
                        <span className="text-[9px] text-[#9dabb9]">{msg.processing_time_ms}ms</span>
                       )}
                    </div>
                    <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
                       {msg.content}
                    </div>

                    {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-white/5">
                        <div className="flex items-center gap-2 text-[10px] font-black text-[#9dabb9] uppercase tracking-[2px] mb-4">
                           <span className="material-symbols-outlined text-[16px]">menu_book</span> Sources ({msg.sources.length})
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                           {msg.sources.slice(0, 4).map((source, idx) => (
                             <SourceCard 
                               key={idx}
                               name={source.source} 
                               match={`${Math.round(source.score * 100)}%`}
                               snippet={source.text} 
                               onClick={() => showToast(`Opening source: ${source.source}`, 'info')}
                             />
                           ))}
                        </div>
                        <div className="flex items-center gap-2 mt-6">
                           <ActionButton icon="thumb_up" onClick={() => showToast('Response liked', 'success')} />
                           <ActionButton icon="thumb_down" onClick={() => showToast('Response disliked. Feedback noted.', 'info')} />
                           <ActionButton icon="content_copy" onClick={() => {
                             navigator.clipboard.writeText(msg.content);
                             showToast('Copied to clipboard', 'success');
                           }} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isThinking && (
                <div className="flex items-center gap-2 px-4">
                   <div className="size-1.5 rounded-full bg-primary animate-bounce"></div>
                   <div className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:0.2s]"></div>
                   <div className="size-1.5 rounded-full bg-primary animate-bounce [animation-delay:0.4s]"></div>
                   <span className="text-[10px] text-[#9dabb9] font-bold uppercase tracking-widest ml-2">Assistant is thinking...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
           </div>
        </div>

        <div className="p-8 bg-[#111418] border-t border-[#283039]">
           <div className="max-w-3xl mx-auto relative">
              <div className={`bg-[#1b222a] border rounded-2xl p-2 transition-all focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary ${isListening ? 'border-red-500 ring-2 ring-red-500/20' : 'border-[#283039]'}`}>
                 <textarea 
                   value={query}
                   onChange={(e) => setQuery(e.target.value)}
                   onKeyDown={handleKeyDown}
                   className="w-full bg-transparent border-none focus:ring-0 text-sm py-3 px-4 resize-none max-h-32 text-slate-200" 
                   placeholder={isListening ? "Listening... speak now" : "Ask a question about your documents..."} 
                   rows={2}
                 />
                 <div className="flex items-center justify-between px-3 pb-2 pt-2">
                    <div className="flex items-center gap-1">
                       <IconButton 
                         icon={isUploading ? "progress_activity" : "attach_file"} 
                         onClick={handleFileAttach} 
                         active={isUploading}
                         title="Attach file" 
                       />
                       <IconButton 
                         icon={isListening ? "mic_off" : "mic"} 
                         onClick={toggleVoiceInput} 
                         active={isListening}
                         title={isListening ? "Stop listening" : "Voice input"}
                       />
                    </div>
                    <button 
                      onClick={handleSend}
                      disabled={!query.trim() || isThinking}
                      className={`bg-primary hover:bg-primary/90 text-white font-black py-2.5 px-6 rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-primary/20 ${(!query.trim() || isThinking) ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                       <span className="text-[10px] uppercase tracking-widest">Send</span>
                       <span className="material-symbols-outlined text-lg">send</span>
                    </button>
                 </div>
              </div>
              <p className="text-[9px] text-center text-[#9dabb9] mt-4 font-black uppercase tracking-[3px]">
                 Grounded in your indexed documents • Powered by RAG
              </p>
           </div>
        </div>
      </div>

      {/* Right Info Panel */}
      <aside className="w-80 bg-[#111418] border-l border-[#283039] flex flex-col shrink-0 hidden lg:flex">
         <div className="p-8 space-y-10">
            <div>
               <h3 className="text-[10px] font-black text-[#9dabb9] uppercase tracking-widest mb-6 flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm">info</span> Information Panel
               </h3>
               <div className="p-5 rounded-2xl bg-primary/5 border border-primary/20">
                  <h4 className="text-xs font-bold text-primary mb-2 uppercase tracking-tight">Knowledge Grounding</h4>
                  <p className="text-[11px] text-[#9dabb9] leading-relaxed">
                     Answers are derived from your indexed documents using semantic search and RAG technology.
                     <br/><br/>
                     <span className="text-white">Session ID:</span> {sessionId.slice(0, 20)}...
                  </p>
               </div>
            </div>

            <div>
               <h3 className="text-[10px] font-black text-[#9dabb9] uppercase tracking-widest mb-6">System Status</h3>
               <div className="space-y-2">
                  <CollectionItem icon="database" name="Qdrant Vector DB" active />
                  <CollectionItem icon="storage" name="MongoDB Metadata" active />
                  <CollectionItem icon="psychology" name="LLM Service" active />
               </div>
            </div>

            <div className="mt-auto">
               <div className="bg-[#1b222a] p-5 rounded-2xl border border-[#283039]">
                  <div className="flex items-center justify-between mb-3">
                     <span className="text-[9px] font-black text-[#9dabb9] uppercase tracking-widest">MESSAGES</span>
                     <span className="text-[10px] font-bold">{messages.length}</span>
                  </div>
                  <div className="w-full bg-[#283039] h-1.5 rounded-full overflow-hidden">
                     <div className="bg-primary h-full shadow-[0_0_8px_#FFB200]" style={{ width: `${Math.min(messages.length * 5, 100)}%` }}></div>
                  </div>
               </div>
            </div>
         </div>
      </aside>
    </div>
  );
};

const HistoryItem: React.FC<{ title: string; active?: boolean; icon?: string; onClick?: () => void }> = ({ title, active, icon = 'chat_bubble', onClick }) => (
  <div 
    onClick={onClick}
    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all ${
    active ? 'bg-[#283039] text-primary shadow-sm' : 'text-[#9dabb9] hover:bg-white/5 hover:text-white'
  }`}>
    <span className="material-symbols-outlined text-[18px]">{icon}</span>
    <span className="text-xs font-bold truncate">{title}</span>
  </div>
);

const SourceCard: React.FC<{ name: string; match: string; snippet: string; onClick?: () => void }> = ({ name, match, snippet, onClick }) => (
  <div 
    onClick={onClick}
    className="p-4 rounded-xl border border-[#283039] bg-[#111418] hover:border-primary/50 cursor-pointer transition-all group"
  >
    <div className="flex items-start justify-between mb-2">
      <span className="text-xs font-bold truncate flex-1 pr-2 group-hover:text-white transition-colors">{name}</span>
      <span className="text-[10px] text-primary font-black uppercase">{match} match</span>
    </div>
    <p className="text-[10px] text-[#9dabb9] line-clamp-2 italic">"{snippet}"</p>
  </div>
);

const ActionButton: React.FC<{ icon: string; onClick?: () => void }> = ({ icon, onClick }) => (
  <button onClick={onClick} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-[#9dabb9] hover:text-white">
    <span className="material-symbols-outlined text-[18px]">{icon}</span>
  </button>
);

const IconButton: React.FC<{ icon: string; onClick?: () => void; active?: boolean; title?: string }> = ({ icon, onClick, active, title }) => (
  <button 
    onClick={onClick} 
    title={title}
    className={`p-2 rounded-lg transition-colors ${
      active && icon === 'mic_off' ? 'bg-red-500/20 text-red-500 animate-pulse' : 
      active && icon === 'progress_activity' ? 'bg-primary/20 text-primary' :
      'hover:bg-white/5 text-[#9dabb9] hover:text-white'
    }`}
  >
    <span className={`material-symbols-outlined text-xl ${active && icon === 'progress_activity' ? 'animate-spin' : ''}`}>{icon}</span>
  </button>
);

const CollectionItem: React.FC<{ icon: string; name: string; active: boolean }> = ({ icon, name, active }) => (
  <div className="flex items-center justify-between p-3 rounded-xl border border-[#283039] bg-[#1b222a]/50 hover:border-primary/50 cursor-pointer transition-all">
    <div className="flex items-center gap-3">
       <span className="material-symbols-outlined text-sm text-primary">{icon}</span>
       <span className="text-[11px] font-bold">{name}</span>
    </div>
    <span className={`text-[8px] font-black px-1.5 py-0.5 rounded border ${active ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' : 'text-rose-500 bg-rose-500/10 border-rose-500/20'}`}>
      {active ? 'LIVE' : 'DOWN'}
    </span>
  </div>
);

export default ChatView;
