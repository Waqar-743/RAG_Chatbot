# Ragnarok — Grounded Intelligence

A Retrieval-Augmented Generation chatbot that answers from indexed documents and returns source citations.

[**Open the live application**](https://rag-chatbot-waqar.onrender.com) · [API documentation](https://rag-chatbot-api-waqar.onrender.com/docs) · [Backend health](https://rag-chatbot-api-waqar.onrender.com/api/v1/health)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Waqar-743/RAG_Chatbot)

## Production architecture

| Layer | Provider | Configuration |
| --- | --- | --- |
| Frontend | Render Static Site | `rag-chatbot-waqar` |
| Backend | Render Web Service | `rag-chatbot-api-waqar` |
| Vectors | Qdrant Cloud | `rag_documents` collection |
| Metadata | MongoDB Atlas | Optional; chat history and metadata only |
| Models | OpenRouter | Embeddings and chat completion |

Both Render services are declared in `render.yaml`. The frontend receives the backend URL through `VITE_API_URL`, and the backend allows the Render frontend through CORS. Pushes to `main` deploy after CI passes.

## Deploy on Render

Click the **Deploy to Render** button above for a one-click Blueprint deployment, or configure it manually:

1. Push this repository's `main` branch to GitHub.
2. In Render, choose **New → Blueprint** and connect `Waqar-743/RAG_Chatbot`.
3. Select the `main` branch and apply `render.yaml`.
4. Enter the prompted secrets:

   - `OPENROUTER_API_KEY`
   - `QDRANT_URL`
   - `QDRANT_API_KEY`

5. After both services are live, verify:

   - Backend health: `https://rag-chatbot-api-waqar.onrender.com/api/v1/health`
   - Backend docs: `https://rag-chatbot-api-waqar.onrender.com/docs`
   - Frontend: `https://rag-chatbot-waqar.onrender.com`

MongoDB is optional. Add a valid `MONGO_URI` to the backend's Render environment if persistent chat history and document metadata are required. Indexing and retrieval continue through Qdrant when MongoDB is unavailable.

Do not commit secrets. Local `.env` files are ignored by Git.

## Local development

```powershell
# Backend (Python 3.11+)
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python main.py

# Frontend (Node 20+)
Set-Location frontend
npm ci
npm run dev
```

The backend runs at `http://localhost:8000`. The Vite development server runs at `http://localhost:3000` and proxies `/api/*` to the backend.

## Environment variables

Backend variables are documented in `.env.example`. Production requires:

```env
OPENROUTER_API_KEY=...
QDRANT_URL=https://your-cluster.aws.cloud.qdrant.io
QDRANT_API_KEY=...
QDRANT_COLLECTION=rag_documents
```

The frontend uses:

```env
VITE_API_URL=https://rag-chatbot-api-waqar.onrender.com
```

## Data cleanup

The cleanup command deletes the configured Qdrant collection and clears the application's MongoDB collections when MongoDB is reachable:

```powershell
python scripts/clear_data.py --yes
```

This operation is destructive. The backend recreates the Qdrant collection on the next indexing or stats request.

## Testing

```powershell
pytest -v
Set-Location frontend
npm run build
```

## Project layout

```text
api/                 FastAPI routes and models
config/              Settings and logging
rag/                 Indexing, retrieval, and storage providers
frontend/            React, Vite, and Tailwind application
scripts/clear_data.py Destructive data cleanup utility
render.yaml          Render Blueprint for frontend and backend
Dockerfile           Backend production image
tests/                Pytest suite
```

## License

MIT
