/**
 * Standalone test for agentTools.js's pure helpers - no API key/database
 * needed. listReadyDocuments itself calls documentStore (a real DB), so
 * only its extracted pure scoping logic (filterToScope) is covered here -
 * same split as elsewhere in this codebase between orchestration and pure
 * logic.
 * Run with: npm run test:agenttools
 */
const { TOOL_DEFINITIONS, filterToScope } = require('../services/agentTools');

console.log('=== Agent Tools Test ===\n');

// --- Tool schema sanity ---

console.assert(Array.isArray(TOOL_DEFINITIONS) && TOOL_DEFINITIONS.length === 2, 'FAIL: expected exactly 2 tool definitions');
const names = TOOL_DEFINITIONS.map((t) => t.function.name);
console.assert(names.includes('search_documents'), 'FAIL: search_documents tool missing');
console.assert(names.includes('list_documents'), 'FAIL: list_documents tool missing');
for (const tool of TOOL_DEFINITIONS) {
  console.assert(tool.type === 'function', `FAIL: ${tool.function?.name} should have type "function"`);
  console.assert(typeof tool.function.description === 'string' && tool.function.description.length > 0, `FAIL: ${tool.function.name} missing a description`);
  console.assert(tool.function.parameters?.type === 'object', `FAIL: ${tool.function.name} parameters should be a JSON schema object`);
}
console.log('✅ Both tool schemas are well-formed (name, description, object-typed parameters)');

const searchTool = TOOL_DEFINITIONS.find((t) => t.function.name === 'search_documents');
console.assert(searchTool.function.parameters.required.includes('query'), 'FAIL: search_documents should require a query argument');
console.log('✅ search_documents correctly requires a "query" argument');

// --- filterToScope ---

const docs = [
  { id: 'd1', filename: 'cryptex.md', status: 'ready' },
  { id: 'd2', filename: 'ws-inspector.md', status: 'ready' },
  { id: 'd3', filename: 'exoplanet.md', status: 'processing' },
];

console.assert(filterToScope(docs, undefined).length === 3, 'FAIL: no scope should mean "all documents"');
console.assert(filterToScope(docs, []).length === 3, 'FAIL: empty scope array should mean "all documents", not "none"');
console.log('✅ Missing/empty scope returns every document (unscoped = all)');

const scoped = filterToScope(docs, ['d1', 'd3']);
console.assert(scoped.length === 2 && scoped.every((d) => ['d1', 'd3'].includes(d.id)), 'FAIL: scope should filter to exactly the given IDs');
console.log('✅ A given scope filters down to exactly the specified document IDs');

const scopedMissing = filterToScope(docs, ['does-not-exist']);
console.assert(scopedMissing.length === 0, 'FAIL: a scope matching nothing should return an empty list, not fall back to "all"');
console.log('✅ A scope matching no real documents returns empty rather than silently falling back to "all"');

console.log('\n✅ All agent tools tests passed.');
