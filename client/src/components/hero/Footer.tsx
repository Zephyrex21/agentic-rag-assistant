import { ArrowUpRight } from 'lucide-react';
import { LogoMark } from '../LogoMark';

const GITHUB_PROFILE_URL = 'https://github.com/Zephyrex21';
const GITHUB_REPO_URL = 'https://github.com/Zephyrex21/agentic-rag-assistant';

/** lucide-react dropped brand/logo icons a while back, so the GitHub mark
 * is a small inline SVG (the standard octocat outline) rather than an
 * import - same approach LogoMark.tsx already takes for its own icon. */
function GithubIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.73.5.5 5.73.5 12c0 5.09 3.29 9.4 7.86 10.93.57.1.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.8 1.19 1.83 1.19 3.09 0 4.43-2.7 5.4-5.27 5.69.42.36.78 1.07.78 2.16 0 1.56-.01 2.82-.01 3.2 0 .3.21.66.79.55A10.5 10.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
    </svg>
  );
}

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
