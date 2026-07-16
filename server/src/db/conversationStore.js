const { getSupabase } = require('./supabaseClient');

const CONVERSATIONS = 'conversations';
const MESSAGES = 'messages';

function conversationFromDb(row) {
  if (!row) return null;
  return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
}

function messageFromDb(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    sources: row.sources || null,
    createdAt: row.created_at,
  };
}

async function createConversation(title = 'New conversation') {
  const supabase = getSupabase();
  const { data, error } = await supabase.from(CONVERSATIONS).insert({ title }).select().single();
  if (error) throw new Error(`conversationStore.createConversation failed: ${error.message}`);
  return conversationFromDb(data);
}

async function listConversations() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from(CONVERSATIONS).select('*').order('updated_at', { ascending: false });
  if (error) throw new Error(`conversationStore.listConversations failed: ${error.message}`);
  return (data || []).map(conversationFromDb);
}

async function getConversation(conversationId) {
  const supabase = getSupabase();
  const { data: convo, error: convoErr } = await supabase
    .from(CONVERSATIONS)
    .select('*')
    .eq('id', conversationId)
    .maybeSingle();
  if (convoErr) throw new Error(`conversationStore.getConversation failed: ${convoErr.message}`);
  if (!convo) return null;

  const { data: messages, error: msgErr } = await supabase
    .from(MESSAGES)
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (msgErr) throw new Error(`conversationStore.getConversation (messages) failed: ${msgErr.message}`);

  return { ...conversationFromDb(convo), messages: (messages || []).map(messageFromDb) };
}

/**
 * Returns the last N messages for a conversation, oldest-first - used to build
 * the "conversation so far" context passed into the LLM prompt for follow-ups.
 */
async function getRecentMessages(conversationId, limit = 6) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(MESSAGES)
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`conversationStore.getRecentMessages failed: ${error.message}`);
  return (data || []).reverse().map(messageFromDb); // back to oldest-first
}

async function addMessage(conversationId, { role, content, sources = null }) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(MESSAGES)
    .insert({ conversation_id: conversationId, role, content, sources })
    .select()
    .single();
  if (error) throw new Error(`conversationStore.addMessage failed: ${error.message}`);

  // Touch the parent conversation's updated_at so conversation lists sort by recency
  await supabase.from(CONVERSATIONS).update({ updated_at: new Date().toISOString() }).eq('id', conversationId);

  return messageFromDb(data);
}

async function updateTitle(conversationId, title) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(CONVERSATIONS)
    .update({ title })
    .eq('id', conversationId)
    .select()
    .maybeSingle();
  if (error) throw new Error(`conversationStore.updateTitle failed: ${error.message}`);
  return conversationFromDb(data);
}

async function deleteConversation(conversationId) {
  const supabase = getSupabase();
  // messages cascade-delete via the FK constraint in schema.sql
  const { error } = await supabase.from(CONVERSATIONS).delete().eq('id', conversationId);
  if (error) throw new Error(`conversationStore.deleteConversation failed: ${error.message}`);
  return true;
}

module.exports = {
  createConversation,
  listConversations,
  getConversation,
  getRecentMessages,
  addMessage,
  updateTitle,
  deleteConversation,
};
