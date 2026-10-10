-- Migration 009: Semantic answer cache
--
-- Backs services/answerCache.js. The actual similarity search happens in
-- Pinecone (a dedicated 'answer-cache' namespace, isolated from document
-- chunk vectors - see pinecone.js) - this table holds the full cached
-- payload (answer text + sources), keyed by the same UUID used as that
-- Pinecone vector's id. Pinecone tells us WHICH cached answer is the best
-- semantic match; this table is where we actually read that answer from.
--
-- Run this in the Supabase SQL editor, after migration_008.

create table if not exists answer_cache (
  id            uuid primary key default gen_random_uuid(),
  -- 'guest' for the shared guest pool, or a real user id - mirrors the
  -- exact same ownership boundary already used for document/conversation
  -- scoping elsewhere (see rag.js's gatherCandidates), so a cache hit can
  -- never cross from one owner's documents into another's.
  owner_key     text not null,
  -- Sorted, comma-joined documentIds the original question was scoped to,
  -- or the literal string 'ALL' for an unscoped question. Part of the
  -- lookup key alongside owner_key - see answerCache.js's buildDocSignature.
  doc_signature text not null,
  question      text not null,
  answer        text not null,
  sources       jsonb not null default '[]'::jsonb,
  hit_count     integer not null default 0,
  created_at    timestamptz not null default now(),
  last_hit_at   timestamptz not null default now()
);

-- Every cache read is "give me the row for this specific id" (the id
-- Pinecone's similarity search already found) - never a scan by
-- owner/scope directly, so no separate composite index is needed for
-- reads. This one only helps the (much rarer) manual/admin case of
-- inspecting or clearing one owner's cached entries by hand.
create index if not exists idx_answer_cache_owner_scope on answer_cache(owner_key, doc_signature);
