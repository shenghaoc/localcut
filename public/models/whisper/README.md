# Whisper model assets (Phase 29 — Auto Captions)

Auto Captions transcribes selected audio with [OpenAI Whisper](https://github.com/openai/whisper)
run by [LiteRT.js](https://www.npmjs.com/package/@litertjs/core) on WebGPU/WASM.
Two models ship: the default
[`litert-community/whisper-base`](https://huggingface.co/litert-community/whisper-base)
(`manifest.json`, ~290 MB, better accuracy) and the smaller, faster
[`litert-community/whisper-tiny`](https://huggingface.co/litert-community/whisper-tiny)
(`manifest-tiny.json`, ~151 MB) — each a single `.tflite` with `encode` and
`decode` signatures. The Auto Captions panel shows a picker; both can be
downloaded and kept at once (OPFS keys by SHA-256, so switching never
re-downloads).

**The model is fetched from Hugging Face at runtime — this app does not host or
bundle it.** It is pulled through a **same-origin Worker proxy** (`/_model/hf/…`,
see [`src/worker/index.ts`](../../../src/worker/index.ts)): the worker fetches the
model + tokenizer, verifies each against its SHA-256 digest, and caches them in
OPFS — all only after the user clicks **Load model**.

Why a proxy rather than a direct browser fetch: the app is cross-origin isolated
(`COEP: require-corp`, for `SharedArrayBuffer`), and Hugging Face's file CDN does
**not** return `Access-Control-Allow-Origin` for arbitrary deployed origins, so a
direct cross-origin `fetch()` is CORS-blocked. The Cloudflare Worker fetches the
file from Hugging Face server-side (no browser CORS) and streams it back
same-origin. The model still lives on Hugging Face; the Worker only relays the
bytes (egress through your Worker, no storage), and the 25 MB Workers static-asset
limit doesn't apply to streamed responses.

## What lives here

| File                 | Tracked in git? | Purpose                                                                                                                                                           |
| -------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.json`      | ✅ yes          | **Whisper Base** (default). Declares the model + tokenizer (same-origin `/_model/hf/…` proxy URLs, sizes, SHA-256 digests), audio contract, token ids, languages. |
| `manifest-tiny.json` | ✅ yes          | **Whisper Tiny** (smaller/faster). Same schema, pinned to the tiny `.tflite`; shares the byte-identical vocab digest so OPFS caches one tokenizer copy.           |

No model binaries are committed or downloaded into this directory. The manifest
pins exact bytes by SHA-256, so the integrity check refuses any asset whose bytes
do not match — and if HF is unreachable, **Load model** fails gracefully while the
rest of the app keeps working.

## Setup

Only the LiteRT WASM **runtime** (not the model) is served same-origin — vendor it
once per checkout from the pinned npm package:

```bash
pnpm setup:litert   # copies @litertjs/core/wasm/* → public/litert/
```

Then, in the built app, **Load model** downloads the Whisper model from Hugging
Face once; it is cached in OPFS and reused offline — the network is touched at
most once per model.

### Hosting a model elsewhere

To serve a model from somewhere other than Hugging Face, point the manifest's
asset URLs at any host on the allowlist (`ASR_TRUSTED_MODEL_HOSTS` in
`src/engine/asr/model-catalog.ts` — Hugging Face, Kaggle / `storage.googleapis.com`,
GitHub) over HTTPS with CORS, and set each asset's real `sizeBytes` and
`sha256-…` digest (`shasum -a 256 <file>`), keeping the top-level `sizeBytes`
equal to the sum and the `tokens` ids matching the model's vocabulary.

> **Dev-server limitation.** LiteRT.js loads its WASM via `importScripts`, so the
> ASR worker is a **classic** worker. Vite bundles classic workers correctly in
> the production build but serves them as ESM in `pnpm dev`, where they fail to
> load. Test Auto Captions against the built app (`pnpm build`, then serve `dist/`
> with COOP/COEP headers — or `pnpm preview`), not `pnpm dev`.
>
> Only the small LiteRT WASM runtime is served same-origin (well under any static
> host's per-file cap); the models (Base ~290 MB, Tiny ~151 MB) live on Hugging
> Face, so the app's own Cloudflare Workers deploy never hosts large binaries.

## Model catalog & trusted hosts

The Auto Captions panel lists selectable models from
[`src/engine/asr/model-catalog.ts`](../../../src/engine/asr/model-catalog.ts) and
links each one's model card via "Learn more". To add a model, append a catalog
entry (id, name, description, provider, `infoUrl`, license, `manifestUrl`) and
publish its manifest + assets.

Model assets run as code (LiteRT-compiled TFLite graphs), so the loader fetches
them **only from this app's own origin or an allowlisted host** —
`ASR_TRUSTED_MODEL_HOSTS` in the same file (Hugging Face + its Xet/LFS CDNs,
Kaggle / Google AI Edge via `storage.googleapis.com`, and GitHub). A manifest
pointing anywhere else is refused before any byte is fetched.

### Cross-origin isolation (COEP) — why the default uses a proxy

The app is cross-origin isolated (`COOP: same-origin` + `COEP: require-corp`, for
`SharedArrayBuffer`). A cross-origin model fetch therefore only works if the host
returns a valid CORS response (a CORS response satisfies `require-corp` without
needing CORP; the loader always uses `mode: 'cors'`, never `no-cors`).

Hugging Face's signed file CDN does **not** reliably send `Access-Control-Allow-Origin`
for arbitrary deployed origins — a direct `fetch()` is CORS-blocked in production
(it happens to succeed from `localhost`, which is misleading). So the default
model is pulled through the **same-origin Worker proxy** (`/_model/hf/…`,
`src/worker/index.ts`), which fetches HF server-side and streams it back
same-origin — sidestepping CORS and COEP entirely.

- A host that _does_ send permissive CORS (e.g. an R2 bucket / `storage.googleapis.com`
  bucket with CORS enabled, on the allowlist) can be pointed at directly without
  the proxy.
- **Don't** switch the page to `COEP: credentialless` to "fix" CORS — it isn't
  needed and Safari doesn't support it (would break `crossOriginIsolated` there).
- Avoid GitHub _release_ assets — they send neither CORS nor CORP and are
  unusable here.

## Security & licensing

- Assets are **digest-pinned**: the SHA-256 + size check rejects any wrong or
  tampered file regardless of where it came from, and the host allowlist pins
  _where_ they may come from. Same-origin hosting additionally keeps the download
  private; an allowlisted remote host trades that privacy for convenience but not
  integrity.
- Record the model's real license and source in `manifest.json` and its catalog
  entry — they are shown in the Auto Captions panel.
