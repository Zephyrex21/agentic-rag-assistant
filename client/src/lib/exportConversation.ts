import type { ConversationDetail, Message } from './types';

function formatMessage(m: Message): string {
  const speaker = m.role === 'user' ? 'You' : 'Assistant';
  let block = `**${speaker}:**\n\n${m.content}`;

  const cited = (m.sources || []).filter((s) => s.cited);
  if (cited.length > 0) {
    const list = cited
      .map((s) => `${s.sourceNumber}. ${s.filename}${s.section && s.section !== 'N/A' ? ` — ${s.section}` : ''}`)
      .join('\n');
    block += `\n\n*Sources:*\n${list}`;
  }

  if (m.wasRevised) {
    block += m.verified
      ? '\n\n*(This answer was automatically revised for accuracy after a self-check.)*'
      : '\n\n*(This answer may not be fully supported by the sources - flagged by self-verification.)*';
  }

  return block;
}

/** Builds a clean, portable Markdown document from a conversation - no app
 * dependencies, opens correctly in any Markdown viewer, GitHub, Notion, etc. */
export function conversationToMarkdown(conversation: ConversationDetail): string {
  const exportedAt = new Date().toLocaleString();
  const header = `# ${conversation.title}\n\n_Exported from RAG Assistant on ${exportedAt}_\n\n---\n`;
  const body = conversation.messages.map(formatMessage).join('\n\n---\n\n');
  return `${header}\n${body}\n`;
}

/** Triggers a browser download of the conversation as a .md file - no
 * server round-trip needed, everything the export needs is already loaded
 * client-side. */
export function downloadConversationMarkdown(conversation: ConversationDetail): void {
  const markdown = conversationToMarkdown(conversation);
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const safeTitle = conversation.title.replace(/[^a-z0-9 _-]/gi, '').trim().slice(0, 60) || 'conversation';
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeTitle}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
