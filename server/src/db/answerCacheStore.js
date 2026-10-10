const { getSupabase } = require('./supabaseClient');

const TABLE = 'answer_cache';

function fromDb(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerKey: row.owner_key,
    docSignature: row.doc_signature,
    question: row.question,
    answer: row.answer,
    sources: row.sources || [],
    hitCount: row.hit_count,
    createdAt: row.created_at,
    lastHitAt: row.last_hit_at,
  };
}

/** Inserts a new cache entry and returns its id (used as the matching
 * Pinecone vector's id - see answerCache.js). */
async function insert({ ownerKey, docSignature, question, answer, sources }) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ owner_key: ownerKey, doc_signature: docSignature, question, answer, sources })
    .select('id')
    .single();
  if (error) throw new Error(`answerCacheStore.insert failed: ${error.message}`);
  return data.id;
}

async function findById(id) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`answerCacheStore.findById failed: ${error.message}`);
  return fromDb(data);
}

/** Fire-and-forget bookkeeping on a hit - never on the critical path of
 * actually returning the cached answer (see answerCache.js's lookup,
 * which doesn't await this). Read-then-write, not atomic - deliberately:
 * this is a display stat ("asked N times"), not something anything else
 * depends on for correctness, so the rare lost increment under real
 * concurrent hits on the exact same cache entry isn't worth a Postgres
 * function/migration to avoid. */
async function recordHit(id) {
  const current = await findById(id);
  if (!current) return;
  const supabase = getSupabase();
  await supabase
    .from(TABLE)
    .update({ hit_count: current.hitCount + 1, last_hit_at: new Date().toISOString() })
    .eq('id', id);
}

/** Removes one cache entry - used when a document is deleted/re-uploaded
 * (see documentStore.js) so a stale cached answer can never outlive the
 * source it was generated from. */
async function deleteById(id) {
  const supabase = getSupabase();
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw new Error(`answerCacheStore.deleteById failed: ${error.message}`);
}

module.exports = { insert, findById, recordHit, deleteById };
