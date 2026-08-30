-- Migration 007: User accounts + per-user data ownership
--
-- Adds real sign-up/login on top of the existing single shared deployment
-- model. Guest mode (no account, gated only by the optional APP_ACCESS_KEY)
-- keeps working exactly as before - a document/conversation with
-- user_id = NULL is "guest pool" data, visible the same way it always was.
-- A logged-in user's documents/conversations get their user_id set at
-- creation and are only ever visible to that same user from then on.
--
-- Run this in the Supabase SQL editor, after migrations 002-006.
--
-- Like migration_004/006, user_id is additive and nullable - existing rows
-- simply have user_id = null (guest pool), and documentStore.js/
-- conversationStore.js already follow the defensive `'column' in row`
-- pattern for reading columns that might not exist yet on a database this
-- hasn't been run against.

create extension if not exists "pgcrypto";

create table if not exists users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  password_hash  text not null,
  created_at     timestamptz not null default now()
);

alter table documents add column if not exists user_id uuid references users(id) on delete cascade;
alter table conversations add column if not exists user_id uuid references users(id) on delete cascade;
-- chunks denormalizes user_id (same pattern it already uses for filename/
-- section instead of joining against documents) so keyword search can
-- filter by owner directly, without a join, on every query.
alter table chunks add column if not exists user_id uuid references users(id) on delete cascade;
-- Folders get the same treatment - without this, a logged-in user's
-- folder dropdown would show every folder ever created by anyone
-- (including other accounts and the guest pool), which leaks folder
-- names (potentially sensitive on their own) and is confusing regardless.
alter table folders add column if not exists user_id uuid references users(id) on delete cascade;

create index if not exists idx_documents_user_id on documents(user_id);
create index if not exists idx_conversations_user_id on conversations(user_id);
create index if not exists idx_chunks_user_id on chunks(user_id);
create index if not exists idx_folders_user_id on folders(user_id);

-- Note: Row Level Security is still intentionally left OFF (see schema.sql's
-- note) - ownership is enforced in the Node server (every query is scoped
-- to req.user's id or explicitly to "user_id IS NULL" for guests), not via
-- Supabase RLS. The service role key this backend uses bypasses RLS
-- regardless, so enabling it here would be no-op protection - the real
-- boundary is the WHERE clause in userStore.js/documentStore.js/
-- conversationStore.js.
