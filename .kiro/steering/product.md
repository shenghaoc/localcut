# Product Purpose

## Vision

A browser-native non-linear video editor (NLE) that feels close to a desktop editor for common creator projects: fast import, responsive preview, confident timeline editing, and reliable export without installing desktop software. The product should use the strongest browser APIs available on each user's machine because server-side media compute is not in the budget; Cloudflare is for hosting the static PWA and headers, not processing video.

## Target Users

Mid-tier creators (YouTube, short documentary, corporate training) who need cuts, clip reordering, transitions, colour correction, text overlays, multi-track audio mixing, and MP4 export without installing desktop software.

## Key Principles

1. **Performance is the product** — the accelerated path should use WebCodecs, WebGPU, workers, `SharedArrayBuffer`, and hardware adaptation wherever they materially improve the editing loop.
2. **Task completion beats architectural purity** — if a controlled compatibility path lets more users import, cut, preview, or export successfully, it is allowed when it is explicit, measured, and clearly labeled.
3. **Client-compute-first by necessity** — editing and export run on the user's CPU/GPU in their browser. Server-side decode, effects, encode, proxy generation, or storage are out of scope for v1.
4. **Honest hardware adaptation** — capability tiers, proxy preview resolution, throughput probes, and quality/speed export presets should explain what the user's machine can do instead of freezing or failing silently.
5. **Desktop-class first, broader access second** — optimize for desktop Chromium first, but do not encode "Chrome-only" as a product belief when another browser can support a reduced but useful workflow.

## Non-Goals (v1)

- Required accounts, required cloud sync, telemetry, paid server compute, or server-side processing for core editing
- Phone-first/touch-first editing, plugin marketplace, multi-user collaboration
- Pretending every browser can run the accelerated engine; limited modes must be labeled
