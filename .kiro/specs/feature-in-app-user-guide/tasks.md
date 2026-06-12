# Tasks: In-app User Guide

> Status: **Active**. Tasks map to the requirements in `requirements.md` and
> the design in `design.md`. Tracks the work on
> `claude/in-app-user-guide-e15egk` (PR #85).

## T1 — Content files (R1)

- [x] **T1.1** Create `src/features/docs/content/` directory with ten markdown files: `index.md`, `getting-started.md`, `importing-media.md`, `timeline-editing.md`, `exporting.md`, `live-streaming.md`, `browser-limitations.md`, `performance.md`, `troubleshooting.md`, `faq.md`.
- [x] **T1.2** Each file covers its topic with accurate, user-facing documentation referencing the current editor capabilities.

## T2 — Manifest and routing helpers (R1, R3)

- [x] **T2.1** Create `src/features/docs/docsManifest.ts` with `DocSection` interface, `DOC_SECTIONS` array, and `DOCS_BASE_PATH`/`DOCS_INDEX_SLUG` constants.
- [x] **T2.2** Implement `findDocSection(slug)`, `docsPath(slug)`, and `parseDocsPath(pathname)`.
- [x] **T2.3** Create `src/features/docs/docsManifest.test.ts` with unit tests for all helpers including edge cases.

## T3 — Markdown pipeline (R2)

- [x] **T3.1** Create `src/features/docs/markdown.ts` with an isolated `DOMPurify()` instance and `afterSanitizeAttributes` hook for external links.
- [x] **T3.2** Implement `renderDocHtml(markdown)` pipeline: `marked` (GFM, sync) → `purify.sanitize()`.

## T4 — Solid components (R4, R5)

- [x] **T4.1** Create `src/features/docs/DocsPage.tsx` with `originalTitle` capture, `Escape` handling, and section title effect.
- [x] **T4.2** Create `src/features/docs/DocsNav.tsx` with ordered section list and `aria-current="page"`.
- [x] **T4.3** Create `src/features/docs/DocsArticle.tsx` with `innerHTML` rendering, scroll reset on section change, and in-app link interception.

## T5 — Routing in App (R3, R4)

- [x] **T5.1** Add `docsSlug` signal initialised from `parseDocsPath(window.location.pathname)`.
- [x] **T5.2** Implement `openDocs(slug)` with return-focus capture and `pushState`.
- [x] **T5.3** Implement `closeDocs()` with focus restoration and history cleanup.
- [x] **T5.4** Add `popstate` listener to keep `docsSlug` in sync.
- [x] **T5.5** Gate editor keyboard shortcuts on `docsSlug() === null`.
- [x] **T5.6** Use declarative `inert={docsSlug() !== null}` on the app shell div.

## T6 — Contextual links (R5.4)

- [x] **T6.1** Toolbar Help chip opens `/docs` (index section).
- [x] **T6.2** Export dialog links to Exporting section.
- [x] **T6.3** Capability panel links to Browser limitations section.
- [x] **T6.4** Diagnostics panel performance budgets link to Performance section.
- [x] **T6.5** Source-health banner links to Importing media section.
- [x] **T6.6** Empty preview states link to Getting started or Browser limitations.
- [x] **T6.7** Publish panel guide opens Live streaming section.

## T7 — Cloudflare deploy (R3.4)

- [x] **T7.1** Add `assets.not_found_handling = "single-page-application"` to `wrangler.jsonc`.

## T8 — CSS (R4, R5)

- [x] **T8.1** Add `.docs-page`, `.docs-header`, `.docs-header-title`, `.docs-body`, `.docs-nav`, `.docs-nav-item` (+ `.is-active`), and `.docs-article` styles in `global.css`.
- [x] **T8.2** Add `.docs-article` typography rules for `h1`–`h3`, `p`, `ul`/`ol`/`li`, `strong`, `a`, `code`, `pre`, `hr`, `table`/`th`/`td`.
- [x] **T8.3** Add responsive `@media (max-width: 720px)` rules for single-column layout.
- [x] **T8.4** Dark professional-tool aesthetic matching the editor.

## T9 — Remove legacy HelpPanel (D9)

- [x] **T9.1** Delete `src/ui/HelpPanel.tsx`.
- [x] **T9.2** Delete `src/ui/markdown.ts`.
- [x] **T9.3** Remove all HelpPanel imports and references from `App.tsx`.

## T10 — Review fixes (Gemini round 1)

- [x] **T10.1** Use `DOMPurify()` factory for an isolated instance instead of mutating the global singleton with `addHook`.
- [x] **T10.2** Capture `document.title` synchronously in `DocsPage` and restore on cleanup, instead of hardcoding `'LocalCut Studio'`.
- [x] **T10.3** Replace manual `appShellRef` + `createEffect` inert management with Solid's declarative `inert` attribute.
- [x] **T10.4** Use `classList` for conditional `'is-dragging-file'` class on the app shell div.

## T11 — Quality gate

- [x] **T11.1** `pnpm run format:check` passes.
- [x] **T11.2** `pnpm run lint` passes (no new errors; pre-existing warnings only).
- [x] **T11.3** `pnpm run typecheck` passes (strict TypeScript).
- [x] **T11.4** `pnpm run test` passes — 98 files, 1049 tests green (1 pre-existing flaky fuzz test unrelated to this PR).
- [x] **T11.5** `pnpm run build` passes (production build).
