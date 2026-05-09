import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast, useIndexing } from '../context/GlobalContext';
import api, { CollectionStats, DocumentInput } from '../services/api';

type PipelineStage = 'idle' | 'received' | 'parsing' | 'chunking' | 'embedding' | 'upserting' | 'complete' | 'error';

const STAGES: { key: Exclude<PipelineStage, 'idle' | 'complete' | 'error'>; label: string; icon: string }[] = [
  { key: 'received',  label: 'Receive',  icon: 'ph-tray-arrow-down' },
  { key: 'parsing',   label: 'Parse',    icon: 'ph-code' },
  { key: 'chunking',  label: 'Chunk',    icon: 'ph-scissors' },
  { key: 'embedding', label: 'Embed',    icon: 'ph-sparkle' },
  { key: 'upserting', label: 'Persist',  icon: 'ph-database' },
];

const IndexingView: React.FC = () => {
  const { showToast } = useToast();
  const { document: saved, setDocument, activityLogs, addActivityLog, clearActivityLogs } = useIndexing();

  const [wikiUrl, setWikiUrl] = useState(saved.wikiUrl);
  const [textContent, setTextContent] = useState(saved.textContent);
  const [sourceName, setSourceName] = useState(saved.sourceName);
  const [isIndexing, setIsIndexing] = useState(false);
  const [stats, setStats] = useState<CollectionStats | null>(null);
  const [stage, setStage] = useState<PipelineStage>('idle');
  const [pct, setPct] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDocument({ sourceName, textContent, wikiUrl }); }, [sourceName, textContent, wikiUrl, setDocument]);
  useEffect(() => { fetchStats(); }, []);

  const fetchStats = async () => {
    try { setStats(await api.getStats()); } catch (e) { console.error(e); }
  };

  const animatePipeline = useCallback(async (success = true) => {
    const steps: { stage: PipelineStage; pct: number; delay: number }[] = [
      { stage: 'received',  pct: 12, delay: 280 },
      { stage: 'parsing',   pct: 28, delay: 480 },
      { stage: 'chunking',  pct: 48, delay: 700 },
      { stage: 'embedding', pct: 74, delay: 1300 },
      { stage: 'upserting', pct: 92, delay: 900 },
      { stage: success ? 'complete' : 'error', pct: 100, delay: 280 },
    ];
    for (const s of steps) {
      setStage(s.stage); setPct(s.pct);
      await new Promise(r => setTimeout(r, s.delay));
      if (s.stage === 'error') break;
    }
  }, []);

  const indexDocument = async () => {
    if (!textContent.trim() || !sourceName.trim()) {
      return showToast('Source name and content are required', 'error');
    }
    setIsIndexing(true); setStage('received'); setPct(0);
    showToast(`Indexing: ${sourceName}`, 'info');
    const start = Date.now();
    const anim = animatePipeline(true);

    try {
      const doc: DocumentInput = {
        source: sourceName, content: textContent, url: wikiUrl || undefined,
        metadata: { indexed_via: 'web_ui', timestamp: new Date().toISOString() },
      };
      const res = await api.indexDocuments([doc]);
      await anim;
      const dur = ((Date.now() - start) / 1000).toFixed(1);
      if (res.successful > 0) {
        showToast(`Indexed — ${res.total_chunks} chunks`, 'success');
        addActivityLog({ name: sourceName, time: nowTime(), duration: `${dur}s`, status: 'SUCCESS', icon: 'ph-file-text', chunks: res.total_chunks });
        setTextContent(''); setSourceName(''); setWikiUrl('');
        await fetchStats();
      } else {
        setStage('error');
        showToast('Indexing failed: ' + (res.details[0]?.message || 'Unknown'), 'error');
        addActivityLog({ name: sourceName, time: nowTime(), duration: '—', status: 'FAILED', icon: 'ph-warning' });
      }
    } catch (err) {
      setStage('error');
      showToast(err instanceof Error ? err.message : 'Indexing failed', 'error');
      addActivityLog({ name: sourceName, time: nowTime(), duration: '—', status: 'FAILED', icon: 'ph-warning' });
    } finally {
      setIsIndexing(false);
      setTimeout(() => { setStage('idle'); setPct(0); }, 2000);
    }
  };

  const fetchUrl = async () => {
    if (!wikiUrl.startsWith('http')) return showToast('URL must start with http(s)://', 'error');
    setIsIndexing(true); setStage('received'); setPct(0);
    showToast(`Fetching: ${wikiUrl}`, 'info');
    const start = Date.now();
    const anim = animatePipeline(true);
    try {
      const res = await api.indexUrl(wikiUrl);
      await anim;
      const dur = ((Date.now() - start) / 1000).toFixed(1);
      if (res.successful > 0) {
        showToast('URL indexed', 'success');
        addActivityLog({ name: wikiUrl.replace(/^https?:\/\//, '').slice(0, 32) + '…', time: nowTime(), duration: `${dur}s`, status: 'SUCCESS', icon: 'ph-globe', chunks: res.total_chunks });
        setWikiUrl(''); await fetchStats();
      } else {
        setStage('error'); showToast('Failed to index URL', 'error');
      }
    } catch (err) {
      setStage('error');
      showToast(err instanceof Error ? err.message : 'URL fetch failed', 'error');
    } finally {
      setIsIndexing(false);
      setTimeout(() => { setStage('idle'); setPct(0); }, 2000);
    }
  };

  const readFile = async (file: File) => {
    const valid = file.type.startsWith('text/') || /\.(txt|md|pdf|docx)$/i.test(file.name);
    if (!valid) return showToast('TXT, MD, PDF or DOCX only', 'error');
    showToast(`Reading ${file.name}…`, 'info');
    try {
      setSourceName(file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9]/g, '_'));
      if (file.type === 'text/plain' || /\.(txt|md)$/i.test(file.name)) {
        const t = await file.text();
        setTextContent(t);
        showToast(`Loaded ${t.length.toLocaleString()} characters`, 'success');
      } else {
        const r = await api.uploadFile(file);
        setTextContent(r.text);
        showToast(`Extracted ${r.char_count.toLocaleString()} characters`, 'success');
      }
    } catch {
      showToast('Failed to read file', 'error');
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) readFile(f);
  };

  return (
    <div className="px-4 md:px-8 pb-24 max-w-7xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16, filter: 'blur(6px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0)' }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="mb-12"
      >
        <span className="eyebrow">Knowledge Pipeline</span>
        <h1 className="heading-xl mt-5">
          Index <em>everything</em>.<br />
          Retrieve nothing irrelevant.
        </h1>
        <p className="mt-5 text-chalk-dim text-base max-w-xl leading-relaxed">
          Drop a document, paste a URL, or stream raw text — your knowledge base updates in real time.
        </p>
      </motion.div>

      {/* Stats bento — 3 asymmetric tiles */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-6">
        <StatTile className="md:col-span-3" eyebrow="Vectors" icon="ph-database"
                  value={stats?.vector_count?.toLocaleString() || '0'}
                  hint={stats?.status === 'healthy' ? 'Live · synced' : 'Connecting…'} />
        <StatTile className="md:col-span-2" eyebrow="Documents" icon="ph-files"
                  value={stats?.document_count?.toString() || '0'}
                  hint="In collection" />
        <StatTile className="md:col-span-1" eyebrow="Session" icon="ph-check-circle"
                  value={activityLogs.filter(l => l.status === 'SUCCESS').length.toString()}
                  hint="Indexed" />
      </div>

      {/* Main bento — drop-zone hero (left, large) + form (right, stacked) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 mb-6">

        {/* DROP ZONE HERO */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className="lg:col-span-7 bezel-shell cursor-pointer group transition-transform duration-700 ease-spring hover:scale-[1.005]"
        >
          <input ref={fileInputRef} type="file" accept=".txt,.md,.pdf,.docx" className="hidden"
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); if (fileInputRef.current) fileInputRef.current.value = ''; }} />
          <div className={`bezel-core p-12 md:p-16 min-h-[360px] flex flex-col items-center justify-center text-center transition-colors duration-700 ease-spring ${dragOver ? 'bg-accent/[0.06]' : ''}`}>
            <motion.div
              animate={{ y: dragOver ? -6 : 0 }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className={`size-20 rounded-full flex items-center justify-center mb-6 border transition-all duration-700 ${
                dragOver
                  ? 'bg-accent/25 border-accent/60 shadow-[0_0_32px_rgba(201,184,255,0.25)]'
                  : 'bg-white/[0.08] border-white/[0.15] group-hover:bg-accent/15 group-hover:border-accent/40'
              }`}
            >
              <i className={`ph-cloud-arrow-up text-[34px] ${dragOver ? 'text-accent' : 'text-chalk group-hover:text-accent'} transition-colors duration-700`} />
            </motion.div>
            <h3 className="text-[22px] font-medium tracking-tightest text-chalk">
              {dragOver ? 'Release to import' : 'Drop a document'}
            </h3>
            <p className="text-[13px] text-chalk-mute mt-2 tracking-tight">
              or click to browse · <span className="font-mono text-chalk-dim">.txt .md .pdf .docx</span>
            </p>

            <div className="mt-8 flex items-center gap-2 text-[10px] tracking-[0.25em] uppercase text-chalk-mute font-medium">
              <span>Auto-chunk</span><span className="text-chalk-ghost">·</span>
              <span>Embed</span><span className="text-chalk-ghost">·</span>
              <span>Persist</span>
            </div>
          </div>
        </div>

        {/* FORM SIDE */}
        <div className="lg:col-span-5 flex flex-col gap-3">
          <div className="bezel-shell flex-1">
            <div className="bezel-core p-6 space-y-5">
              <div>
                <label className="text-[10px] tracking-[0.2em] uppercase font-medium text-chalk-mute mb-2 block">Source name</label>
                <input value={sourceName} onChange={(e) => setSourceName(e.target.value)}
                       placeholder="company_handbook_2024"
                       className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3 text-[13px] text-chalk placeholder:text-chalk-mute focus:border-accent/40 transition-colors duration-500" />
              </div>

              <div>
                <label className="text-[10px] tracking-[0.2em] uppercase font-medium text-chalk-mute mb-2 block">URL <span className="text-chalk-ghost normal-case tracking-tight">(optional)</span></label>
                <div className="flex gap-2">
                  <input value={wikiUrl} onChange={(e) => setWikiUrl(e.target.value)}
                         placeholder="https://…"
                         className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3 text-[13px] text-chalk placeholder:text-chalk-mute focus:border-accent/40 transition-colors duration-500" />
                  <button onClick={fetchUrl} disabled={!wikiUrl || isIndexing}
                          className="px-4 rounded-xl text-[11px] font-medium tracking-[0.15em] uppercase bg-accent/[0.12] text-accent border border-accent/20 hover:bg-accent/20 disabled:opacity-40 transition-all duration-500">
                    Fetch
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[10px] tracking-[0.2em] uppercase font-medium text-chalk-mute mb-2 block flex items-center justify-between">
                  <span>Content</span>
                  <span className="font-mono normal-case text-chalk-ghost tracking-tight">{textContent.length.toLocaleString()} chars</span>
                </label>
                <textarea value={textContent} onChange={(e) => setTextContent(e.target.value)}
                          rows={5} placeholder="Paste raw text…"
                          className="w-full bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-3 text-[13px] text-chalk placeholder:text-chalk-mute focus:border-accent/40 resize-none transition-colors duration-500 thin-scroll" />
              </div>

              <button
                onClick={indexDocument}
                disabled={isIndexing || !textContent.trim() || !sourceName.trim()}
                className={`btn-magnetic w-full justify-center ${(isIndexing || !textContent.trim() || !sourceName.trim()) ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                {isIndexing ? 'Indexing…' : 'Index document'}
                <span className="icon-island"><i className={`${isIndexing ? 'ph-circle-notch animate-spin' : 'ph-arrow-up-right'} text-[14px]`} /></span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline visualization */}
      <div className="bezel-shell mb-6">
        <div className="bezel-core p-6 md:p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <span className="eyebrow">Pipeline</span>
              <p className="mt-3 text-[14px] text-chalk-dim tracking-tight">
                {isIndexing ? `Processing: ${sourceName || 'document'}` : stage === 'complete' ? 'Last job complete' : stage === 'error' ? 'Last job failed' : 'Idle'}
              </p>
            </div>
            <span className="font-mono text-[11px] text-chalk-mute tracking-tight">{pct}%</span>
          </div>

          <div className="relative h-[2px] bg-white/[0.06] rounded-full overflow-hidden mb-10">
            <motion.div
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
              className={`absolute top-0 left-0 h-full ${stage === 'error' ? 'bg-rose-400' : stage === 'complete' ? 'bg-accent-mint' : 'bg-accent shadow-[0_0_12px_#C9B8FF]'}`}
            />
          </div>

          <div className="grid grid-cols-5 gap-2 md:gap-4">
            {STAGES.map(s => {
              const status = stageStatus(s.key, stage);
              return (
                <div key={s.key} className="flex flex-col items-center gap-3 text-center">
                  <div className={`size-11 rounded-full flex items-center justify-center transition-all duration-700 ease-spring border ${
                    status === 'done'   ? 'bg-accent-mint/[0.12] border-accent-mint/40 text-accent-mint' :
                    status === 'active' ? 'bg-accent/[0.16] border-accent/50 text-accent shadow-[0_0_24px_rgba(201,184,255,0.35)]' :
                                           'bg-white/[0.04] border-white/[0.08] text-chalk-mute'
                  }`}>
                    <i className={`${status === 'done' ? 'ph-check' : status === 'active' ? 'ph-circle-notch animate-spin' : s.icon} text-[15px]`} />
                  </div>
                  <p className={`text-[11px] font-medium tracking-tight ${status === 'pending' ? 'text-chalk-mute' : 'text-chalk'}`}>
                    {s.label}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Activity log */}
      <div className="bezel-shell">
        <div className="bezel-core overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.05]">
            <div className="flex items-center gap-3">
              <span className="eyebrow">Activity</span>
              <span className="text-[11px] font-mono text-chalk-mute">{activityLogs.length}</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={fetchStats} title="Refresh stats" className="size-8 rounded-full bg-white/[0.07] border border-white/[0.10] hover:bg-white/[0.12] flex items-center justify-center text-chalk-dim hover:text-chalk transition-colors duration-500">
                <i className="ph-arrows-clockwise text-[14px]" />
              </button>
              {activityLogs.length > 0 && (
                <button onClick={() => { if (confirm('Clear all activity?')) clearActivityLogs(); }} title="Clear" className="size-8 rounded-full bg-white/[0.07] border border-white/[0.10] hover:bg-rose-400/15 hover:border-rose-400/30 flex items-center justify-center text-chalk-dim hover:text-rose-300 transition-colors duration-500">
                  <i className="ph-trash text-[14px]" />
                </button>
              )}
            </div>
          </div>

          {activityLogs.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <i className="ph-clock-counter-clockwise text-[28px] text-chalk-ghost" />
              <p className="mt-4 text-[12px] text-chalk-mute tracking-tight">No activity yet — index a document to populate this log.</p>
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              <AnimatePresence>
                {activityLogs.map((log, idx) => (
                  <motion.li
                    key={`${log.name}-${idx}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className="px-6 py-3 flex items-center gap-4 hover:bg-white/[0.02] transition-colors duration-500"
                  >
                    <i className={`${log.icon || 'ph-file-text'} text-[15px] ${log.status === 'SUCCESS' ? 'text-accent-mint' : 'text-rose-300'}`} />
                    <span className="flex-1 text-[13px] font-medium text-chalk truncate">{log.name}</span>
                    <span className="hidden md:inline text-[11px] font-mono text-chalk-mute">{log.time}</span>
                    <span className="hidden md:inline text-[11px] font-mono text-chalk-mute w-12 text-right">{log.duration}</span>
                    <span className="hidden md:inline text-[11px] font-mono text-chalk-mute w-12 text-right">{log.chunks ?? '—'}</span>
                    <span className={`text-[10px] font-medium tracking-[0.18em] uppercase px-2 py-1 rounded-full ${
                      log.status === 'SUCCESS' ? 'bg-accent-mint/10 text-accent-mint' : 'bg-rose-400/10 text-rose-300'
                    }`}>{log.status}</span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

const StatTile: React.FC<{ className?: string; eyebrow: string; value: string; hint: string; icon: string }> =
  ({ className = '', eyebrow, value, hint, icon }) => (
  <div className={`bezel-shell ${className}`}>
    <div className="bezel-core p-6 h-full flex flex-col justify-between min-h-[140px]">
      <div className="flex items-start justify-between">
        <span className="text-[10px] tracking-[0.25em] uppercase font-medium text-chalk-mute">{eyebrow}</span>
        <i className={`${icon} text-[18px] text-accent`} />
      </div>
      <div>
        <p className="text-[36px] font-medium tracking-editorial text-chalk leading-none">{value}</p>
        <p className="mt-2 text-[11px] text-chalk-mute tracking-tight">{hint}</p>
      </div>
    </div>
  </div>
);

const stageStatus = (s: PipelineStage, current: PipelineStage): 'done' | 'active' | 'pending' => {
  const order: PipelineStage[] = ['received', 'parsing', 'chunking', 'embedding', 'upserting', 'complete'];
  const ci = order.indexOf(current);
  const si = order.indexOf(s);
  if (current === 'idle') return 'pending';
  if (current === 'error' && si <= ci) return 'done';
  if (si < ci) return 'done';
  if (si === ci) return 'active';
  return 'pending';
};

const nowTime = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default IndexingView;
