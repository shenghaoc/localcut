# Design: In-app User Guide

This document maps each requirement in `requirements.md` to the concrete
changes and invariants the implementation protects. No new worker, message
type, or rendering pass is introduced.

## D1 — Content and manifest (R1)

`src/features/docs/content/*.md` — ten markdown files, one per section.

`src/features/docs/docsManifest.ts` — ordered `DOC_SECTIONS` array of
`DocSection` objects (`slug`, `title`, `content`). Content is imported via
Vite `?raw` suffix so it is inlined at build time with zero runtime fetches.
Helper functions:

| Function | Purpose |
|---|---|
| `findDocSection(slug)` | Lookup by slug; returns `null` for unknown slugs. |
| `docsPath(slug)` | Returns `/docs` for the index section, `/docs/<slug>` otherwise. |
| `parseDocsPath(pathname)` | Maps a pathname to a docs slug or `null`; unknown sub-paths normalise to the index slug. |

`docsManifest.test.ts` — unit tests for all three helpers including edge
cases (trailing slashes, unknown slugs, root path).

## D2 — Markdown pipeline (R2)

`src/features/docs/markdown.ts`

An isolated `DOMPurify` instance is created via the `DOMPurify()` factory
(the type's call signature returns a new instance). The
`afterSanitizeAttributes` hook is registered on this instance only, so it
does not affect other features using the global DOMPurify singleton.

`renderDocHtml(markdown)` pipeline: `marked.parse()` → `purify.sanitize()`.
The `EXTERNAL_LINK_PATTERN` regex (`/^(https?:)?\/\//i`) distinguishes
external links from in-app `/docs/...` links.

## D3 — Routing in App (R3, R4)

`src/ui/App.tsx`

A `docsSlug` signal initialised from `parseDocsPath(window.location.pathname)`
on mount. A `popstate` listener keeps it in sync with back/forward navigation.

| Function | Behaviour |
|---|---|
| `openDocs(slug)` | Captures `document.activeElement` for return focus; pushes history state; sets `docsSlug`. |
| `closeDocs()` | Pushes `/` to history if currently on a docs path; sets `docsSlug` to `null`; restores focus to `docsReturnFocus`. |

The app shell `<div>` uses Solid's declarative `inert={docsSlug() !== null}`
attribute — no manual ref or `createEffect` needed.

Editor keyboard shortcuts (registered via `useKeyboard`) are gated on
`enabled: () => docsSlug() === null`.

## D4 — DocsPage (R4.5)

`src/features/docs/DocsPage.tsx`

`originalTitle` is captured synchronously at component instantiation
(`typeof document !== 'undefined' ? document.title : ''`). On cleanup,
`document.title` is restored to `originalTitle || 'LocalCut Studio'` — this
preserves any dynamic title the editor set (e.g. an active project name).

`Escape` keydown on the section element calls `props.onClose()`.

## D5 — DocsNav and DocsArticle (R5)

`src/features/docs/DocsNav.tsx` — renders a `<nav>` with an ordered list of
section links. The active section is highlighted via `aria-current="page"`.

`src/features/docs/DocsArticle.tsx` — renders the sanitised HTML via
`innerHTML`. A `createEffect` on `section.slug` resets `scrollTop` and calls
`focus()` on the article element when the section changes. A click handler
intercepts in-app `/docs/...` links (checking `parseDocsPath`) and calls
`onNavigate` instead of allowing a full navigation.

## D6 — Contextual links (R5.4)

Existing editor components gain `onClick` handlers that call `openDocs()`
with the appropriate section slug:

| Component | Trigger | Section |
|---|---|---|
| `Toolbar` | Help chip | `DOCS_INDEX_SLUG` |
| `ExportDialog` | "Exporting" link | `'exporting'` |
| `CapabilityPanel` | "Browser limitations" link | `'browser-limitations'` |
| `DiagnosticsPanel` | "Performance" link | `'performance'` |
| Source-health banner | "Importing media" link | `'importing-media'` |
| Empty preview states | "Getting started" / "Browser limitations" | `'getting-started'` / `'browser-limitations'` |
| `PublishPanel` | Guide link | `'live-streaming'` |

## D7 — Cloudflare deploy (R3.4)

`wrangler.jsonc` — `assets.not_found_handling = "single-page-application"`
added so docs deep links survive refresh. `public/_headers` unchanged;
COOP/COEP headers still apply.

## D8 — CSS (R4, R5)

`src/global.css` — new classes for the guide layout and typography:

| Class | Purpose |
|---|---|
| `.docs-page` | Full-screen overlay container; fixed position, z-index above editor |
| `.docs-header` | Fixed top bar with back button and title |
| `.docs-header-title` | "User Guide" label in the header |
| `.docs-body` | Flex container splitting nav sidebar and article content |
| `.docs-nav` | Sidebar navigation with ordered section links |
| `.docs-nav-item` | Individual nav link; `.is-active` highlights the current section |
| `.docs-article` | Content area with `innerHTML` rendering; typography rules for `h1`–`h3`, `p`, `ul`/`ol`/`li`, `strong`, `a`, `code`, `pre`, `hr`, `table`/`th`/`td` |

Responsive `@media (max-width: 720px)` rules collapse `.docs-body` to a
single column and hide the nav sidebar. Dark professional-tool aesthetic
matches the editor's design tokens.

## D9 — Removed

`src/ui/HelpPanel.tsx` and `src/ui/markdown.ts` are deleted — the modal
HelpPanel and its hand-rolled markdown renderer are fully replaced by the
new docs feature.
