-- Migration 006: Duplicate upload detection
--
-- Adds a content hash (SHA-256 of the raw uploaded file bytes) to each
-- document, so a re-upload of the exact same file can be detected and
-- flagged before it's processed again - without this, uploading the same
-- PDF twice silently created two separate documents, doubling that
-- content's presence in the retrieval pool with no way to tell they were
-- duplicates short of comparing filenames by eye.
--
-- Run this in the Supabase SQL editor, same as migrations 002-005.
--
-- Like migration_004's folder_id, this is additive and nullable - existing
-- rows simply have content_hash = null (never checked against, since
-- documentStore.findByContentHash only matches on a real hash), and
-- documentStore.js's fromDb() already follows the same defensive
-- `'column' in row` pattern for reading columns that might not exist yet
-- on a database this hasn't been run against.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS content_hash text;

-- Not UNIQUE - a duplicate is intentionally still allowed to exist (the
-- upload route lets a person proceed anyway after being warned), this
-- index only makes the "does this hash already exist" lookup fast.
CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON documents (content_hash);
