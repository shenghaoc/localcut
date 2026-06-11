# Security

## Browser Security Model

The app operates entirely within the browser security sandbox — there is no backend, no server-side session, and no user account. The attack surface is primarily:

1. **Malformed media files** — handled by Mediabunny and browser WebCodecs; do not pass file bytes to `eval` or inject file-derived strings into the DOM.
2. **Cross-origin resource loading** — COOP/COEP headers are load-bearing; do not relax them.
3. **DOM injection** — no user-supplied content is ever set via `innerHTML` or `dangerouslySetInnerHTML`; use text nodes or SolidJS JSX.

## COOP/COEP Headers (Required)

`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` must be present on every response — both in Vite dev/preview config and in `public/_headers` for Cloudflare Pages. Removing or weakening these headers breaks `SharedArrayBuffer` and silently degrades the accelerated engine tier.

Never load third-party iframes, third-party scripts, or cross-origin media assets unless they carry the correct `Cross-Origin-Resource-Policy` header. If a future dependency requires relaxed isolation, it must use an explicit compatibility-tier design rather than removing COOP/COEP globally.

## Content Security Policy

Add a strict CSP to `public/_headers` as soon as third-party dependencies are introduced. Until then, the default COOP/COEP posture is the primary isolation mechanism. Avoid `eval`, `new Function`, and dynamic `<script>` injection — Vite's production build never requires them.

## File Handling

- Use the **File System Access API** (`showOpenFilePicker`) or drag-and-drop `dataTransfer.files`; never construct a URL from a user-supplied string and `fetch` it.
- `BlobSource` from Mediabunny is the correct handle for lazy disk reads; do not buffer entire files in memory.
- Do not expose raw `FileSystemFileHandle` references outside the `src/engine/` boundary.

## No Secrets in Source

Do not store API keys, credentials, internal service URLs, or proprietary algorithms in source files, `.kiro/` steering, or environment variables checked into the repo. The app has no server component that needs secrets; any future Cloudflare Worker integration must use Cloudflare Secrets (not `wrangler.toml` plain-text vars).

## Dependency Management

- **pnpm only** — `pnpm-lock.yaml` is the lockfile; no alternative lockfiles.
- Pin major versions for media and GPU dependencies; audit new dependencies for browser compatibility and supply-chain risk before adding.
- Do not introduce dependencies that phone home, collect telemetry, or require a remote license check for core editing functionality.

## User Data

All user media remains on the user's device. Do not upload, proxy, or log file contents, file names, or editing metadata to any external service. Any future opt-in analytics must be clearly disclosed, disabled by default, and contain no media content.
