# RAG Assistant — Phase 1-6 (Complete + Hybrid Retrieval)

Agentic RAG Knowledge Assistant — full stack, 6 phases:
- **Phase 1**: document ingestion (upload → extract → chunk → embed → store in Pinecone)
- **Phase 2**: retrieval + answer (ask a question, get a grounded answer with sources)
- **Phase 3**: conversations (multi-turn memory + Supabase persistence)
- **Phase 4**: richer citations (UI-ready source data — which sources were actually cited, full text)
- **Phase 5**: frontend (Vite + React, Apple-inspired dual-theme UI, Framer Motion animations, the "living citations" system)
- **Phase 6**: hybrid retrieval (vector + keyword search fused with RRF, LLM reranking, query rewriting for follow-ups, multi-key Gemini distribution)

This is the complete project. See `client/README.md` for frontend-specific details — this file covers the backend and overall setup.

⚠️ **Before running this version:** you need to run a new SQL migration in Supabase (`server/supabase/migration_002_hybrid_search.sql`) — see section 10 below. Skipping it doesn't break anything (keyword search just fails soft and falls back to vector-only), but you won't get the hybrid search benefit until it's run.

> **Note:** this originally used OpenAI for embeddings. Switched to **Gemini**
> (`gemini-embedding-001`) since it has a genuine free tier — no card, no
> $5 prepay. Small bonus: Gemini lets us tag embeddings as `RETRIEVAL_DOCUMENT`
> (for chunks) vs `RETRIEVAL_QUERY` (for the user's question in Phase 2),
> which actually improves retrieval quality over a one-size embedding.

---

## 1. What's actually built in this phase

- `POST /api/documents/upload` — accepts `.txt`, `.md`, `.pdf` (max 20MB), returns immediately with `status: "processing"` (async — doesn't block on embedding)
- `GET /api/documents/:id/status` — poll this to watch processing → ready/failed
- `GET /api/documents` — list everything uploaded
- `DELETE /api/documents/:id` — removes the doc's vectors from Pinecone + its metadata
- `POST /api/query` — **(Phase 2)** stateless single-turn Q&A, no memory — see section 6 below
- `POST /api/conversations` / `GET /api/conversations` / `GET /api/conversations/:id` / `POST /api/conversations/:id/messages` / `DELETE /api/conversations/:id` — **(Phase 3)** multi-turn conversations with real memory — see section 7 below
- **Structure-aware chunking** for Markdown (splits by `#`/`##`/`###` headers, tags each chunk with its section name — this is what makes citations meaningful)
- **Word-window chunking** (350 words, 50 word overlap — tunable via `.env`) for plain text and PDF-extracted text
- Document + conversation + message metadata now lives in **Supabase** (migrated in Phase 3 from the local JSON file used in Phase 1/2)

## 2. Setup

### Prerequisites
- Node.js 18+ (you're already set up for this from your other projects)
- A **free** Gemini API key (for embeddings + generation) — https://aistudio.google.com/apikey
  — ⚠️ this is a separate developer key from your Gemini Pro app subscription; the app subscription does NOT give you API access, this free key does
- A Pinecone account + index (free tier is fine) — https://app.pinecone.io
- A Supabase account + project (free tier is fine) — https://supabase.com

### Creating the Pinecone index
1. Sign up / log in at https://app.pinecone.io
2. Create a new index:
   - **Name:** `rag-assistant` (or whatever you want — just match it in `.env`)
   - **Dimensions:** `768` (this matches Gemini's `gemini-embedding-001` output at our configured size — must match exactly or upserts will fail)
   - **Metric:** `cosine`
3. Copy your API key from the Pinecone dashboard

### Setting up Supabase
1. Sign up / log in at https://supabase.com, create a new project (pick any region, free tier)
2. Once it's provisioned: **SQL Editor** (left sidebar) → **New Query**
3. Open `server/supabase/schema.sql` from this project, paste the whole thing in, click **Run**
   — this creates the `documents`, `conversations`, and `messages` tables
4. **Project Settings** (gear icon) → **API** → copy:
   - **Project URL** → this is your `SUPABASE_URL`
   - **service_role key** (NOT the `anon`/`public` key — scroll down, it's usually collapsed under "Reveal") → this is your `SUPABASE_SERVICE_ROLE_KEY`

   ⚠️ The service_role key bypasses all row-level security and has full table access. That's fine here because it only ever lives in this server's `.env` file, never in a frontend — but never paste it into client-side code later.

### Install & configure
```bash
cd server
npm install
cp .env.example .env
```

Now open `.env` and fill in:
```
GEMINI_API_KEY=...your free key from aistudio.google.com/apikey...
PINECONE_API_KEY=...your real key...
PINECONE_INDEX_NAME=rag-assistant   # must match the index name you created
SUPABASE_URL=...your project URL...
SUPABASE_SERVICE_ROLE_KEY=...your service_role key...
```

### Run it
```bash
npm start
```

You should see:
```
🚀 RAG Assistant server running on http://localhost:5000
   Health check: http://localhost:5000/health
```

## 3. How to test

### Step 0 — sanity check
```bash
curl http://localhost:5000/health
```
Should show `"geminiConfigured":true,"pineconeConfigured":true,"supabaseConfigured":true`. If any is `false`, double check your `.env`.

### Step 1 — run the chunking + prompt tests (no API keys needed)
These prove the core logic works correctly, independent of any external service:
```bash
npm run test:chunking
npm run test:prompt
```
You should see markdown chunks tagged with section names (Overview, Security Features, etc.), plain text chunks showing the overlapping word windows, and two example prompts (with and without conversation history) showing exactly what gets sent to Gemini. Worth actually reading through — this is what determines answer quality later.

### Step 2 — upload a real document
Grab one of your own files — a resume, a project README (Cryptex/WS Inspector/GST dashboard would be perfect demo content later) — and:
```bash
curl -X POST http://localhost:5000/api/documents/upload \
  -F "file=@/path/to/your/resume.pdf"
```
You'll get back:
```json
{"documentId": "...", "filename": "resume.pdf", "status": "processing"}
```

### Step 3 — poll status until it's ready
```bash
curl http://localhost:5000/api/documents/<documentId>/status
```
Run this a couple times a few seconds apart. It should go from `processing` → `ready` with a `chunkCount` > 0. If it goes to `failed`, the `error` field will tell you exactly why (wrong Pinecone dimension, bad API key, etc.).

### Step 4 — confirm it's listed
```bash
curl http://localhost:5000/api/documents
```

### Step 5 — check Pinecone directly (optional but satisfying)
Go to your Pinecone console → your index → you should see vectors matching your `chunkCount`. Click one and you'll see the metadata (`filename`, `section`, `text`) we attached — this is exactly what will power citations in Phase 4.

### Step 6 — delete it
```bash
curl -X DELETE http://localhost:5000/api/documents/<documentId>
```
Confirm the vectors disappeared from the Pinecone console too.

## 4. What I already tested on my end (before handing this to you)

So you're not the first line of defense for basic bugs:
- Server boots cleanly with and without API keys configured
- Full upload → async processing → status polling → list → delete flow (verified with placeholder/missing keys, which correctly fails fast with a clear error instead of hanging)
- Unsupported file type rejection (`.jpg` correctly rejected with `UNSUPPORTED_FILE_TYPE`)
- 404 handling for unknown document IDs and conversation IDs
- Markdown structure-aware chunking (section tags come through correctly, overlap windows work)
- Plain text word-window chunking (overlap verified)
- PDF text extraction (verified against a real-world multi-page PDF — note: a couple of PDFs generated by bare-bones tools like raw `fpdf2`/`reportlab` scripts threw an xref parsing error from the underlying `pdf-parse` library; this doesn't affect real-world PDFs — resumes, Word/Google Docs exports, LaTeX output — which is what you'll actually be uploading)
- Query validation (missing/empty question rejected on both `/api/query` and `/api/conversations/:id/messages`)
- Prompt construction for both single-turn and multi-turn (with conversation history) cases — printed and manually checked
- Citation extraction logic (Phase 4) — tested against 5 answer patterns: single citation, multiple, repeated/deduped, none, and unusual whitespace formatting
- Full regression pass after each phase - confirmed the server survives every error path (missing keys, bad requests, unknown IDs) without crashing, for all of documents/query/conversations routes together
- **Caught and fixed a real bug during this phase:** moving document storage to Supabase meant `documentStore.create()` could now throw (e.g. bad credentials), but the upload route wasn't wrapped in try/catch — an unhandled rejection was crashing the *entire server*, not just that one request. Fixed by wrapping every route handler properly, plus added a process-level safety net (`unhandledRejection` handler) so this class of bug can't take the whole server down again even if I miss a spot somewhere else.
- 0 npm vulnerabilities

What I could **not** test end-to-end here: actual Gemini/Pinecone/Supabase calls, since my sandbox can't reach those domains. That's on you to verify below — but every code path up to those external calls (validation, chunking, prompt construction, error handling) is solid and was verified with fast-fail tests (missing credentials → clean error, not a hang or crash).

## 5. Known limitations (by design, for this phase)

- No frontend yet
- Retrieval uses only the latest question's embedding (not the conversation history) — so a follow-up like "tell me more about that" will find the right *documents* only if the wording overlaps enough with what's already been discussed. The LLM sees the full conversation history when *generating* the answer (so it understands "that" contextually), but retrieval itself isn't history-aware yet. If this becomes a real problem in practice, the fix is query rewriting (using the LLM to expand a vague follow-up into a full standalone question before embedding it) — a reasonable future enhancement, not built here to keep this phase focused
- No auth (not needed until this is a deployed product) — anyone with your API URL can currently create/read/delete conversations and documents
- Row Level Security is off on the Supabase tables (server uses the service_role key, which bypasses it) — fine for a backend-only setup, revisit if a frontend ever talks to Supabase directly

## 6. Phase 2 — Retrieval + Answer (now included)

Phase 1 got documents *into* the system. Phase 2 adds the actual RAG query:

```
POST /api/query
Body: { "question": "your question", "documentIds": ["optional", "scope", "to", "specific", "docs"] }
```

**What it does under the hood:**
1. Embeds your question with Gemini (tagged `RETRIEVAL_QUERY` — different from how chunks are embedded, which is a real quality improvement over using one embedding type for everything)
2. Searches Pinecone for the most relevant chunks
3. If nothing relevant is found (below a similarity threshold), it says so honestly instead of guessing — and skips the LLM call entirely, saving your free quota
4. Otherwise, sends the retrieved chunks + your question to Gemini with strict grounding instructions (answer only from the sources, cite them inline, admit when it doesn't know)
5. Returns the answer plus a `sources` array so you can show "where this came from" in the UI later

**Response shape:**
```json
{
  "answer": "Cryptex includes rate limiting, CORS configuration... (Source 1)",
  "sources": [
    { "documentId": "...", "filename": "cryptex-readme.md", "section": "Security Features", "preview": "...", "relevanceScore": 0.82 }
  ],
  "queryId": "..."
}
```

### Testing Phase 2

**No API key needed:**
```bash
npm run test:prompt
```
Prints the exact prompt sent to Gemini — worth reading once to see how sources get formatted and how the grounding instructions work.

**With real API keys (after you've uploaded at least one document via Phase 1):**
```bash
curl -X POST http://localhost:5000/api/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What security features does this project have?"}'
```

Try asking something the documents *don't* cover too — you should get the honest "I don't have enough relevant information" response instead of a hallucinated answer. That's the retrieval threshold doing its job.

### New `.env` values (already in `.env.example`)
- `GENERATION_MODEL` — defaults to `gemini-2.5-flash`. Google's free-tier model lineup shifts fairly often — if you ever get a quota/availability error, just swap this value (try `gemini-3-flash-preview` or `gemini-2.5-flash-lite`) without touching any code.
- `RETRIEVAL_TOP_K` — how many chunks to retrieve (default 5)
- `MIN_RELEVANCE_SCORE` — similarity cutoff below which we don't bother the LLM (default 0.35 — lower it if you're getting too many "not enough information" responses, raise it if answers feel loosely related to your question)

## 7. Phase 3 — Conversations (now included)

Real multi-turn memory, persisted in Supabase instead of living only in a single request.

```
POST   /api/conversations                      → { conversationId, title }
GET    /api/conversations                       → { conversations: [{id, title, updatedAt}] }
GET    /api/conversations/:id                   → { id, title, messages: [...] }
POST   /api/conversations/:id/messages          Body: { question, documentIds? }
                                                  → { messageId, answer, sources }
DELETE /api/conversations/:id                    → { success: true }
```

**What's different from `/api/query`:** every question and answer gets saved as a message tied to the conversation. When you ask a follow-up, the last few messages (`CONVERSATION_HISTORY_TURNS`, default 6) get included in the prompt sent to Gemini — so "what about the second one?" actually resolves correctly instead of confusing the model. The conversation also auto-titles itself from your first question.

### Testing Phase 3

**Full flow:**
```bash
# 1. Start a conversation
curl -X POST http://localhost:5000/api/conversations

# copy the conversationId from the response, then:

# 2. Ask a question
curl -X POST http://localhost:5000/api/conversations/<conversationId>/messages \
  -H "Content-Type: application/json" \
  -d '{"question": "What security features does this project have?"}'

# 3. Ask a follow-up that only makes sense with context
curl -X POST http://localhost:5000/api/conversations/<conversationId>/messages \
  -H "Content-Type: application/json" \
  -d '{"question": "Which of those is most important?"}'

# 4. See the full thread
curl http://localhost:5000/api/conversations/<conversationId>

# 5. List all your conversations (check the title auto-generated correctly)
curl http://localhost:5000/api/conversations
```

You should notice: step 3's answer correctly understands "those" refers to the security features from step 2, without you having to repeat yourself. That's the whole point of this phase.

**In Postman:** same pattern as before — POST with raw JSON body for creating messages, GET for listing/reading. Save the `conversationId` from the create-conversation response as a Postman variable if you want to avoid retyping it into every request.

## 8. Phase 4 — Richer Citations (now included)

The `sources` array in every answer (from both `/api/query` and conversation messages) now looks like this:

```json
{
  "sourceNumber": 1,
  "cited": true,
  "documentId": "...",
  "filename": "cryptex-readme.md",
  "section": "Security Features",
  "excerpt": "The platform includes rate limiting to prevent abuse...",
  "fullText": "The platform includes rate limiting to prevent abuse, CORS configuration for safe cross-origin requests, magic-byte validation to verify file types beyond just extensions, and Zip Slip protection to prevent path traversal attacks during archive extraction.",
  "relevanceScore": 0.82
}
```

**What's new and why it matters for a UI:**
- `sourceNumber` — matches the `(Source 1)`, `(Source 2)` labels that appear inline in the answer text. A frontend can turn those into clickable badges without parsing anything itself.
- `cited` — `true` if the model actually referenced this source in its answer, `false` if it was retrieved (relevant enough to pass the threshold) but not directly used. Lets a UI show "3 sources used" prominently and "2 more considered" collapsed/secondary — more honest than treating every retrieved chunk as equally important.
- `fullText` — the complete chunk, not just a 200-character cutoff. `excerpt` is still there too, for a compact default view before the person clicks to expand.

### Testing Phase 4
No new endpoint — this is a response-shape upgrade to the existing `/api/query` and `/api/conversations/:id/messages` endpoints. Two ways to check it:

**No API key needed:**
```bash
npm run test:citations
```
Verifies the citation-parsing logic against several answer patterns (single citation, multiple, repeated, none, unusual spacing).

**With real keys:** ask a question like before, then look at the response — you should see `sourceNumber`, `cited`, `excerpt`, and `fullText` on every source. Ask something the documents *don't* cover and confirm `sources` comes back as an empty array (the honest "not enough info" path from Phase 2 is unaffected by this change).

## 9. Phase 5 — Frontend (now included)

The full UI lives in `client/`. Vite + React + TypeScript, Apple-inspired
dual-theme design, Framer Motion animations, and a "living citations" system
that turns `(Source 1)`/`(Source 2)` in answers into interactive cards using
exactly the data shape Phase 4 built.

**See `client/README.md` for the full breakdown, setup, and test walkthrough.**

Quick start (both pieces running together):
```bash
# Terminal 1
cd server && npm start

# Terminal 2
cd client && npm install && npm run dev
```
Then open the URL Vite prints (usually `http://localhost:5173`).

This is the complete 5-phase project.

## 10. Phase 6 — Hybrid Retrieval + Reranking (now included)

Every question now goes through a real retrieval pipeline instead of a single vector search:

```
question → [rewrite if follow-up] → vector search + keyword search (parallel)
         → RRF fusion → LLM reranking → answer generation
```

### Why this matters
Retrieval quality data is blunt about this: when RAG gives a bad answer, it's usually a **retrieval** failure, not a generation one — the right chunk never made it to the model. Pure vector search misses exact matches (product names, specific numbers); pure keyword search misses paraphrases. Fusing both, then having a model actually judge relevance instead of trusting a similarity score blindly, is the real fix.

### The three new pieces

**1. Query rewriting** (`services/queryRewriter.js`) — only fires when there's conversation history. Turns "what about the second one?" into a standalone question before embedding it, using the conversation to resolve what "it" refers to. Skipped entirely on first messages — zero extra cost for the common case.

**2. Hybrid search** — vector search (Pinecone, as before) runs alongside a new **keyword search** against a `chunks` table in Supabase (Postgres full-text search — no new infrastructure, no new cost). Both ranked lists get merged with **Reciprocal Rank Fusion** (`services/rrf.js`, pure function, unit tested): a chunk found by both methods outranks one that only won on a single method.

**3. Reranking** (`services/reranker.js`) — the fused candidates get one more pass where Gemini judges actual relevance to the question, not just similarity. This is a **single batched call** (numbered list in, numbered list out), not one call per candidate — output is just a few numbers, so it's genuinely cheap. This also replaced the old "not enough info" logic: instead of a raw similarity-score cutoff, we now trust the reranker's explicit judgment (falls back to the old threshold approach if reranking is disabled).

### Multi-key Gemini distribution
Three roles, each can have its own API key: `GEMINI_API_KEY_EMBEDDING`, `GEMINI_API_KEY_GENERATION`, `GEMINI_API_KEY_UTILITY`. Embeddings get called far more often than anything else (every chunk, every query) — giving it a dedicated key means it can't starve your main answer generation of quota. All three fall back to a single shared `GEMINI_API_KEY` if you don't set role-specific ones, so this is opt-in, not required. Check `GET /health` to confirm which roles are using dedicated vs. shared keys.

### Every stage is toggleable
`ENABLE_QUERY_REWRITE`, `ENABLE_HYBRID_SEARCH`, `ENABLE_RERANKING` in `.env` — flip any to `false` without touching code. Useful for comparing answer quality with/without a stage, or dialing back cost/latency if free-tier quota gets tight. With all three off, behavior matches Phase 2-4 exactly (pure vector search, similarity threshold).

### What I tested (all without needing real API keys)
- `npm run test:rrf` — verifies a chunk appearing in both result lists correctly outranks a single-list match, plus edge cases (empty input, single-list passthrough)
- `npm run test:reranker` — verifies the response parser handles malformed model output gracefully: no JSON found, out-of-range indices, `undefined` input — all fall back to unranked top-K instead of crashing
- Full boot + request-flow regression across all three route groups (documents/query/conversations), confirming the server survives every failure path with all Phase 6 toggles both on and off

### What you need to do
1. **Run the new SQL migration** — `server/supabase/migration_002_hybrid_search.sql` in your Supabase SQL Editor (same process as the Phase 3 schema)
2. Update `.env` — new variables are all in `.env.example`. At minimum you need `GEMINI_API_KEY` still set (multi-key is optional); everything else has sensible defaults
3. **Delete and re-upload your existing documents.** Chunks ingested before this phase only exist in Pinecone, not the new `chunks` table — they won't be found by keyword search until re-uploaded (vector search will still find them fine in the meantime, so nothing breaks, hybrid search just won't have anything to fuse for old documents)
4. Ask a question and check `/health` to confirm your key distribution and toggle states are what you expect

## 11. Bugfix — model deprecation resilience

**What happened:** Google began returning `404 "This model models/gemini-2.5-flash is no longer available"` for many developers on July 9, 2026 — ahead of their own officially announced October 2026 shutdown date. This wasn't a bug in our code; it was Google unilaterally cutting off a model early (confirmed by multiple reports on Google's own developer forum). It also affected `gemini-2.5-flash-lite`, which our utility calls (rewriting, reranking) were using too.

**Two-part fix:**

1. **Updated defaults** to `gemini-3.5-flash` (generation) and `gemini-3.1-flash-lite` (utility) — both current-generation, stable, free-tier models with no shutdown date announced as of this writing.

2. **Automatic fallback resilience** (`services/modelFallback.js`) — generation and utility calls now automatically retry with a fallback model (`GENERATION_MODEL_FALLBACK`, `UTILITY_MODEL_FALLBACK` in `.env`) if the primary model becomes unavailable. You'll see a warning in your server logs when this triggers, but the request itself still succeeds instead of failing. This is meant to survive the *next* time Google rotates a model, not just this one incident.

   **Deliberately excluded:** embeddings do NOT get automatic fallback. A different embedding model can produce a different vector dimensionality, which would silently corrupt your Pinecone index rather than degrade gracefully — a clear, diagnosable error is the safer failure mode there.

3. **Bonus fix, same root cause:** Gemini's SDK sometimes throws with the raw JSON error body as the message (exactly what you saw rendered in the chat UI — `{"error":{"code":404,...}}`). All model-calling services now parse that into the actual human-readable message underneath, so errors show up clean in the UI instead of raw JSON.

**Tested against your exact error** — `npm run test:modelfallback` includes the literal error string from the screenshot as a test case, plus edge cases (transient errors like rate limits correctly do NOT trigger a fallback retry, only genuine "model unavailable" errors do).

No `.env` changes are required for this fix to work — the new model defaults just work if you update to this version. Setting `GENERATION_MODEL_FALLBACK`/`UTILITY_MODEL_FALLBACK` explicitly is optional (they already have sensible defaults).

### Round 2 — the fallback didn't actually trigger, here's why

If you already had a `.env` file from before this fix, you likely still saw the exact same error after updating the code. Two compounding causes, both now fixed:

1. **`.env` is yours, not ours** — re-downloading the project doesn't touch your existing `.env` file (that's the whole point of gitignoring it). If your `.env` still had `GENERATION_MODEL=gemini-2.5-flash` explicitly set from before, that value overrides our new code default entirely.

2. **The fallback default was ALSO broken** — I initially set `GENERATION_MODEL_FALLBACK` to default to `gemini-2.5-flash` too. Since your `.env` pinned the primary to that exact same value, primary and fallback ended up identical — the fallback logic correctly refuses to "fall back" to the identical broken model (there'd be no point), so it just threw the clean error and stopped there. Compounding this: `gemini-2.5-flash-lite` (the utility fallback default) was **also** affected by the same Google cutoff, per the same developer forum thread — so that fallback chain was broken too.

**The actual fix:** fallback defaults now **cross-pair two independent, currently-stable models** instead of ever pointing at the unstable 2.5 line —
`gemini-3.5-flash` ↔ `gemini-3.1-flash-lite`, each acting as the other's fallback. Neither depends on the models that have been having issues.

**Also added:** a startup check (`checkForProblematicModels`) that scans your configured models against a known-problematic list and **warns immediately in your server logs and in `GET /health`** if anything matches — so a stale `.env` gets caught the moment you start the server, not after a failed request three steps into using the app.

**What you need to do:** open your actual `.env` file (not just `.env.example`) and check `GENERATION_MODEL` / `UTILITY_MODEL` / their `_FALLBACK` counterparts. If any are missing entirely, that's fine — the code defaults apply. If any explicitly say `gemini-2.5-flash` or `gemini-2.5-flash-lite`, either delete that line or update it to match `.env.example`. Restart the server and check the startup log — it'll tell you immediately if anything's still misconfigured.

## 12. Bugfix — slow responses and truncated answers (thinking tokens)

**What was happening:** answers were slow to generate, and sometimes cut off mid-sentence with a noticeably short response for questions that should've had a full answer.

**Root cause:** Gemini's newer models (`gemini-3.5-flash`, `gemini-3.1-flash-lite`, and `gemini-2.5.x`) are "thinking" models — they spend tokens on invisible internal reasoning *before* writing the visible response. Those thinking tokens count against the **same** `maxOutputTokens` budget as the answer itself. Our budgets were sized for the visible output only (1024 for answers, 100-150 for rewrite/rerank) with no headroom for thinking — so thinking would eat most or all of the budget, and generation would stop (`finishReason: MAX_TOKENS`) with little or nothing left for the actual answer. This also explains the slowness: generating invisible reasoning tokens still takes real time across all four Gemini calls in the pipeline (rewrite → embed → rerank → generate), even though you never see them.

**The fix** (`services/thinkingConfig.js`): every generation call now explicitly minimizes thinking, since none of our tasks (query rewriting, reranking, grounded answer generation from already-retrieved sources) benefit from deep multi-step reasoning:
- `gemini-2.5.x` models: `thinkingBudget: 0` — fully disables thinking
- `gemini-3.x` models: `thinkingLevel: 'MINIMAL'` — the lowest available (Gemini 3 can't fully disable thinking), plus **768 extra tokens of headroom** added automatically to `maxOutputTokens`, since even MINIMAL can still consume a few hundred tokens of invisible reasoning
- Bonus fix, same investigation: Gemini's own migration guidance says not to set `temperature`/`top_p`/`top_k` for Gemini 3.x models ("reasoning capabilities are optimized for the default settings") — this is now handled automatically too, per model family

This required knowing which model was actually being called at request time (not just the configured default), since `withModelFallback` can invoke either the primary or fallback model, and gemini-2.5.x and gemini-3.x need different, incompatible config fields for the same thing.

**Tested:** `npm run test:thinking` verifies the correct config gets selected for every model in our fallback chains, that headroom is only added where actually needed (not for 2.5.x, where thinking is fully disabled anyway), and that the consolidated config builder produces the exact right shape for each model family.

**Expected result after this fix:** noticeably faster responses (no more wasted invisible reasoning across 4 sequential calls) and complete, non-truncated answers.

## 13. Phase 7 — Streaming + Premium UI (now included)

A substantial upgrade: real token-by-token streaming (backend + frontend), proper markdown rendering, a command palette, skeleton loaders, and visual polish (grain texture, a real logo mark).

### Markdown rendering (bug fix)
Answers previously rendered raw markdown syntax literally (`### Heading`, `**bold**` showing as-is instead of being formatted). Messages now render through `react-markdown` + `remark-gfm` with custom styled components matching the design system. Citations still work — `(Source N)` gets transformed into a special-scheme markdown link before rendering, then intercepted by a custom link component and swapped for the interactive citation badge, so markdown formatting and citations coexist instead of conflicting.

### Streaming responses
Answers now appear token-by-token instead of arriving as one blob after a wait. This touched both sides:

- **Backend**: `generateAnswerStream` in `services/llm.js` uses Gemini's `generateContentStream`. `services/rag.js` was refactored so retrieval (rewrite → search → fuse → rerank) is shared between the streaming and non-streaming paths — only the final generation call actually streams. `/api/query` and `/api/conversations/:id/messages` now respond via Server-Sent Events: a `sources` event as soon as retrieval completes, repeated `chunk` events as text arrives, and a final `done` event with the complete answer and citation-accurate sources.
- **Frontend**: a small hand-rolled SSE parser in `lib/api.ts` (reads the fetch response body as a stream, no extra library needed) drives live UI updates as chunks arrive — `ConversationsContext` updates the in-progress message's content on every chunk, so React re-renders it streaming in real time.

**Two real bugs found while building this** (both fixed, not worked around):
1. **Silent hang with zero bytes received**: initially suspected Node's Nagle's algorithm buffering small writes (fixed via `socket.setNoDelay(true)`, kept as a real fix regardless), but the actual root cause was listening on the wrong event — `req.on('close')` fires as soon as the small request *body* finishes being read (nearly instant for a small JSON payload), not when the client actually disconnects. Switched to `res.on('close')`, which correctly fires only on a genuine client disconnect. Caught via careful manual testing with a hard-timeout curl command specifically because the initial "it's probably just slow" assumption was checked against actual behavior instead of assumed.
2. Auto-scroll didn't trigger during streaming, since the message *count* doesn't change while text streams in — only a message's `content` does. Fixed by adding the last message's content length to the scroll effect's dependencies.

### Command palette (Cmd/Ctrl+K)
Built with `cmdk` (the library Linear/Vercel/Raycast use for this exact pattern) + Radix Dialog for the modal/focus trap. Quick actions (new conversation, jump to documents, toggle theme) plus fuzzy search across your conversation history. Discoverable via a small `⌘K` hint in the sidebar header.

### Skeleton loaders
Replaced plain "Loading..." spinner text with shimmer skeleton placeholders (`components/ui/Skeleton.tsx`) that mimic the actual shape of what's loading — document rows, conversation rows, message bubbles.

### Visual polish
- Subtle grain/noise texture overlay across the whole app (SVG `feTurbulence`, ~2.5% opacity) — a small detail that reads as "premium paper texture" rather than a visible artifact
- A real logo mark (`components/LogoMark.tsx`) replacing the plain text wordmark, built from a quotation-mark motif since citations are the app's whole signature element — also now the favicon
- Refined "thinking" indicator — the generic 3-dot bounce was replaced with a phase-aware indicator that shows "Searching your documents" during retrieval, then transitions directly into the actual streaming text once generation starts (no separate typing indicator needed anymore)

### Testing
- Full client build + lint clean throughout (checked after every meaningful change, not just at the end)
- Full backend test suite (all 7 standalone suites) re-verified after the `rag.js` refactor
- SSE endpoints specifically tested with hard-timeout curl commands to distinguish "slow" from "actually hung" — this is what caught both real bugs above
- Full route regression (documents/query/conversations) confirming the server survives every failure path with the new streaming code in place

### What you need to do
Nothing new in `.env` — this phase is entirely code-level. Just re-download and run as usual. `npm install` in `client/` will pick up the new dependencies (`react-markdown`, `remark-gfm`, `cmdk`).

## 14. Bugfix — broad questions ("what is this about?") sometimes got a false "not enough info"

**What was happening:** asking a scoped, well-formed question like "what is this document about?" against a document that clearly had relevant content sometimes returned "I don't have enough relevant information," even though the answer was obviously right there.

**Root cause:** the reranker's own instructions were too strict for this class of question. Its prompt asked it to only keep passages "genuinely useful for answering it, not just topically related" — reasonable for a specific question, but for a broad overview question like "what is this about," no *single* passage fully "answers" it in that narrow sense, even though the document obviously has relevant content spread across several passages. A stricter reranker judgment could reasonably reject everything. On top of that, the pipeline treated an empty rerank result as final and absolute — one overly cautious judgment call was enough to produce a confident-sounding "I don't know," with no safety net.

**The fix, two parts:**
1. **Better reranker instructions** (`services/reranker.js`) — the prompt now explicitly tells the model that broad/overview-style questions ("what is this about," "summarize this," "what does this cover") are answered by *combining* multiple passages, and to include any passage describing the subject's purpose or features, not just passages that narrowly and completely answer the question on their own.
2. **A rescue safety net** (`services/rag.js`) — if the reranker still rejects every candidate, the pipeline now checks whether retrieval itself found a reasonably strong match (`RERANK_RESCUE_THRESHOLD` in `.env`, lenient by design) before giving up. If retrieval clearly found *something*, it rescues with the unranked top-K instead of trusting one strict judgment call as final. A true "not enough info" now requires *both* retrieval and reranking to agree nothing relevant exists, not just reranking alone.

**Tested:** `npm run test:reranker` now includes a regression check confirming the broad-question guidance is actually present in the prompt sent to the model, so this can't silently regress. The rescue-threshold logic itself reuses `normalizeRrfScore`, which already has dedicated test coverage in `test:rrf`.

**What you need to do:** nothing required — the new `RERANK_RESCUE_THRESHOLD` has a sensible default (`0.15`) already applied. Re-download and run as usual.
