# RAG Assistant — Frontend (Phase 5 + 7)

Vite + React + TypeScript. Apple-inspired dual-theme UI with Framer Motion
animations throughout, real-time streaming answers, and a command palette.

## What's built

- **Animated hero** — first thing you see, transitions into the app
- **App shell** — collapsible sidebar (Chats / Documents tabs) + main chat panel, responsive down to mobile (sidebar becomes a slide-over)
- **Dual theme** — light/dark, respects system preference by default, persists your manual choice, zero flash-of-wrong-theme on load
- **Documents panel** — drag-and-drop upload, live animated status (processing → ready/failed), delete with confirm
- **Document scoping** — pick exactly which document(s) a conversation searches, right from the chat itself
- **Conversations** — create, switch, delete, auto-titled from the first question
- **Streaming chat** — answers appear token-by-token in real time (Server-Sent Events), with a phase-aware indicator ("Searching your documents" → live streaming text)
- **Markdown rendering** — headings, bold, lists, code blocks render properly, not as raw syntax
- **Command palette** (Cmd/Ctrl+K) — new conversation, jump to documents, toggle theme, fuzzy-search your conversation history
- **Skeleton loaders** — shimmer placeholders matching the actual content shape, not generic spinners
- **Living citations** (the signature piece) — `(Source 1)`, `(Source 2)` in answers become clickable badges that expand into a glass card showing the exact excerpt, full text on demand, chunk index, and relevance score. Cited vs. merely-retrieved sources are visually distinguished.
- **Visual texture** — subtle grain overlay, a real logo mark (also the favicon)
- Respects `prefers-reduced-motion` globally (via Framer Motion's `MotionConfig`, not just a CSS override)
- Keyboard focus visible everywhere, `aria-label`s on icon-only buttons

## Setup

This talks to your Phase 1-4 backend, so **that needs to be running first**.

```bash
# Terminal 1 - backend (from the server/ folder, same as before)
cd server
npm start

# Terminal 2 - frontend
cd client
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). The dev server proxies `/api/*` requests to `http://localhost:5000` automatically (configured in `vite.config.ts`) — you don't need to change any URLs or set a frontend `.env`, there are no API keys on this side at all.

## How to actually test it

1. Click **Enter the assistant** on the hero
2. Switch to the **Documents** tab in the sidebar, upload a file, watch the status animate from processing → ready
3. Switch to **Chats**, click **New conversation**
4. Ask a question — watch it stream in token-by-token, with "Searching your documents" showing briefly first
5. Click one of the numbered citation badges in the answer — watch it expand into the source card
6. Ask a follow-up question — this is testing Phase 3's conversation memory
7. Press **Cmd/Ctrl+K** — try searching for a conversation, or running "New conversation" from the palette
8. Toggle the theme (sun/moon icon, top of sidebar) — check both light and dark look right
9. Resize your browser narrow (or open on your phone via your local network IP) — sidebar should collapse into a slide-over menu

## What I verified before handing this off

- Full production build (`npm run build`) compiles clean — TypeScript strict mode, zero errors
- Lint (`npm run lint`) — zero errors (3 harmless warnings about a standard React context+hook pattern, not a real issue)
- Caught and fixed a real state-management bug during development: a component was calling a data hook independently instead of sharing context, which would have caused the UI to silently desync (delete a document and it wouldn't disappear from the visible list). Fixed by moving to proper Context Providers for documents and conversations before it could ship.
- Design tokens verified in actual compiled CSS output (not just visual assumption) — both light and dark values confirmed present
- **Streaming (Phase 7):** caught two real backend bugs while building this that would've made streaming silently hang — see the root README's Phase 7 section for the full story. Both fixed at the root, verified with hard-timeout curl tests specifically designed to distinguish "slow" from "actually broken."

## What I could NOT verify

I can't render pixels or take screenshots in my environment — everything above was checked structurally (compiles, types check, lint passes, tokens present in output), not visually. You're the first person to actually *see* this render. If spacing, contrast, animation timing, or anything visual feels off anywhere, tell me exactly what and I'll fix it directly — that kind of feedback is much more useful to me than "make it better."

## Known limitations

- No loading skeleton for the initial document/conversation list fetch — just a small spinner + text. Could upgrade to skeleton placeholders later if you want.
- The citation card popover uses Radix's default collision handling — on very narrow screens near the viewport edge it should reposition automatically, but hasn't been visually confirmed (see note above).
