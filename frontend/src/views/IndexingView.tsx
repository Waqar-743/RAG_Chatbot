import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useToast, useIndexing } from '../context/GlobalContext';
import api, { CollectionStats, DocumentInput } from '../services/api';

type PipelineStage = 'idle' | 'received' | 'parsing' | 'chunking' | 'embedding' | 'upserting' | 'complete' | 'error';

const IndexingView: React.FC = () => {
  const { showToast } = useToast();
  const { document: savedDocument, setDocument, activityLogs, addActivityLog, clearActivityLogs } = useIndexing();
  
  // Use context values for form state (persists across navigation)
  const [wikiUrl, setWikiUrl] = useState(savedDocument.wikiUrl);
  const [textContent, setTextContent] = useState(savedDocument.textContent);
  const [sourceName, setSourceName] = useState(savedDocument.sourceName);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [isIndexing, setIsIndexing] = useState(false);
  const [stats, setStats] = useState<CollectionStats | null>(null);
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>('idle');
  const [progressPercent, setProgressPercent] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Save form state to context when values change
  useEffect(() => {
    setDocument({ sourceName, textContent, wikiUrl });
  }, [sourceName, textContent, wikiUrl, setDocument]);

  // Fetch stats on mount and after indexing
  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const data = await api.getStats();
      setStats(data);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  };

  // Simulate pipeline stages with realistic timing
  const runPipelineAnimation = useCallback(async (success: boolean = true) => {
    const stages: { stage: PipelineStage; percent: number; delay: number }[] = [
      { stage: 'received', percent: 10, delay: 300 },
      { stage: 'parsing', percent: 25, delay: 500 },
      { stage: 'chunking', percent: 45, delay: 800 },
      { stage: 'embedding', percent: 70, delay: 1500 },
      { stage: 'upserting', percent: 90, delay: 1000 },
      { stage: success ? 'complete' : 'error', percent: 100, delay: 300 },
    ];

    for (const { stage, percent, delay } of stages) {
      setPipelineStage(stage);
      setProgressPercent(percent);
      await new Promise(resolve => setTimeout(resolve, delay));
      if (stage === 'error') break;
    }
  }, []);

  const handleIndex = async () => {
    if (!textContent.trim() || !sourceName.trim()) {
      showToast('Please provide source name and content', 'error');
      return;
    }

    setIsIndexing(true);
    setPipelineStage('received');
    setProgressPercent(0);
    showToast(`Started indexing: ${sourceName}`, 'info');

    const startTime = Date.now();

    // Start pipeline animation
    const animationPromise = runPipelineAnimation(true);

    try {
      const docInput: DocumentInput = {
        source: sourceName,
        content: textContent,
        url: wikiUrl || undefined,
        metadata: { indexed_via: 'web_ui', timestamp: new Date().toISOString() }
      };

      const response = await api.indexDocuments([docInput]);
      
      // Wait for animation to complete
      await animationPromise;
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      if (response.successful > 0) {
        showToast(`Successfully indexed ${response.total_chunks} chunks!`, 'success');
        
        // Add to activity log (persisted in context)
        addActivityLog({
          name: sourceName,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          duration: `${duration}s`,
          status: 'SUCCESS',
          icon: 'description',
          chunks: response.total_chunks
        });

        // Clear form after successful indexing
        setTextContent('');
        setSourceName('');
        setWikiUrl('');
        
        // Refresh stats
        await fetchStats();
      } else {
        setPipelineStage('error');
        showToast('Indexing failed: ' + (response.details[0]?.message || 'Unknown error'), 'error');
        
        addActivityLog({
          name: sourceName,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          duration: '-',
          status: 'FAILED',
          icon: 'warning'
        });
      }
    } catch (error) {
      setPipelineStage('error');
      showToast(`Error: ${error instanceof Error ? error.message : 'Indexing failed'}`, 'error');
      
      addActivityLog({
        name: sourceName,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        duration: '-',
        status: 'FAILED',
        icon: 'warning'
      });
    } finally {
      setIsIndexing(false);
      // Reset pipeline after delay
      setTimeout(() => {
        setPipelineStage('idle');
        setProgressPercent(0);
      }, 2000);
    }
  };

  const handleFileUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = [
      'text/plain',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/markdown'
    ];
    
    const isValid = validTypes.includes(file.type) || 
                    file.name.endsWith('.txt') || 
                    file.name.endsWith('.md') ||
                    file.name.endsWith('.pdf') ||
                    file.name.endsWith('.docx');

    if (!isValid) {
      showToast('Please upload a TXT, MD, PDF, or DOCX file', 'error');
      return;
    }

    showToast(`Reading file: ${file.name}...`, 'info');

    try {
      // Set source name from filename
      const fileName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9]/g, '_');
      setSourceName(fileName);

      // For all files, use the backend upload API to ensure consistent extraction
      if (file.type === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
        const text = await file.text();
        setTextContent(text);
        showToast(`File loaded: ${text.length.toLocaleString()} characters`, 'success');
      } else {
        // For PDF, DOCX and others, use backend extraction
        showToast(`Extracting text from ${file.name.split('.').pop()?.toUpperCase()}...`, 'info');
        const response = await api.uploadFile(file);
        setTextContent(response.text);
        showToast(`Extraction successful: ${response.char_count.toLocaleString()} characters`, 'success');
      }

      // Set URL if available
      setWikiUrl('');

    } catch (error) {
      showToast('Failed to read file', 'error');
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFetchUrl = async () => {
    if (!wikiUrl.trim()) {
      showToast('Please enter a URL first', 'error');
      return;
    }

    if (!wikiUrl.startsWith('http')) {
      showToast('Please enter a valid URL starting with http:// or https://', 'error');
      return;
    }

    setIsIndexing(true);
    setPipelineStage('received');
    setProgressPercent(0);
    showToast(`Accessing URL: ${wikiUrl}`, 'info');

    const startTime = Date.now();
    const animationPromise = runPipelineAnimation(true);

    try {
      const response = await api.indexUrl(wikiUrl);
      
      await animationPromise;
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      if (response.successful > 0) {
        showToast(`Successfully indexed content from URL!`, 'success');
        
        addActivityLog({
          name: wikiUrl.replace(/^https?:\/\//, '').substring(0, 30) + '...',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          duration: `${duration}s`,
          status: 'SUCCESS',
          icon: 'language',
          chunks: response.total_chunks
        });

        setWikiUrl('');
        await fetchStats();
      } else {
        setPipelineStage('error');
        showToast('Failed to index URL: ' + (response.details[0]?.message || 'Unknown error'), 'error');
      }
    } catch (error) {
      setPipelineStage('error');
      showToast(`Error: ${error instanceof Error ? error.message : 'URL access failed'}`, 'error');
    } finally {
      setIsIndexing(false);
      setTimeout(() => {
        setPipelineStage('idle');
        setProgressPercent(0);
      }, 2000);
    }
  };

  const exportActivityLog = () => {
    if (activityLogs.length === 0) {
      showToast('No activity to export', 'info');
      return;
    }

    const csvContent = [
      'Document,Time,Duration,Status,Chunks',
      ...activityLogs.map(log => `"${log.name}","${log.time}","${log.duration}","${log.status}","${log.chunks || '-'}"`)
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `indexing-activity-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Activity log exported', 'success');
  };

  const getStageStatus = (stage: PipelineStage, currentStage: PipelineStage): 'done' | 'active' | 'pending' => {
    const stageOrder: PipelineStage[] = ['received', 'parsing', 'chunking', 'embedding', 'upserting', 'complete'];
    const currentIndex = stageOrder.indexOf(currentStage);
    const stageIndex = stageOrder.indexOf(stage);
    
    if (currentStage === 'idle') return 'pending';
    if (currentStage === 'error' && stageIndex <= currentIndex) return 'done';
    if (stageIndex < currentIndex) return 'done';
    if (stageIndex === currentIndex) return 'active';
    return 'pending';
  };

  return (
    <div className="flex-1 flex flex-col p-8 overflow-y-auto no-scrollbar">
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".txt,.md,.pdf,.docx"
        className="hidden"
      />

      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-black">Indexing Dashboard</h1>
          <span className="bg-emerald-500/10 text-emerald-500 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 border border-emerald-500/20">
             <div className="size-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
             System: {stats?.status || 'Loading...'}
          </span>
        </div>
        <div className="flex items-center gap-4 w-full md:w-auto">
           <div className="relative flex-1 md:flex-none">
             <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">search</span>
             <input 
              type="text" 
              placeholder="Search indexes..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-[#1b222a] border-none rounded-lg pl-10 pr-4 py-2 text-sm w-full md:w-64 focus:ring-1 focus:ring-primary" 
             />
           </div>
           <button 
            onClick={exportActivityLog}
            className="bg-[#283039] hover:bg-slate-700 text-white font-bold py-2 px-4 rounded-lg flex items-center gap-2 text-sm shrink-0 border border-[#3b4754]"
           >
             <span className="material-symbols-outlined text-sm">download</span> Export
           </button>
           <button 
            onClick={fetchStats}
            className="bg-primary hover:bg-primary/90 text-white font-bold py-2 px-4 rounded-lg flex items-center gap-2 text-sm shrink-0"
           >
             <span className="material-symbols-outlined text-sm">refresh</span> Refresh
           </button>
        </div>
      </div>

      {/* Stats Cards - Updated dynamically */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard 
          label="Total Documents" 
          value={stats?.document_count?.toString() || '0'} 
          icon="description"
          highlight={activityLogs.filter(l => l.status === 'SUCCESS').length > 0}
        />
        <StatCard 
          label="Vector Count" 
          value={stats?.vector_count?.toLocaleString() || '0'} 
          icon="database"
          highlight={false}
        />
        <StatCard 
          label="Session Indexed" 
          value={activityLogs.filter(l => l.status === 'SUCCESS').length.toString()} 
          icon="check_circle"
          highlight={activityLogs.filter(l => l.status === 'SUCCESS').length > 0}
        />
        <StatCard 
          label="Total Chunks (Session)" 
          value={activityLogs.filter(l => l.status === 'SUCCESS').reduce((acc, l) => acc + (l.chunks || 0), 0).toLocaleString()} 
          icon="memory"
          highlight={false}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-1 space-y-8">
          {/* Add Source Form */}
          <div className="bg-[#1b222a] border border-[#283039] p-6 rounded-xl">
             <h3 className="text-sm font-bold mb-4">Add New Document</h3>
             <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-[#9dabb9] uppercase mb-1.5 block">Source Name *</label>
                  <input 
                    type="text" 
                    value={sourceName}
                    onChange={(e) => setSourceName(e.target.value)}
                    placeholder="e.g., Company_Handbook_2024" 
                    className="bg-[#111418] border border-[#283039] rounded-lg px-3 py-2 text-xs w-full focus:ring-1 focus:ring-primary" 
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[#9dabb9] uppercase mb-1.5 block">Source URL (Optional)</label>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={wikiUrl}
                      onChange={(e) => setWikiUrl(e.target.value)}
                      placeholder="https://example.com/doc" 
                      className="bg-[#111418] border border-[#283039] rounded-lg px-3 py-2 text-xs flex-1 focus:ring-1 focus:ring-primary" 
                    />
                    <button 
                      onClick={() => wikiUrl && window.open(wikiUrl, '_blank')}
                      disabled={!wikiUrl}
                      title="Open URL"
                      className="bg-[#283039] text-primary p-2 rounded-lg hover:bg-slate-700 disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-sm">open_in_new</span>
                    </button>
                    <button 
                      onClick={handleFetchUrl}
                      disabled={!wikiUrl || isIndexing}
                      title="Fetch & Index URL content"
                      className="bg-primary/20 text-primary px-3 py-2 rounded-lg hover:bg-primary/30 disabled:opacity-50 text-[10px] font-bold uppercase transition-colors"
                    >
                      {isIndexing ? 'Fetching...' : 'Fetch & Index'}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-[#9dabb9] uppercase mb-1.5 block">
                    Document Content * 
                    <span className="text-slate-500 ml-2">({textContent.length.toLocaleString()} chars)</span>
                  </label>
                  <textarea
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    placeholder="Paste your document text content here..."
                    rows={6}
                    className="bg-[#111418] border border-[#283039] rounded-lg px-3 py-2 text-xs w-full focus:ring-1 focus:ring-primary resize-none"
                  />
                </div>
                <div 
                  onClick={handleFileUpload}
                  className="border-2 border-dashed border-[#283039] rounded-xl p-6 flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-white/5 hover:border-primary/50 transition-all group"
                >
                   <span className="material-symbols-outlined text-slate-500 text-3xl group-hover:text-primary group-hover:scale-110 transition-all">upload_file</span>
                   <div className="text-center">
                      <p className="text-xs font-bold text-[#9dabb9] group-hover:text-white transition-colors">Click to Upload File</p>
                      <p className="text-[10px] text-slate-600">TXT, MD, PDF, DOCX</p>
                   </div>
                </div>
                <button 
                  disabled={isIndexing || !textContent.trim() || !sourceName.trim()}
                  onClick={handleIndex}
                  className={`w-full py-3 rounded-lg text-sm font-bold shadow-lg shadow-primary/10 transition-all flex items-center justify-center gap-2 ${
                    isIndexing || !textContent.trim() || !sourceName.trim() ? 'bg-primary/50 cursor-not-allowed' : 'bg-primary hover:bg-primary/90'
                  }`}
                >
                  {isIndexing && <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>}
                  {isIndexing ? 'Indexing...' : 'Index Document'}
                </button>
             </div>
          </div>

          {/* Quick Stats */}
          <div className="bg-[#1b222a] border border-[#283039] p-6 rounded-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold">Quick Actions</h3>
            </div>
            <div className="space-y-3">
              <button 
                onClick={fetchStats}
                className="w-full flex items-center gap-3 p-3 bg-[#111418] rounded-lg border border-[#283039] hover:border-primary/30 transition-all"
              >
                <span className="material-symbols-outlined text-primary text-xl">refresh</span>
                <span className="text-xs font-bold">Refresh Statistics</span>
              </button>
              <button 
                onClick={exportActivityLog}
                className="w-full flex items-center gap-3 p-3 bg-[#111418] rounded-lg border border-[#283039] hover:border-primary/30 transition-all"
              >
                <span className="material-symbols-outlined text-primary text-xl">download</span>
                <span className="text-xs font-bold">Export Activity Log</span>
              </button>
              <button 
                onClick={() => {
                  setTextContent('');
                  setSourceName('');
                  setWikiUrl('');
                  showToast('Form cleared', 'info');
                }}
                className="w-full flex items-center gap-3 p-3 bg-[#111418] rounded-lg border border-[#283039] hover:border-primary/30 transition-all"
              >
                <span className="material-symbols-outlined text-primary text-xl">clear_all</span>
                <span className="text-xs font-bold">Clear Form</span>
              </button>
            </div>
          </div>
        </div>

        <div className="xl:col-span-2 space-y-8">
          {/* Pipeline Progress - Dynamic updates */}
          <div className="bg-[#1b222a] border border-[#283039] p-6 rounded-xl">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-2">
                <div className={`size-2 rounded-full ${isIndexing ? 'bg-primary animate-ping' : pipelineStage === 'complete' ? 'bg-emerald-500' : pipelineStage === 'error' ? 'bg-red-500' : 'bg-slate-500'}`}></div>
                <h3 className="text-sm font-bold">Pipeline Progress</h3>
              </div>
              <p className="text-[10px] text-[#9dabb9] italic font-medium uppercase">
                {isIndexing ? `Processing: ${sourceName}` : pipelineStage === 'complete' ? 'Last job completed' : pipelineStage === 'error' ? 'Last job failed' : 'No active jobs'}
              </p>
            </div>
            
            {/* Progress Bar */}
            <div className="mb-8">
              <div className="w-full h-2 bg-[#283039] rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all duration-500 ${pipelineStage === 'error' ? 'bg-red-500' : pipelineStage === 'complete' ? 'bg-emerald-500' : 'bg-primary'}`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex justify-between mt-2">
                <span className="text-[10px] text-[#9dabb9]">{progressPercent}%</span>
                <span className="text-[10px] text-[#9dabb9] capitalize">{pipelineStage === 'idle' ? 'Ready' : pipelineStage}</span>
              </div>
            </div>
            
            <div className="flex justify-between relative px-4">
               {/* Progress line */}
               <div className="absolute top-5 left-8 right-8 h-[2px] bg-[#283039] z-0">
                  <div 
                    className={`h-full transition-all duration-500 ${pipelineStage === 'error' ? 'bg-red-500' : pipelineStage === 'complete' ? 'bg-emerald-500' : 'bg-primary shadow-[0_0_8px_#FFB200]'}`}
                    style={{ width: `${progressPercent}%` }}
                  />
               </div>
               
               <ProgressStep 
                 icon="check_circle" 
                 label="Received" 
                 status={getStageStatus('received', pipelineStage)}
               />
               <ProgressStep 
                 icon="code" 
                 label="Parsing" 
                 status={getStageStatus('parsing', pipelineStage)}
               />
               <ProgressStep 
                 icon="content_cut" 
                 label="Chunking" 
                 status={getStageStatus('chunking', pipelineStage)}
               />
               <ProgressStep 
                 icon="auto_awesome" 
                 label="Embedding" 
                 status={getStageStatus('embedding', pipelineStage)}
               />
               <ProgressStep 
                 icon="database" 
                 label="Vector Upsert" 
                 status={getStageStatus('upserting', pipelineStage)}
               />
            </div>
          </div>

          {/* Activity Log */}
          <div className="bg-[#1b222a] border border-[#283039] rounded-xl overflow-hidden mb-10">
             <div className="px-6 py-4 border-b border-[#283039] flex justify-between items-center">
                <h3 className="text-sm font-bold">Recent Activity Log ({activityLogs.length})</h3>
                <div className="flex gap-4">
                   <button 
                     onClick={exportActivityLog} 
                     title="Export activity to CSV"
                     className="material-symbols-outlined text-slate-500 text-sm hover:text-white transition-colors"
                   >
                     download
                   </button>
                   {activityLogs.length > 0 && (
                     <button 
                       onClick={() => {
                         if(confirm('Clear all activity logs?')) {
                           clearActivityLogs();
                           showToast('Logs cleared', 'info');
                         }
                       }} 
                       title="Clear all logs"
                       className="material-symbols-outlined text-slate-500 text-sm hover:text-rose-500 transition-colors"
                     >
                       delete_sweep
                     </button>
                   )}
                </div>
             </div>
             {activityLogs.length > 0 ? (
               <table className="w-full text-left">
                  <thead className="bg-[#111418] text-[10px] text-[#9dabb9] uppercase font-black tracking-widest">
                     <tr>
                        <th className="px-6 py-3">Document</th>
                        <th className="px-6 py-3">Time</th>
                        <th className="px-6 py-3">Duration</th>
                        <th className="px-6 py-3">Chunks</th>
                        <th className="px-6 py-3">Status</th>
                     </tr>
                  </thead>
                  <tbody className="text-sm divide-y divide-[#283039]">
                     {activityLogs.map((log, idx) => (
                       <ActivityRow key={idx} {...log} />
                     ))}
                  </tbody>
               </table>
             ) : (
               <div className="p-12 text-center">
                 <span className="material-symbols-outlined text-4xl text-slate-600 mb-4">history</span>
                 <p className="text-sm text-[#9dabb9]">No activity yet. Index a document to see logs here.</p>
               </div>
             )}
          </div>
        </div>
      </div>
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: string; icon: string; highlight: boolean }> = ({ label, value, icon, highlight }) => (
  <div className={`bg-[#1b222a] border p-6 rounded-xl shadow-sm transition-all group cursor-default ${highlight ? 'border-primary/50 shadow-primary/10' : 'border-[#283039] hover:border-primary/40'}`}>
    <div className="flex justify-between items-start mb-4">
      <p className="text-xs font-bold text-[#9dabb9] uppercase tracking-wider">{label}</p>
      <span className={`material-symbols-outlined text-xl transition-transform group-hover:scale-110 ${highlight ? 'text-primary' : 'text-primary'}`}>{icon}</span>
    </div>
    <div className="flex items-end gap-3">
      <h3 className={`text-2xl font-black truncate ${highlight ? 'text-primary' : ''}`}>{value}</h3>
    </div>
  </div>
);

const ProgressStep: React.FC<{ icon: string; label: string; status: 'done' | 'active' | 'pending' }> = ({ icon, label, status }) => (
  <div className="flex flex-col items-center gap-3 relative z-10 w-1/5">
     <div className={`size-10 rounded-full flex items-center justify-center transition-all ${
       status === 'done' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 
       status === 'active' ? 'bg-primary text-white shadow-lg shadow-primary/40 animate-pulse' : 
       'bg-[#283039] text-slate-600'
     }`}>
        <span className={`material-symbols-outlined text-xl ${status === 'active' ? 'animate-spin' : ''}`}>
          {status === 'done' ? 'check' : status === 'active' ? 'progress_activity' : icon}
        </span>
     </div>
     <div className="text-center">
        <p className={`text-[11px] font-bold ${status === 'active' ? 'text-white' : status === 'done' ? 'text-[#9dabb9]' : 'text-slate-600'}`}>{label}</p>
        <p className={`text-[8px] font-black uppercase ${status === 'active' ? 'text-primary' : status === 'done' ? 'text-emerald-500' : 'text-slate-600'}`}>
          {status === 'done' ? 'COMPLETE' : status === 'active' ? 'IN PROGRESS' : 'PENDING'}
        </p>
     </div>
  </div>
);

const ActivityRow: React.FC<{ name: string; time: string; duration: string; status: 'SUCCESS' | 'FAILED'; icon: string; chunks?: number }> = ({ name, time, duration, status, icon, chunks }) => (
  <tr className="hover:bg-white/5 transition-colors cursor-pointer group">
    <td className="px-6 py-4">
       <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-slate-500 text-sm group-hover:text-primary transition-colors">{icon}</span>
          <span className="font-medium group-hover:text-white transition-colors truncate max-w-[200px]">{name}</span>
       </div>
    </td>
    <td className="px-6 py-4 text-slate-500">{time}</td>
    <td className="px-6 py-4 text-slate-500">{duration}</td>
    <td className="px-6 py-4 text-slate-500">{chunks || '-'}</td>
    <td className="px-6 py-4">
       <span className={`px-2 py-0.5 rounded text-[10px] font-black tracking-widest ${
         status === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'
       }`}>{status}</span>
    </td>
  </tr>
);

export default IndexingView;
