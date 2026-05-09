import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useToast } from '../context/GlobalContext';

type NodeId = 'frontend' | 'backend' | 'engine' | 'services' | 'persistence';
const DIMS: Record<NodeId, { w: number; h: number }> = {
  frontend:    { w: 240, h: 140 },
  backend:     { w: 240, h: 140 },
  engine:      { w: 290, h: 190 },
  services:    { w: 290, h: 130 },
  persistence: { w: 290, h: 150 },
};

const ArchitectureView: React.FC = () => {
  const { showToast } = useToast();
  const constraintsRef = useRef<HTMLDivElement>(null);

  const [nodes, setNodes] = useState<Record<NodeId, { x: number; y: number }>>({
    frontend:    { x: 40,  y: 280 },
    backend:     { x: 340, y: 280 },
    engine:      { x: 640, y: 270 },
    services:    { x: 640, y: 50 },
    persistence: { x: 640, y: 510 },
  });

  const drag = (id: NodeId, info: { delta: { x: number; y: number } }) =>
    setNodes(p => ({ ...p, [id]: { x: p[id].x + info.delta.x, y: p[id].y + info.delta.y } }));

  const anchor = (id: NodeId, side: 'left' | 'right' | 'top' | 'bottom') => {
    const n = nodes[id], { w, h } = DIMS[id];
    if (side === 'left')   return { x: n.x,         y: n.y + h / 2 };
    if (side === 'right')  return { x: n.x + w,     y: n.y + h / 2 };
    if (side === 'top')    return { x: n.x + w / 2, y: n.y };
    return                       { x: n.x + w / 2, y: n.y + h };
  };

  const copyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    showToast('Blueprint URL copied', 'success');
  };

  return (
    <div className="px-4 md:px-8 pb-24 max-w-7xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16, filter: 'blur(6px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0)' }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="mb-12 flex flex-col md:flex-row md:items-end md:justify-between gap-6"
      >
        <div>
          <span className="eyebrow">System Topology</span>
          <h1 className="heading-xl mt-5">
            How it <em>thinks</em>.
          </h1>
          <p className="mt-5 text-chalk-dim text-base max-w-xl leading-relaxed">
            A live, draggable blueprint of the retrieval pipeline — frontend, API, engine, models, persistence.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={copyLink} className="btn-ghost">
            Share blueprint
            <span className="icon-island"><i className="ph-link-simple text-[13px]" /></span>
          </button>
        </div>
      </motion.div>

      {/* Blueprint canvas */}
      <div className="bezel-shell mb-12">
        <div className="bezel-core overflow-hidden">
          <div
            ref={constraintsRef}
            className="relative w-full min-w-[1000px] h-[720px]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(201,184,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(201,184,255,0.04) 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
          >
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-0">
              <defs>
                <marker id="arr-acc" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#C9B8FF" fillOpacity="0.7" />
                </marker>
                <marker id="arr-mint" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#A7F3D0" fillOpacity="0.7" />
                </marker>
              </defs>
              <Connector start={anchor('frontend', 'right')} end={anchor('backend', 'left')}    label="REST"   color="#C9B8FF" />
              <Connector start={anchor('backend', 'right')}  end={anchor('engine', 'left')}     label="Async"  color="#C9B8FF" />
              <Connector start={anchor('engine', 'top')}     end={anchor('services', 'bottom')} label="HTTPS"  color="#A7F3D0" />
              <Connector start={anchor('engine', 'bottom')}  end={anchor('persistence', 'top')}                color="#A7F3D0" />
            </svg>

            {/* Legend */}
            <div className="absolute bottom-5 left-5 z-20 pointer-events-none flex items-center gap-4 px-4 py-2 rounded-full bg-ink-900/70 border border-white/[0.06] backdrop-blur-md">
              <Legend color="#C9B8FF" label="Core" />
              <span className="size-1 rounded-full bg-white/10" />
              <Legend color="#A7F3D0" label="Managed" />
            </div>

            <Draggable id="frontend" pos={nodes.frontend} onDrag={i => drag('frontend', i)} c={constraintsRef}>
              <NodeCard icon="ph-browser" title="Frontend" subtitle="React · Vite · TS"
                        desc="Chat surface, indexing console, draggable blueprint."
                        tone="core" w={DIMS.frontend.w}
                        onClick={() => showToast('React 18 + TypeScript + Tailwind', 'info')} />
            </Draggable>

            <Draggable id="backend" pos={nodes.backend} onDrag={i => drag('backend', i)} c={constraintsRef}>
              <NodeCard icon="ph-cloud" title="Backend" subtitle="FastAPI · Uvicorn"
                        desc="Routing, validation, sessions, file extraction."
                        tone="core" w={DIMS.backend.w}
                        onClick={() => showToast('FastAPI + Uvicorn', 'success')} />
            </Draggable>

            <Draggable id="engine" pos={nodes.engine} onDrag={i => drag('engine', i)} c={constraintsRef}>
              <div onClick={() => showToast('LlamaIndex + custom RAG pipeline', 'info')}
                   className="bezel-shell cursor-pointer" style={{ width: DIMS.engine.w }}>
                <div className="bezel-core p-5 ring-1 ring-accent/30">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="size-11 rounded-xl bg-accent/30 border border-accent/55 flex items-center justify-center text-accent shadow-[0_0_24px_rgba(201,184,255,0.35)]">
                      <i className="ph-graph text-[22px]" />
                    </div>
                    <div>
                      <h3 className="text-[14px] font-medium tracking-tight text-chalk">RAG Engine</h3>
                      <p className="text-[10px] tracking-[0.2em] uppercase text-chalk-mute">LlamaIndex 0.10+</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Pip icon="ph-magnifying-glass" label="Hybrid retrieval" />
                    <Pip icon="ph-list-magnifying-glass" label="MMR rerank · HyDE" />
                  </div>
                </div>
              </div>
            </Draggable>

            <Draggable id="services" pos={nodes.services} onDrag={i => drag('services', i)} c={constraintsRef}>
              <NodeCard icon="ph-lightning" title="Models" subtitle="OpenRouter"
                        desc="DeepSeek (reasoning) · text-embedding-3-small (1536d)."
                        tone="managed" w={DIMS.services.w}
                        onClick={() => showToast('OpenRouter · DeepSeek + OpenAI embeddings', 'success')} />
            </Draggable>

            <Draggable id="persistence" pos={nodes.persistence} onDrag={i => drag('persistence', i)} c={constraintsRef}>
              <div onClick={() => showToast('Qdrant Cloud + MongoDB Atlas', 'success')}
                   className="bezel-shell cursor-pointer" style={{ width: DIMS.persistence.w }}>
                <div className="bezel-core p-5 ring-1 ring-accent-mint/30">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="size-10 rounded-xl bg-accent-mint/25 border border-accent-mint/50 flex items-center justify-center text-accent-mint shadow-[0_0_16px_rgba(167,243,208,0.2)]">
                      <i className="ph-database text-[18px]" />
                    </div>
                    <h3 className="text-[14px] font-medium tracking-tight text-chalk">Persistence</h3>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <MiniTile label="Vectors" value="Qdrant" />
                    <MiniTile label="Metadata" value="MongoDB" />
                  </div>
                </div>
              </div>
            </Draggable>
          </div>
        </div>
      </div>

      {/* Spec cards */}
      <div className="mb-6">
        <span className="eyebrow">Component spec</span>
        <h2 className="text-[28px] md:text-[34px] font-medium tracking-editorial mt-4 mb-8 text-chalk">
          Stack, end to end.
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <SpecCard icon="ph-browser" eyebrow="Surface" title="UI & access" tone="accent"
                    points={[
                      { l: 'React 18 + TypeScript', d: 'Reactive UI with Framer Motion micro-interactions.' },
                      { l: 'FastAPI', d: 'Auto-OpenAPI, async file extraction, streaming.' },
                    ]} />
          <SpecCard icon="ph-sparkle" eyebrow="Cognition" title="Intelligence" tone="accent"
                    points={[
                      { l: 'DeepSeek via OpenRouter', d: 'High-quality reasoning at low latency.' },
                      { l: 'text-embedding-3-small', d: '1536-dim semantic vectors.' },
                    ]} />
          <SpecCard icon="ph-database" eyebrow="Memory" title="Storage" tone="mint"
                    points={[
                      { l: 'Qdrant Cloud', d: 'HNSW vector search · cosine.' },
                      { l: 'MongoDB Atlas', d: 'Document metadata, sessions, chat history.' },
                    ]} />
        </div>
      </div>
    </div>
  );
};

const Draggable: React.FC<{ id: string; pos: { x: number; y: number }; onDrag: (i: { delta: { x: number; y: number } }) => void; c: React.RefObject<HTMLDivElement>; children: React.ReactNode }> =
  ({ pos, onDrag, c, children }) => (
  <motion.div
    drag dragMomentum={false} dragConstraints={c}
    onDrag={(_, info) => onDrag({ delta: { x: info.delta.x, y: info.delta.y } })}
    style={{ x: pos.x, y: pos.y, position: 'absolute' }}
    whileDrag={{ zIndex: 30, scale: 1.02 }}
    className="cursor-grab select-none active:cursor-grabbing"
  >
    {children}
  </motion.div>
);

const Connector: React.FC<{ start: { x: number; y: number }; end: { x: number; y: number }; label?: string; color: string }> =
  ({ start, end, label, color }) => {
  const mx = (start.x + end.x) / 2, my = (start.y + end.y) / 2;
  return (
    <g>
      <path d={`M ${start.x} ${start.y} L ${end.x} ${end.y}`}
            stroke={color} strokeWidth="1.5" strokeDasharray="5 4" fill="none" opacity="0.45"
            markerEnd={`url(#${color === '#A7F3D0' ? 'arr-mint' : 'arr-acc'})`} />
      {label && (
        <foreignObject x={mx - 36} y={my - 12} width="72" height="24">
          <div className="flex items-center justify-center px-2 py-1 rounded-full bg-ink-900/80 border border-white/[0.07] backdrop-blur-md">
            <span className="text-[9px] font-mono tracking-[0.15em] uppercase" style={{ color }}>{label}</span>
          </div>
        </foreignObject>
      )}
    </g>
  );
};

const NodeCard: React.FC<{ icon: string; title: string; subtitle: string; desc: string; tone: 'core' | 'managed'; w: number; onClick?: () => void }> =
  ({ icon, title, subtitle, desc, tone, w, onClick }) => (
  <div onClick={onClick} className="bezel-shell cursor-pointer transition-transform duration-700 ease-spring hover:scale-[1.01]" style={{ width: w }}>
    <div className={`bezel-core p-5 ${tone === 'managed' ? 'ring-1 ring-accent-mint/30' : ''}`}>
      <div className="flex items-center gap-3 mb-3">
        <div className={`size-10 rounded-xl flex items-center justify-center border ${
          tone === 'core'
            ? 'bg-accent/25 border-accent/50 text-accent shadow-[0_0_16px_rgba(201,184,255,0.2)]'
            : 'bg-accent-mint/20 border-accent-mint/50 text-accent-mint shadow-[0_0_16px_rgba(167,243,208,0.15)]'
        }`}>
          <i className={`${icon} text-[18px]`} />
        </div>
        <div>
          <h3 className="text-[13px] font-medium tracking-tight text-chalk">{title}</h3>
          <p className="text-[10px] tracking-[0.2em] uppercase text-chalk-mute">{subtitle}</p>
        </div>
      </div>
      <p className="text-[11px] text-chalk-dim leading-relaxed">{desc}</p>
    </div>
  </div>
);

const Pip: React.FC<{ icon: string; label: string }> = ({ icon, label }) => (
  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.08] border border-white/[0.12]">
    <i className={`${icon} text-[12px] text-accent`} />
    <span className="text-[11px] text-chalk tracking-tight">{label}</span>
  </div>
);

const MiniTile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl bg-white/[0.08] border border-white/[0.14] p-3 text-center">
    <p className="text-[9px] tracking-[0.2em] uppercase text-chalk-mute">{label}</p>
    <p className="text-[12px] font-medium text-chalk mt-1">{value}</p>
  </div>
);

const Legend: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <div className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-chalk-dim font-medium">
    <span className="size-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
    {label}
  </div>
);

const SpecCard: React.FC<{ icon: string; eyebrow: string; title: string; tone: 'accent' | 'mint'; points: { l: string; d: string }[] }> =
  ({ icon, eyebrow, title, tone, points }) => (
  <div className="bezel-shell">
    <div className="bezel-core p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className={`size-10 rounded-xl flex items-center justify-center border ${
          tone === 'accent'
            ? 'bg-accent/25 border-accent/50 text-accent shadow-[0_0_16px_rgba(201,184,255,0.2)]'
            : 'bg-accent-mint/20 border-accent-mint/50 text-accent-mint shadow-[0_0_16px_rgba(167,243,208,0.15)]'
        }`}>
          <i className={`${icon} text-[18px]`} />
        </div>
        <div>
          <p className="text-[10px] tracking-[0.25em] uppercase text-chalk-mute font-medium">{eyebrow}</p>
          <h4 className="text-[18px] font-medium tracking-tightest text-chalk">{title}</h4>
        </div>
      </div>
      <div className="space-y-5">
        {points.map((p, i) => (
          <div key={i} className={`pl-4 border-l ${tone === 'accent' ? 'border-accent/40' : 'border-accent-mint/40'}`}>
            <p className="text-[13px] font-medium text-chalk mb-1 tracking-tight">{p.l}</p>
            <p className="text-[11px] text-chalk-mute leading-relaxed">{p.d}</p>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default ArchitectureView;
