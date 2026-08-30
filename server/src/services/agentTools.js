const documentStore = require('../db/documentStore');

// OpenAI/Groq-compatible function-calling schemas. Deliberately small - two
// read-only tools - because this is a RETRIEVAL PLANNER, not a general
// agent: its only job is deciding what to search for, never acting on the
// user's behalf or writing anything. That narrow scope is what makes it
// safe to let the model drive the loop (see agenticRag.js).
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'search_documents',
      description:
        'Search the uploaded documents for passages relevant to a specific query. Runs hybrid (vector + keyword) search with reranking - call it once per distinct piece of information you need. For a question with multiple parts, or one comparing two or more things, call it once per part with a focused query for each part rather than one combined query.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'A focused, standalone search query. Resolve any pronouns or references ("it", "the second one") using the conversation history before writing this - the search itself has no memory of the conversation.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_documents',
      description:
        'List the names of documents currently available to search, without searching their content. Use this for meta-questions like "what documents do I have" or to confirm a document exists before scoping a search to it.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

/**
 * Lists ready-to-search document filenames, optionally scoped to a specific
 * set of document IDs (mirrors the same scoping search_documents respects -
 * the agent chooses QUERIES, not which documents are in play, that's
 * already decided by the conversation's document scope). Only "ready"
 * documents are listed - ones still processing or that failed ingestion
 * aren't actually searchable yet, so surfacing them here would be misleading.
 *
 * @param {string[]} [documentIds]
 * @param {string|null} [userId] - owner scope: a real id restricts to that
 *   user's own documents, null restricts to the guest pool - so the
 *   planner's list_documents tool can never reveal another user's
 *   filenames as "available documents".
 * @returns {Promise<string[]>} filenames
 */
async function listReadyDocuments(documentIds, userId = null) {
  const all = await documentStore.list({ userId });
  const scoped = filterToScope(all, documentIds);
  return scoped.filter((d) => d.status === 'ready').map((d) => d.filename);
}

/** Pure helper split out from listReadyDocuments so the scoping logic itself is unit-testable without a database. */
function filterToScope(documents, documentIds) {
  if (!Array.isArray(documentIds) || documentIds.length === 0) return documents;
  const scopeSet = new Set(documentIds);
  return documents.filter((d) => scopeSet.has(d.id));
}

module.exports = { TOOL_DEFINITIONS, listReadyDocuments, filterToScope };
