// SPDX-License-Identifier: Apache-2.0
import { AphrodyAvatar, AphrodyPet, publicPetAtlas } from "@aphrody/identity";
import { PET_ATLAS_URL } from "@aphrody/identity/atlas";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { searchGoogle, type GoogleSearchPage } from "../../google-search";
import { useI18n } from "../../i18n";
import { usesBrowserBackend } from "../../tauri-bridge";
import { productSearchMessages } from "./product-search-messages";

export function ProductSearchHome({ assetBase }: { publicPreview?: boolean; assetBase?: string }) {
  const language = useI18n(state => state.language);
  const setLanguage = useI18n(state => state.setLanguage);
  const text = productSearchMessages[language];
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<GoogleSearchPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // /api/search answers on every host: the Google owner where one is configured, otherwise the local index.
  const searchable = true;
  async function run() {
    if (busy || !query.trim()) return;
    setBusy(true);
    setFailed(false);
    setPage(null);
    try {
      setPage(
        await searchGoogle({
          query,
          vertical: "web",
          hl: language,
          safe: "active",
          start: 0,
        }),
      );
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void run();
  }
  return (
    <article
      lang={language}
      className="flex min-h-full flex-col bg-surface text-on-surface"
      aria-labelledby="aphrody-home-title"
    >
      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-5 py-12 text-center sm:px-8 sm:py-20">
        <div className="mb-5 flex items-center gap-4">
          <AphrodyAvatar size={64} label={text.logo} />
          <h1 id="aphrody-home-title" className="text-display-large font-medium tracking-tight">
            Aphrody
          </h1>
        </div>
        <p className="mb-8 text-body-large text-on-surface-variant">{text.intro}</p>
        {searchable && (
          <>
            <search aria-label={text.searchLabel} className="w-full">
              <form aria-label={text.searchLabel} onSubmit={submit} className="w-full">
                <label htmlFor="aphrody-home-search" className="sr-only">
                  {text.search}
                </label>
                <div className="flex min-h-16 items-center gap-3 rounded-full bg-surface-container-high px-5 shadow-sm ring-1 ring-outline-variant focus-within:ring-2 focus-within:ring-primary">
                  <span className="material-symbol text-2xl text-on-surface-variant" aria-hidden="true">
                    search
                  </span>
                  <input
                    id="aphrody-home-search"
                    type="search"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    required
                    placeholder={text.search}
                    autoComplete="off"
                    className="min-w-0 flex-1 bg-transparent py-4 text-body-large text-on-surface outline-none"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    aria-label={busy ? text.searching : text.action}
                    className="flex min-h-12 min-w-12 items-center justify-center rounded-full bg-primary text-on-primary disabled:opacity-50"
                  >
                    <span className="material-symbol" aria-hidden="true">
                      {busy ? "hourglass_top" : "arrow_forward"}
                    </span>
                  </button>
                </div>
              </form>
            </search>
            <p className="mt-4 text-body-small text-on-surface-variant">{text.privacy}</p>
          </>
        )}
        <label className="mt-4 flex items-center gap-2 text-body-small">
          {text.language}
          <select
            value={language}
            onChange={event => setLanguage(event.target.value === "en" ? "en" : "fr")}
            className="rounded-lg bg-surface-container p-2"
          >
            <option value="fr">{text.french}</option>
            <option value="en">{text.english}</option>
          </select>
        </label>
        <Link
          to="/os"
          className="mt-6 min-h-12 content-center rounded-full bg-primary px-6 text-label-large text-on-primary"
        >
          {text.os}
        </Link>
        <div className="mt-7" aria-hidden="true">
          <AphrodyPet atlasUrl={publicPetAtlas(PET_ATLAS_URL, assetBase)} height={80} label={text.pet} />
        </div>
      </section>
      <section aria-live="polite" aria-busy={busy} className="mx-auto w-full max-w-3xl px-5 sm:px-8">
        {failed && (
          <div role="alert" className="mb-8 rounded-extra-large bg-error-container p-5 text-on-error-container">
            <p>{text.unavailable}</p>
            <button type="button" disabled={busy} onClick={() => void run()} className="mt-3 min-h-12 underline">
              {text.retry}
            </button>
            <Link to="/docs" className="ml-5 min-h-12 content-center underline">
              {text.docs}
            </Link>
          </div>
        )}
        {page && (
          <div className="pb-10 text-left">
            <h2 className="text-title-large">
              {text.results} {page.query}
            </h2>
            {page.correctedQuery && (
              <p className="mt-2 text-on-surface-variant">
                {text.correction} {page.correctedQuery}
              </p>
            )}
            {page.organic.length === 0 && <p className="mt-4">{text.empty}</p>}
            <ol className="mt-6 flex flex-col gap-6">
              {page.organic.map(hit => (
                <li key={hit.url + hit.title}>
                  <p className="truncate text-body-small text-on-surface-variant">{hit.url}</p>
                  <a
                    href={hit.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-title-large text-primary underline"
                  >
                    {hit.title || hit.url}
                  </a>
                  <p className="mt-1 text-body-medium">{hit.snippet}</p>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>
      <footer className="bg-surface-container-low px-5 py-6">
        <nav
          aria-label={text.resources}
          className="mx-auto flex max-w-6xl flex-wrap justify-center gap-x-5 gap-y-2 text-label-large"
        >
          <Link className="min-h-12 content-center underline" to="/docs">
            {text.docs}
          </Link>
          <Link className="min-h-12 content-center underline" to="/templates">
            {text.templates}
          </Link>
          <Link className="min-h-12 content-center underline" to="/material-3/components">
            {text.material}
          </Link>
          <Link className="min-h-12 content-center underline" to="/os">
            {text.files}
          </Link>
          <a className="min-h-12 content-center underline" href="https://downloads.aphrody.com/">
            {text.downloads}
          </a>
          {!usesBrowserBackend() && (
            <Link className="min-h-12 content-center underline" to="/studio">
              {text.studio}
            </Link>
          )}
        </nav>
      </footer>
    </article>
  );
}
