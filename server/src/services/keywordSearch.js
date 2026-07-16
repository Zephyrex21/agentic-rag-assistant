const { getSupabase } = require('../db/supabaseClient');

const TABLE = 'chunks';

/**
 * Full-text keyword search over chunk text, using Postgres's built-in
 * text search (via the `chunks` table's generated tsvector column).
 * This is the "exact match" half of hybrid search - catches product names,
 * error codes, and specific phrases that pure vector similarity can miss.
 *
 * Deliberately built on Supabase (already free, already in use) instead of
 * a dedicated search engine like OpenSearch/Typesense - no new infra, no
 * new cost, and it's genuinely sufficient at portfolio/small-corpus scale.
 *
 * @param {string} queryText
 * @param {number} topK
 * @param {string[]} [documentIds] - optional scope filter, same semantics as Pinecone's
 * @returns {Promise<Array<{id: string, documentId: string, filename: string, chunkIndex: number, section: string, text: string}>>}
 */
async function keywordSearch(queryText, topK = 15, documentIds) {
  const supabase = getSupabase();

  let query = supabase
    .from(TABLE)
    .select('id, document_id, filename, chunk_index, section, text')
    // websearch_to_tsquery handles natural-language input gracefully (unlike
    // plainto_tsquery, it understands quotes/OR/-exclusions if someone types them,
    // but degrades safely for ordinary questions too)
    .textSearch('text_search', queryText, { type: 'websearch' })
    .limit(topK);

  if (Array.isArray(documentIds) && documentIds.length > 0) {
    query = query.in('document_id', documentIds);
  }

  const { data, error } = await query;
  if (error) {
    // Fail soft - hybrid search should degrade to vector-only, not break the query
    console.warn('[keywordSearch] Supabase full-text search failed, continuing without it:', error.message);
    return [];
  }

  return (data || []).map((row) => ({
    id: row.id,
    documentId: row.document_id,
    filename: row.filename,
    chunkIndex: row.chunk_index,
    section: row.section,
    text: row.text,
  }));
}

module.exports = { keywordSearch };
