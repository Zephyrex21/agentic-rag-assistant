require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');

/**
 * RAG evaluation harness.
 *
 * Unlike every other test in this project, this one deliberately does NOT
 * mock anything - it needs real embeddings, real vector search, and real
 * generation to measure anything meaningful. A "retrieval precision" score
 * against a mocked retriever that always returns the right answer is not a
 * measurement, it's theater. So this is a manual/local tool (like
 * diagnose:keys), not a CI step - it needs your actual .env keys and a
 * running server.
 *
 * The golden document is deliberately FICTIONAL (invented company, invented
 * numbers) rather than a real-world topic. If it were real, a good LLM
 * could answer many of these questions from its own training data alone,
 * which would defeat the entire point - this harness is measuring whether
 * the SYSTEM grounds its answers in what it actually retrieved, not
 * whether the underlying model happens to already know the answer.
 *
 * Scoring approach:
 * - Retrieval score: deterministic keyword-presence check against the
 *   RETRIEVED chunks (not the answer) - measures whether the right
 *   information was found at all, independent of what the LLM did with it.
 * - Faithfulness / completeness / abstention-correctness: LLM-as-judge
 *   (Groq grades the system's own answer against the sources and the
 *   expected facts) - the same technique this project's own
 *   self-verification feature uses online, just applied offline/in batch
 *   across a whole golden set instead of one query at a time.
 *
 * Run with: npm run eval  (server must already be running separately)
 */

const SERVER_URL = process.env.EVAL_SERVER_URL || 'http://localhost:5000';
// Deliberately GENERATION_MODEL, not UTILITY_MODEL - grading with several
// conditional criteria at once (faithfulness AND completeness AND
// correct-abstention-detection, with different rules depending on
// question type) is a harder reasoning task than the simple utility jobs
// (rewriting, reranking) UTILITY_MODEL is tuned for. A weaker judge model
// tends to degrade toward copying literal placeholder-looking numbers
// instead of actually reasoning through the grading criteria.
const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL || process.env.GENERATION_MODEL || 'llama-3.3-70b-versatile';
const GOLDEN_FILENAME = 'wrenfield-ledger-eval-doc.md';

function loadGoldenQuestions() {
  const raw = fs.readFileSync(path.join(__dirname, 'golden-questions.json'), 'utf-8');
  return JSON.parse(raw);
}

async function waitForServer() {
  try {
    const res = await fetch(`${SERVER_URL}/health`);
    if (!res.ok) throw new Error(`health check returned ${res.status}`);
    return true;
  } catch (err) {
    console.error(`\n❌ Can't reach the server at ${SERVER_URL} - is it running? (npm run dev)`);
    console.error(`   ${err.message}\n`);
    process.exit(1);
  }
}

/** Reuses an existing golden-doc upload if one is already ready (avoids
 * re-uploading/re-embedding on every eval run), otherwise uploads fresh
 * and polls until ingestion finishes. */
async function ensureGoldenDocument() {
  const listRes = await fetch(`${SERVER_URL}/api/documents`);
  const { documents } = await listRes.json();
  const existing = documents.find((d) => d.filename === GOLDEN_FILENAME && d.status === 'ready');
  if (existing) {
    console.log(`Reusing already-ingested golden document (${existing.chunkCount} chunks).`);
    return existing.id;
  }

  console.log('Uploading golden document...');
  const content = fs.readFileSync(path.join(__dirname, 'golden-document.md'));
  const formData = new FormData();
  formData.append('file', new Blob([content], { type: 'text/markdown' }), GOLDEN_FILENAME);
  const uploadRes = await fetch(`${SERVER_URL}/api/documents/upload`, { method: 'POST', body: formData });
  if (!uploadRes.ok) {
    const body = await uploadRes.text();
    throw new Error(`Upload failed (${uploadRes.status}): ${body}`);
  }
  const { documentId } = await uploadRes.json();

  process.stdout.write('Waiting for ingestion');
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const statusRes = await fetch(`${SERVER_URL}/api/documents/${documentId}/status`);
    const status = await statusRes.json();
    if (status.status === 'ready') {
      console.log(` done (${status.chunkCount} chunks).`);
      return documentId;
    }
    if (status.status === 'failed') {
      throw new Error(`Golden document ingestion failed: ${status.error}`);
    }
    process.stdout.write('.');
  }
  throw new Error('Timed out waiting for golden document to finish ingesting.');
}

/** Runs one question through the real /api/query SSE endpoint, scoped to
 * just the golden document, and collects the retrieved sources + final answer. */
async function askQuestion(documentId, question) {
  const res = await fetch(`${SERVER_URL}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, documentIds: [documentId] }),
  });
  const raw = await res.text();

  let sources = [];
  let answer = '';
  for (const block of raw.split('\n\n').filter(Boolean)) {
    const eventMatch = block.match(/^event: (.+)$/m);
    const dataMatch = block.match(/^data: (.+)$/m);
    if (!eventMatch || !dataMatch) continue;
    const data = JSON.parse(dataMatch[1]);
    if (eventMatch[1] === 'sources') sources = data.sources;
    if (eventMatch[1] === 'done') answer = data.answer;
  }
  return { sources, answer };
}

/** Deterministic - checks whether expected facts actually made it into the
 * RETRIEVED chunks (not the answer). This isolates retrieval quality from
 * generation quality: a low score here means the problem is retrieval, not
 * the LLM. */
function scoreRetrieval(expectedKeywords, sources) {
  if (!expectedKeywords || expectedKeywords.length === 0) return null;
  const haystack = sources.map((s) => s.fullText || '').join(' \n ').toLowerCase();
  const found = expectedKeywords.filter((kw) => haystack.includes(kw.toLowerCase()));
  return { score: found.length / expectedKeywords.length, found, missing: expectedKeywords.filter((k) => !found.includes(k)) };
}

function buildJudgePrompt(item, sources, answer) {
  const sourceText = sources.map((s, i) => `[Source ${i + 1}]\n${s.fullText}`).join('\n\n');
  return `You are grading a RAG system's answer for an evaluation harness. Be strict and literal.

QUESTION: ${item.question}

RETRIEVED SOURCES (everything the system had available to answer with):
${sourceText || '(nothing was retrieved)'}

SYSTEM'S ANSWER:
${answer}

This question is ${item.shouldAbstain ? 'NOT answerable from the sources above - the correct behavior is declining to answer, not guessing' : 'answerable from the sources above'}.
${item.expectedKeywords ? `Expected key facts a complete answer should include: ${item.expectedKeywords.join(', ')}` : ''}

Grade strictly on:
1. faithfulness (a number from 0.0 to 1.0): are ALL factual claims in the answer actually stated in the retrieved sources? 1.0 = every claim is directly supported, 0.0 = fabricated or contradicts the sources. A correct abstention scores 1.0 here (nothing false was claimed).
2. completeness (a number from 0.0 to 1.0): does the answer cover the expected key facts? For an abstention question, score 1.0 if it correctly declined, 0.0 if it guessed.
3. correctlyAbstained: true if this was an abstention question AND the system correctly declined; false if it was an abstention question but the system guessed anyway; null if this isn't an abstention question at all.

You must actually calculate faithfulness and completeness yourself based on the specific question/sources/answer above - do not reuse numbers from any example. For instance, if you were grading a COMPLETELY UNRELATED case where an answer correctly and fully matched its sources, that unrelated example's grade might look like {"faithfulness": 0.92, "completeness": 0.85, "correctlyAbstained": null, "reasoning": "Covers most expected facts, one minor detail omitted."} - your actual numbers for THIS question will be different and depend entirely on what you read above.

Respond with ONLY a JSON object in that same shape - no other text before or after it.`;
}

async function judgeAnswer(groq, item, sources, answer) {
  let raw = '';
  try {
    const response = await groq.chat.completions.create({
      model: JUDGE_MODEL,
      messages: [{ role: 'user', content: buildJudgePrompt(item, sources, answer) }],
      temperature: 0,
      max_completion_tokens: 200,
    });
    raw = response.choices?.[0]?.message?.content || '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('judge returned no parseable JSON');
    const parsed = JSON.parse(match[0]);
    return { ...parsed, _rawJudgeResponse: raw };
  } catch (err) {
    console.warn(`   ⚠️  Judge call failed for "${item.id}": ${err.message} - scoring this item as ungraded.`);
    return { faithfulness: null, completeness: null, correctlyAbstained: null, reasoning: 'judge call failed', _rawJudgeResponse: raw };
  }
}

function fmtScore(n) {
  if (n === null || n === undefined) return ' n/a ';
  return `${Math.round(n * 100)}%`.padStart(5);
}

async function main() {
  if (!process.env.GROQ_API_KEY) {
    console.error('\n❌ GROQ_API_KEY not set - the judge model needs it. Set it in server/.env.\n');
    process.exit(1);
  }

  await waitForServer();
  const documentId = await ensureGoldenDocument();
  const questions = loadGoldenQuestions();
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  console.log(`\nRunning ${questions.length} golden questions against ${SERVER_URL}...\n`);

  const results = [];
  for (const item of questions) {
    process.stdout.write(`  ${item.id.padEnd(14)} ${item.question.slice(0, 50).padEnd(52)}`);
    const { sources, answer } = await askQuestion(documentId, item.question);
    const retrieval = scoreRetrieval(item.expectedKeywords, sources);
    const judgment = await judgeAnswer(groq, item, sources, answer);
    results.push({ item, retrieval, judgment, sourceCount: sources.length });
    console.log(
      `retr:${fmtScore(retrieval?.score)}  faith:${fmtScore(judgment.faithfulness)}  complete:${fmtScore(judgment.completeness)}`
    );
  }

  // --- Report ---
  console.log('\n' + '='.repeat(78));
  console.log('SUMMARY');
  console.log('='.repeat(78));

  const scored = (arr, key) => arr.map((r) => (key === 'retrieval' ? r.retrieval?.score : r.judgment[key])).filter((v) => v !== null && v !== undefined);
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

  const retrievalScores = scored(results, 'retrieval');
  const faithfulnessScores = scored(results, 'faithfulness');
  const completenessScores = scored(results, 'completeness');
  const abstentionItems = results.filter((r) => r.item.shouldAbstain);
  const correctAbstentions = abstentionItems.filter((r) => r.judgment.correctlyAbstained === true).length;

  console.log(`Avg retrieval score:    ${fmtScore(avg(retrievalScores))}  (found expected facts in the retrieved chunks)`);
  console.log(`Avg faithfulness:       ${fmtScore(avg(faithfulnessScores))}  (answers don't claim things the sources don't say)`);
  console.log(`Avg completeness:       ${fmtScore(avg(completenessScores))}  (answers cover the expected facts)`);
  console.log(`Abstention accuracy:    ${correctAbstentions}/${abstentionItems.length} correctly declined unanswerable questions`);

  // Sanity check: the ACTUAL bug this caught was BOTH faithfulness AND
  // completeness frozen at the same identical value across every question
  // (echoing the prompt's example numbers instead of grading). One score
  // alone being uniform is NOT suspicious by itself - e.g. faithfulness
  // legitimately tends toward a uniform 100% on a well-grounded system
  // (few/no fabricated claims) while completeness naturally varies with
  // how thorough each individual answer happens to be. Only flag the
  // specific pattern that's actually diagnostic: no variation in EITHER
  // score at all, which is what "the judge stopped grading" looks like.
  const allIdentical = (arr) => arr.length >= 4 && arr.every((v) => v === arr[0]);
  if (allIdentical(faithfulnessScores) && allIdentical(completenessScores)) {
    console.log(
      `\n⚠️  Both faithfulness AND completeness came back identical for every question ` +
        `(${fmtScore(faithfulnessScores[0])} / ${fmtScore(completenessScores[0])}) - zero variation across ` +
        `${results.length} different questions in EITHER score is very unlikely for real grades. This usually means ` +
        `the judge model is echoing a placeholder value instead of actually grading. Check eval/last-report.json's ` +
        `"_rawJudgeResponse" field for a few questions to see the judge's literal output, and consider trying a ` +
        `different EVAL_JUDGE_MODEL if it persists.`
    );
  }

  const worstRetrieval = results
    .filter((r) => r.retrieval && r.retrieval.score < 1)
    .sort((a, b) => a.retrieval.score - b.retrieval.score);
  if (worstRetrieval.length > 0) {
    console.log(`\nRetrieval gaps (expected facts NOT found in retrieved chunks):`);
    worstRetrieval.forEach((r) => {
      console.log(`  ${r.item.id}: missing [${r.retrieval.missing.join(', ')}]`);
    });
  }

  const reportPath = path.join(__dirname, 'last-report.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify({ ranAt: new Date().toISOString(), documentId, results }, null, 2)
  );
  console.log(`\nFull per-question report written to ${path.relative(process.cwd(), reportPath)}`);
  console.log(`\nGolden document left in place as "${GOLDEN_FILENAME}" (documentId ${documentId}) so re-runs don't re-ingest.`);
  console.log(`Delete it from the Documents panel (or via the API) if you want a clean slate.\n`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\n❌ Eval harness crashed:', err);
    process.exit(1);
  });
}

module.exports = { scoreRetrieval, ensureGoldenDocument, askQuestion, buildJudgePrompt, GOLDEN_FILENAME };
