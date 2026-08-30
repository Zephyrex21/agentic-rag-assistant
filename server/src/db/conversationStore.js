const { getSupabase } = require('./supabaseClient');
const documentStore = require('./documentStore');

const CONVERSATIONS = 'conversations';
const MESSAGES = 'messages';

function conversationFromDb(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    userId: 'user_id' in row ? row.user_id : undefined,
  };
}

function messageFromDb(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    sources: row.sources || null,
    verified: row.verified,
    wasRevised: row.was_revised || false,
    pipelineTrace: row.pipeline_trace || null,
    createdAt: row.created_at,
  };
}

/** @param {{ userId?: string | null }} [options] - null for a guest
 *  conversation, a real id to own it; omitted only for internal/legacy
 *  callers - route-facing calls should always pass this explicitly. */
async function createConversation(title = 'New conversation', options = {}) {
  const supabase = getSupabase();
  const payload = { title };
  if ('userId' in options) payload.user_id = options.userId;
  const { data, error } = await supabase.from(CONVERSATIONS).insert(payload).select().single();
  if (error) {
    // user_id is the newest column (migration_007) - retry without it if
    // that migration hasn't been run yet, same fail-open pattern
    // documentStore.create uses for content_hash/user_id.
    if (/user_id/i.test(error.message) && 'user_id' in payload) {
      console.warn(
        `[conversationStore] insert failed on user_id (${error.message}) - has migration_007_users_and_ownership.sql been run? Retrying without it.`
      );
      const { user_id, ...withoutUserId } = payload;
      const retry = await supabase.from(CONVERSATIONS).insert(withoutUserId).select().single();
      if (retry.error) throw new Error(`conversationStore.createConversation failed: ${retry.error.message}`);
      return conversationFromDb(retry.data);
    }
    throw new Error(`conversationStore.createConversation failed: ${error.message}`);
  }
  return conversationFromDb(data);
}

/**
 * @param {{ limit?: number, offset?: number, userId?: string | null }} [options] -
 *   limit/offset are OPT-IN pagination, same convention as
 *   documentStore.list. userId scopes to one owner (null = guest pool);
 *   omitted only for the rare unscoped/internal case.
 */
async function listConversations(options = {}) {
  const supabase = getSupabase();
  let query = supabase.from(CONVERSATIONS).select('*').order('updated_at', { ascending: false });
  if ('userId' in options) {
    query = options.userId === null ? query.is('user_id', null) : query.eq('user_id', options.userId);
  }
  if (typeof options.limit === 'number') {
    const offset = typeof options.offset === 'number' ? options.offset : 0;
    query = query.range(offset, offset + options.limit - 1);
  }
  const { data, error } = await query;
  if (error) throw new Error(`conversationStore.listConversations failed: ${error.message}`);
  return (data || []).map(conversationFromDb);
}

/**
 * Flags any source in `messages` whose documentId no longer resolves to an
 * existing document (i.e. that document was deleted after this message was
 * answered) with `documentDeleted: true` - checked at READ time rather than
 * updated at delete time, so deleting a document stays a fast, single-purpose
 * operation and this cost is only ever paid by someone actually opening an
 * affected conversation. The excerpt/fullText snapshotted into `sources` at
 * answer-time is untouched either way - only the citation's continued
 * validity is what's being flagged, not the content itself, which was
 * always a point-in-time copy regardless of the source document's fate.
 * Fails soft: if the existence check itself errors (a transient DB blip),
 * the conversation is still returned, just without this annotation for
 * that one request - a missing "deleted" badge is a much smaller problem
 * than failing to load the conversation at all.
 */
async function annotateStaleCitations(messages) {
  const referencedIds = new Set();
  for (const m of messages) {
    if (!m.sources) continue;
    for (const s of m.sources) {
      if (s.documentId) referencedIds.add(s.documentId);
    }
  }
  if (referencedIds.size === 0) return messages;

  let existingIds;
  try {
    existingIds = await documentStore.existsMany([...referencedIds]);
  } catch (err) {
    console.warn(`[conversationStore] stale-citation check failed (${err.message}), returning messages unannotated.`);
    return messages;
  }

  return messages.map((m) => {
    if (!m.sources) return m;
    return {
      ...m,
      sources: m.sources.map((s) => (s.documentId && !existingIds.has(s.documentId) ? { ...s, documentDeleted: true } : s)),
    };
  });
}

/**
 * @param {string} conversationId
 * @param {{ userId?: string | null }} [options] - scopes the lookup to one
 *   owner (null = guest pool) - a conversation belonging to someone else
 *   resolves as not-found rather than leaking its existence or contents.
 *   Every route-facing call passes this; every message-level function
 *   below (getRecentMessages/addMessage/updateMessage) is only ever
 *   reached in this codebase AFTER a route has already confirmed
 *   ownership via this function, so they don't re-check it themselves.
 */
async function getConversation(conversationId, options = {}) {
  const supabase = getSupabase();
  let query = supabase.from(CONVERSATIONS).select('*').eq('id', conversationId);
  if ('userId' in options) {
    query = options.userId === null ? query.is('user_id', null) : query.eq('user_id', options.userId);
  }
  const { data: convo, error: convoErr } = await query.maybeSingle();
  if (convoErr) throw new Error(`conversationStore.getConversation failed: ${convoErr.message}`);
  if (!convo) return null;

  const { data: messages, error: msgErr } = await supabase
    .from(MESSAGES)
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (msgErr) throw new Error(`conversationStore.getConversation (messages) failed: ${msgErr.message}`);

  const annotatedMessages = await annotateStaleCitations((messages || []).map(messageFromDb));
  return { ...conversationFromDb(convo), messages: annotatedMessages };
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

async function addMessage(conversationId, { role, content, sources = null, verified = null, wasRevised = false, pipelineTrace = null }) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(MESSAGES)
    .insert({
      conversation_id: conversationId,
      role,
      content,
      sources,
      verified,
      was_revised: wasRevised,
      pipeline_trace: pipelineTrace,
    })
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

/**
 * Patches an existing message - used for two background-verification
 * follow-ups that happen AFTER a message is already persisted (see
 * rag.js's retrieveAndAnswerStream): flipping `verified` to true once a
 * background check passes, and applying an accepted revision's content
 * when a person chooses to use a suggested correction. Only the fields
 * passed in `updates` are touched. Returns null (not a thrown error) if
 * the message doesn't exist, so callers can 404 cleanly.
 */
async function updateMessage(messageId, updates) {
  const supabase = getSupabase();
  const patch = {};
  if (updates.content !== undefined) patch.content = updates.content;
  if (updates.sources !== undefined) patch.sources = updates.sources;
  if (updates.verified !== undefined) patch.verified = updates.verified;
  if (updates.wasRevised !== undefined) patch.was_revised = updates.wasRevised;
  if (updates.pipelineTrace !== undefined) patch.pipeline_trace = updates.pipelineTrace;

  const { data, error } = await supabase.from(MESSAGES).update(patch).eq('id', messageId).select().maybeSingle();
  if (error) throw new Error(`conversationStore.updateMessage failed: ${error.message}`);
  return messageFromDb(data);
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
  updateMessage,
  deleteConversation,
  annotateStaleCitations,
};
