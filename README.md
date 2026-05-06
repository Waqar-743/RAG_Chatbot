# Ragnarok — Grounded Intelligence

A production-grade Retrieval-Augmented Generation (RAG) chatbot.
Ask questions, get answers cited from **your** indexed documents — not the open web.

> **Stack:** FastAPI · LlamaIndex · Qdrant · MongoDB · React 18 + Vite + Tailwind · DeepSeek (OpenRouter)

---

## Features

- **Cited answers** — every response traces back to source chunks with similarity scores
- **Drag-to-index** — drop a PDF, DOCX, MD, or TXT and the pipeline runs end-to-end
- **URL ingestion** — paste a link in chat and Ragnarok fetches + indexes inline
- **Voice input** — Web Speech API for hands-free queries
- **Live blueprint** — interactive, draggable system topology
- **Premium UI** — Geist + Instrument Serif, double-bezel components, mesh-gradient backdrop

---

## One-shot deploy (free tier, ~6 min)

The stack splits across three free services:

| Layer    | Provider          | Free tier      |
|----------|-------------------|----------------|
| Frontend | Vercel            | unlimited      |
| Backend  | Render            | 750 hr/mo      |
| Vectors  | Qdrant Cloud      | 1 GB           |
| Metadata | MongoDB Atlas     | 512 MB (M0)    |
| Models   | OpenRouter        | pay-per-call   |

### Step 1 — Provision the data plane (one-time, ~3 min)

1. **Qdrant Cloud** → https://cloud.qdrant.io → free cluster → copy `URL` + `API key`
2. **MongoDB Atlas** → https://cloud.mongodb.com → M0 cluster → "Connect" → connection string (whitelist `0.0.0.0/0`)
3. **OpenRouter** → https://openrouter.ai/keys → API key

### Step 2 — Push & deploy

```bash
# From the project root:
git init
git add .
git commit -m "Ragnarok initial deploy"
gh repo create ragnarok --public --source=. --remote=origin --push

# Backend → Render (uses render.yaml automatically)
# Open this URL, click "Deploy", paste secrets when prompted:
#   https://render.com/deploy?repo=https://github.com/<you>/ragnarok

# Frontend → Vercel (one command from /frontend)
cd frontend
npx vercel --prod
# In the Vercel dashboard, set:
#   VITE_API_URL = https://ragnarok-api.onrender.com   (your Render URL)
# then redeploy.
```

That's it — Vercel returns a live URL on completion.

> **No `gh` CLI?** Install with `winget install GitHub.cli` (Windows) or `brew install gh` (macOS), then `gh auth login`. Alternatively create the repo manually on github.com and `git remote add origin <url>`.

---

## Local development

```bash
# Backend (Python 3.11+)
python -m venv venv
.\venv\Scripts\Activate.ps1                # PowerShell
# source venv/bin/activate                 # macOS / Linux
pip install -r requirements.txt
copy .env.example .env                     # fill in secrets
python main.py                             # → http://localhost:8000

# Frontend (Node 18+)
cd frontend
npm install
npm run dev                                # → http://localhost:3000
```

The Vite dev server proxies `/api/*` → `localhost:8000` automatically.

### Local stack via Docker (optional)

```bash
docker-compose up -d                       # spins up Qdrant + Mongo locally
```

---

## Project layout

```
ragnarok/
├── api/                  # FastAPI routes & Pydantic models
├── rag/                  # Indexer, retriever, prompt orchestration
├── config/               # Settings + structured logging
├── frontend/             # React 18 + Vite + Tailwind
│   ├── src/views/        # ChatView · IndexingView · ArchitectureView
│   └── vercel.json       # Vercel config
├── tests/                # pytest suites
├── render.yaml           # Render Blueprint (backend)
├── Dockerfile            # Backend container
└── docker-compose.yml    # Local Qdrant + Mongo
```

---

## Environment variables

See `.env.example` for the full list. Required:

```env
OPENROUTER_API_KEY=sk-or-v1-…
QDRANT_URL=https://xxx.cloud.qdrant.io:6333
QDRANT_API_KEY=…
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/
LLM_MODEL=deepseek/deepseek-chat
EMBEDDING_MODEL=text-embedding-3-small
```

Frontend (Vercel dashboard or `frontend/.env.local`):

```env
VITE_API_URL=https://ragnarok-api.onrender.com
```

---

## Testing

```bash
pytest -v                                  # all suites
pytest tests/test_retrieval.py             # retrieval only
```

---

## License

MIT.
