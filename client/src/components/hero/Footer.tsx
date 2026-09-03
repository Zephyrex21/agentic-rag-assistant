import { ArrowUpRight } from 'lucide-react';
import { LogoMark } from '../LogoMark';
import { GithubIcon } from '../icons/BrandIcons';

const GITHUB_PROFILE_URL = 'https://github.com/Zephyrex21';
const GITHUB_REPO_URL = 'https://github.com/Zephyrex21/agentic-rag-assistant';

/**
 * The landing page's closing section, sitting below FeaturesSection - a
 * proper site footer (project blurb, quick links, stack, GitHub) rather
 * than the one-line "Groq · Jina AI · Pinecone · Supabase" credit that
 * lives inside the hero fold itself, which stays as-is since it's part of
 * that section's own composition, not a substitute for an actual footer.
 */
export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative border-t border-border bg-surface px-6 py-14 sm:px-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        <div className="flex flex-col justify-between gap-10 sm:flex-row">
          <div className="max-w-xs">
            <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-ink-muted">
              <LogoMark size={18} />
              RAG Assistant
            </span>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
              An agentic retrieval-augmented assistant — hybrid search, LLM reranking, and self-verified,
              cited answers over your own documents.
            </p>
          </div>

          <div className="flex gap-10 sm:gap-14">
            <div>
              <h4 className="font-mono text-[11px] uppercase tracking-[0.15em] text-ink-muted">Project</h4>
              <ul className="mt-3 flex flex-col gap-2 text-[13.5px]">
                <li>
                  <a
                    href={GITHUB_REPO_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-ink transition-colors hover:text-accent"
                  >
                    Source code <ArrowUpRight size={12} />
                  </a>
                </li>
                <li>
                  <a href="#features" className="text-ink transition-colors hover:text-accent">
                    Features
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-mono text-[11px] uppercase tracking-[0.15em] text-ink-muted">Built with</h4>
              <p className="mt-3 max-w-[180px] text-[13.5px] leading-relaxed text-ink-muted">
                Groq · Jina AI · Pinecone · Supabase
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col items-center justify-between gap-4 border-t border-border pt-6 sm:flex-row">
          <p className="text-[12.5px] text-ink-muted">© {year} Built by Zephyrex.</p>
          <a
            href={GITHUB_PROFILE_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-full border border-border px-3.5 py-1.5 text-[12.5px] text-ink transition-colors hover:border-accent/50 hover:text-accent"
          >
            <GithubIcon size={14} />
            @Zephyrex21
          </a>
        </div>
      </div>
    </footer>
  );
}
