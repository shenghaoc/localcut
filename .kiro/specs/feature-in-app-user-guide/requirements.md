# Requirements: In-app User Guide

> Status: **Active**. Replaces the modal HelpPanel with a routed, user-facing
> guide at `/docs` bundled into the app. Tracks the work on
> `claude/in-app-user-guide-e15egk` (PR #85).

## R1 — Bundled markdown content

- **R1.1** The guide contains ten sections: Overview, Getting started, Importing media, Timeline editing, Exporting, Live streaming, Browser limitations, Performance, Troubleshooting, and FAQ.
- **R1.2** All markdown content is bundled at build time via Vite raw imports — nothing is fetched at runtime.
- **R1.3** Only bundled, repo-authored content is rendered; user-provided or remote markdown is never passed through the guide pipeline.
- **R1.4** Content lives in `src/features/docs/content/` as `.md` files and renders on GitHub as well as in-app.

## R2 — Markdown rendering and sanitisation

- **R2.1** Markdown is parsed with `marked` (GFM mode, synchronous) and sanitised with an isolated `DOMPurify` instance before `innerHTML` assignment.
- **R2.2** The DOMPurify instance is created via `DOMPurify()` factory so that the `afterSanitizeAttributes` hook does not leak into other features using the global DOMPurify singleton.
- **R2.3** External links (`http://`, `https://`, `//`) receive `target="_blank" rel="noopener noreferrer"` during sanitisation.
- **R2.4** In-app `/docs/...` links keep their plain `href` so `DocsArticle` can intercept them for history-based navigation.

## R3 — History-backed routing

- **R3.1** `/docs` and `/docs/<section>` work on initial load, page refresh, and browser back/forward via `pushState` + `popstate`.
- **R3.2** No router library dependency — routing uses lightweight `pushState`/`popstate` handling in `App`.
- **R3.3** Unknown sub-paths normalise to the index section so stale deep links land in the guide instead of a dead end.
- **R3.4** Cloudflare deploy: `assets.not_found_handling = "single-page-application"` in `wrangler.jsonc` so docs deep links survive refresh; COOP/COEP headers still apply via `public/_headers`.

## R4 — Editor coexistence

- **R4.1** The editor stays mounted underneath the guide (worker, timeline, autosave all keep running).
- **R4.2** The editor shell is marked `inert` while the guide is open, using Solid's declarative `inert` attribute.
- **R4.3** Editor keyboard shortcuts are suspended while the guide is open.
- **R4.4** `Escape` closes the guide and returns focus to the previously focused element in the editor.
- **R4.5** The document title is captured synchronously when `DocsPage` mounts and restored on cleanup, preserving any dynamic title the editor had set (e.g. an active project name).

## R5 — Navigation and contextual links

- **R5.1** A `DocsNav` sidebar lists all sections with the active section highlighted.
- **R5.2** `DocsArticle` intercepts clicks on in-app `/docs/...` links and routes them via history navigation.
- **R5.3** Switching sections resets article scroll and moves focus to the article for keyboard and screen-reader users.
- **R5.4** Contextual links from the editor open the relevant guide section:
  - Toolbar Help chip → Overview
  - Export dialog → Exporting
  - Capability panel → Browser limitations
  - Diagnostics performance budgets → Performance
  - Source-health banner → Importing media
  - Empty preview states → Getting started or Browser limitations
  - Publish panel guide → Live streaming

## R6 — Testing

- **R6.1** Manifest and route unit tests cover `findDocSection`, `docsPath`, and `parseDocsPath`.
- **R6.2** The backend-readiness source assertion is made whitespace-tolerant.
