-- Migration 008: Passwordless email OTP authentication
--
-- Replaces the email+password signup/login from migration_007 with a
-- passwordless "email a 6-digit code, verify it" flow (see
-- server/src/routes/auth.js and server/src/services/otp.js). An account is
-- now just a verified email address - there is no password to set, forget,
-- or leak in a breach.
--
-- Run this in the Supabase SQL editor, after migration_007.

-- password_hash is no longer written by the signup/login flow (there IS no
-- password anymore), so it can no longer be NOT NULL. Kept as a nullable
-- column rather than dropped outright - deliberately non-destructive for
-- anyone who already has real user rows from before this migration, and
-- cheap to actually drop later in a follow-up migration once nothing reads
-- it anymore.
alter table users alter column password_hash drop not null;

-- One pending code per email at a time (upserted on every new request, see
-- otpStore.js) - there's never a reason to keep more than one live code for
-- the same address, and this keeps a request-spam scenario from growing
-- the table.
create table if not exists otp_codes (
  email       text primary key,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    integer not null default 0,
  created_at  timestamptz not null default now()
);

-- Lets a cheap periodic cleanup (or just Postgres's own query planner on
-- the rare manual lookup) find long-expired rows without a table scan.
-- Not required for correctness - otpStore.js always checks expires_at
-- itself on every verify - purely so this table doesn't grow unbounded
-- from abandoned/never-verified requests.
create index if not exists idx_otp_codes_expires_at on otp_codes(expires_at);
