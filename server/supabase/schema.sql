-- RAG Assistant - Phase 3 schema
-- Run this in your Supabase project: Dashboard -> SQL Editor -> New Query -> paste -> Run

create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- Documents (replaces the local documents.json store from Phase 1)
create table if not exists documents (
  id             uuid primary key default gen_random_uuid(),
  filename       text not null,
  status         text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  chunk_count    integer not null default 0,
  uploaded_at    timestamptz not null default now(),
  processed_at   timestamptz,
  error          text
);

-- Conversations
create table if not exists conversations (
  id             uuid primary key default gen_random_uuid(),
  title          text not null default 'New conversation',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Messages (both user questions and assistant answers live here)
create table if not exists messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  sources          jsonb,       -- only populated for assistant messages
  created_at       timestamptz not null default now()
);

create index if not exists idx_messages_conversation_id on messages(conversation_id);
create index if not exists idx_messages_created_at on messages(conversation_id, created_at);

-- Note: Row Level Security is intentionally left OFF here. This backend uses the
-- Supabase SERVICE ROLE key (server-side only, never exposed to a frontend), which
-- bypasses RLS entirely. If you later add user accounts / a public-facing frontend
-- that talks to Supabase directly, you'll want to enable RLS + policies at that point.
