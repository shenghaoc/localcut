# Product Purpose

## Vision

A fully client-side, open-source, browser-based non-linear video editor (NLE) targeting 1080p content under 10 minutes, engineered for blazing performance. Zero server involvement — all work runs locally in the browser.

## Target Users

Mid-tier creators (YouTube, short documentary, corporate training) who need cuts, clip reordering, transitions, colour correction, text overlays, multi-track audio mixing, and MP4 export without installing desktop software.

## Key Principles

1. **Performance is the product** — threading, zero-copy GPU paths, and hardware adaptation are core engineering value, not optional optimizations.
2. **Fully local** — no accounts, cloud sync, telemetry, or server-side processing in v1.
3. **Honest hardware adaptation** — proxy preview resolution, throughput probes, and quality/speed export presets respect slow machines instead of freezing the UI.
4. **Desktop browsers only** — no mobile/touch editing in v1; 1080p max (4K is a future goal).

## Non-Goals (v1)

- Accounts, auth, cloud sync, AI content generation
- Mobile/touch editing, 4K, plugin system
- CPU fallback effect path (WebGPU required; detect and inform)
