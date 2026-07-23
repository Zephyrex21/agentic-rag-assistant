-- RAG Assistant - migration: self-verification tracking
-- Run this in Supabase: Dashboard -> SQL Editor -> New Query -> paste -> Run
-- (Run after schema.sql and migration_002_hybrid_search.sql)

alter table messages
  add column if not exists verified boolean,
  add column if not exists was_revised boolean not null default false;

-- verified is nullable (not just false) so we can distinguish "self-verification
-- was disabled/not applicable for this message" (null) from "it ran and failed" (false) -
-- the UI shows different things for each case.
