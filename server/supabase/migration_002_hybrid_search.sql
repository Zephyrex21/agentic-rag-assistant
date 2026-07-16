-- RAG Assistant - Phase 6 migration: hybrid search support
-- Run this in Supabase: Dashboard -> SQL Editor -> New Query -> paste -> Run
-- (This is IN ADDITION to schema.sql from Phase 3 - run schema.sql first if
-- you haven't already, this migration assumes the `documents` table exists.)

create table if not exists chunks (
  id            text primary key,  -- SAME id format as the Pinecone vector: {documentId}_chunk_{chunkIndex}
  document_id   uuid not null references documents(id) on delete cascade,
  filename      text not null,
  chunk_index   integer not null,
  section       text,
  text          text not null,
  -- Generated column: Postgres automatically maintains this as a searchable
  -- text-search vector whenever `text` changes. This is what full-text
  -- search actually queries against - see keywordSearch.js.
  text_search   tsvector generated always as (to_tsvector('english', text)) stored,
  created_at    timestamptz not null default now()
);

-- GIN index makes full-text search fast even as the table grows
create index if not exists idx_chunks_text_search on chunks using gin(text_search);
create index if not exists idx_chunks_document_id on chunks(document_id);

-- Same RLS note as schema.sql: intentionally off, this backend uses the
-- Supabase service_role key (server-side only), which bypasses RLS entirely.
