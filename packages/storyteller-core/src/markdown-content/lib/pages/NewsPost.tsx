import { Link, useParams } from "react-router-dom";
import { getNewsPostBySlug } from "../data/content";
import { markdownToHtml } from "../utils/markdown";
import { ChevronLeftIcon } from "lucide-react";
import { useMemo } from "react";

interface NewsPostProps {
  slug?: string;
  basePath: string; // e.g. "/news"
}

export const NewsPost = ({ slug: propSlug, basePath }: NewsPostProps) => {
  const { slug: paramSlug } = useParams();
  const slug = propSlug || paramSlug;
  const post = slug ? getNewsPostBySlug(slug) : null;

  const html = useMemo(() => (post ? markdownToHtml(post.body) : ""), [post]);

  if (!post) {
    return (
      <div className="relative min-h-screen text-on-surface">
        <div className="relative z-10 mx-auto w-full max-w-[1200px] px-4 sm:px-8 pt-28 sm:pt-36 pb-12">
          <h1 className="text-3xl font-bold">Not found</h1>
          <p className="text-on-surface/70">We couldn't find this article.</p>
          <Link to={basePath} className="text-primary mt-4 inline-block hover:underline">
            Return to News
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen text-on-surface">
      <div className="relative z-10 mx-auto w-full max-w-3xl px-4 sm:px-6 pt-24 sm:pt-32 pb-32">
        <div className="mb-8 flex items-center justify-between">
          <Link
            to={basePath}
            className="rounded-lg px-4 py-2 text-sm border border-outline-variant bg-on-surface/5 hover:bg-on-surface/10 inline-flex items-center gap-2 transition-colors"
          >
            <ChevronLeftIcon />
            Back to News
          </Link>
          {post.date && <span className="text-on-surface/50 font-mono text-sm">{post.date}</span>}
        </div>

        <h1 className="text-4xl md:text-5xl font-bold mb-6 !leading-tight tracking-tight">{post.title}</h1>

        {post.description && (
          <p className="text-xl text-on-surface/70 mb-8 leading-relaxed font-light border-l-4 border-primary pl-4">
            {post.description}
          </p>
        )}

        {post.thumbnail && (
          <div className="w-full overflow-hidden rounded-xl border border-outline-variant bg-scrim mb-12 shadow-2xl">
            <img src={post.thumbnail} alt={post.title} className="w-full h-auto object-cover" />
          </div>
        )}

        <article
          className="article-content max-w-none text-on-surface/90 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <style>{`
          .article-content h1 { font-size: 2rem; font-weight: 700; margin: 2rem 0 1rem; color: var(--md-sys-color-on-surface); }
          .article-content h2 { font-size: 1.75rem; font-weight: 700; margin: 2rem 0 1rem; color: var(--md-sys-color-tertiary); }
          .article-content h3 { font-size: 1.5rem; font-weight: 600; margin: 1.5rem 0 0.75rem; color: var(--md-sys-color-tertiary); }
          .article-content h4 { font-size: 1.25rem; font-weight: 600; margin: 1rem 0 0.5rem; }
          .article-content p { margin: 1rem 0; line-height: 1.75; font-size: 1.05rem; }
          .article-content ul { list-style: disc; padding-left: 1.5rem; margin: 1rem 0; }
          .article-content li { margin-bottom: 0.5rem; }
          .article-content img { display: block; width: 100%; max-width: 100%; height: auto; border-radius: 0.75rem; border: 1px solid var(--md-sys-color-outline-variant); margin: 2rem 0; }
          .article-content a { color: var(--md-sys-color-primary); text-decoration: none; border-bottom: 1px solid transparent; transition: border-color 0.2s; }
          .article-content a:hover { border-bottom-color: var(--md-sys-color-primary); }
          .article-content blockquote { border-left: 4px solid var(--md-sys-color-primary); padding-left: 1rem; font-style: italic; color: var(--md-sys-color-on-surface-variant); margin: 1.5rem 0; }
          .article-content code { background: var(--md-sys-color-surface-container-high); padding: 0.2em 0.4em; border-radius: 0.25em; font-family: monospace; font-size: 0.9em; }
          .article-content pre { background: var(--md-sys-color-surface-container-lowest); padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin: 1.5rem 0; border: 1px solid var(--md-sys-color-outline-variant); }
          .article-content pre code { background: transparent; padding: 0; color: inherit; }
          
          /* Video embed styles */
          .article-content .video-embed { position: relative; width: 100%; margin: 2rem 0; border-radius: 0.75rem; overflow: hidden; border: 1px solid var(--md-sys-color-outline-variant); background: var(--md-sys-color-scrim); }
          .article-content .youtube-embed { padding-bottom: 56.25%; /* 16:9 aspect ratio */ height: 0; }
          .article-content .youtube-embed iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
          .article-content .video-embed video { display: block; width: 100%; height: auto; max-height: 70vh; }
        `}</style>
      </div>
    </div>
  );
};
