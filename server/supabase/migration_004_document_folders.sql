-- RAG Assistant - migration: document folders
-- Run this in Supabase: Dashboard -> SQL Editor -> New Query -> paste -> Run
-- (Run after schema.sql, migration_002_hybrid_search.sql, migration_003_self_verification.sql)

create table if not exists folders (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  created_at   timestamptz not null default now()
);

alter table documents
  add column if not exists folder_id uuid references folders(id) on delete set null;

-- ON DELETE SET NULL (not CASCADE) is deliberate: deleting a folder should
-- uncategorize its documents, not delete them - folders are an
-- organizational label, not a container the documents' lifecycle depends on.

create index if not exists idx_documents_folder_id on documents(folder_id);
