const { createClient } = require('@supabase/supabase-js');

let client = null;

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is not set. Add both to server/.env (Project Settings -> API in your Supabase dashboard). Use the service_role key, not the anon key - this is a server-only backend.'
    );
  }
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }, // backend usage - no browser session to persist
    });
  }
  return client;
}

module.exports = { getSupabase };
