-- RAG Assistant - migration: pipeline observability trace
-- Run this in Supabase: Dashboard -> SQL Editor -> New Query -> paste -> Run
-- (Run after schema.sql, migration_002_hybrid_search.sql, and migration_003_self_verification.sql)

alter table messages
  add column if not exists pipeline_trace jsonb;

-- Stores a stage-by-stage record of what the retrieval/generation pipeline
-- actually did for this message (query rewrite, expansion, retrieval,
-- dedup, reranking, generation, verification - each with timing and a few
-- representative details, NOT full chunk text) - see traceBuilder.js for
-- the exact shape. Nullable: only populated when ENABLE_PIPELINE_TRACE is
-- on, and only assistant messages ever have one (see conversations.js).
