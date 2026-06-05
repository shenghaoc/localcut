# Code Review Policy

Applies to **all review agents** (Claude, Gemini, Kiro, Codex).

## Review Process

1. Read **all** changed files in full.
2. Cross-reference automated review comments — note resolved vs open issues.
3. Trace consumers when message protocols or shared buffer layouts change.
4. Verify CSS selectors match actual SolidJS DOM hierarchy.
5. Scan for dead code and leaked `VideoFrame`s.

## What to Check

Severities map to Codex priorities for PR reviews: **critical → P0**, **high → P1** (GitHub surfaces only P0/P1). See [AGENTS.md → Review guidelines](../../AGENTS.md#review-guidelines) for the priority-classified checklist.

**Architecture (hard gates — violation blocks merge)**

- Media decode/encode/GPU work on main thread — **critical**
- `getImageData`, Canvas2D readback, or CPU pixel paths in preview/export hot path — **critical**
- Per-frame `postMessage` for playback clock instead of SAB — **critical**
- Missing COOP/COEP or `crossOriginIsolated` check — **critical**
- Multiple `queue.submit` per frame for effect chain (Phase 4+) — **high**
- `VideoFrame` not `.close()`d — **high**
- `importExternalTexture` cached across frames — **high**
- Server runtime, external API calls, or cloud dependencies — **critical** (v1 non-goal)
- `yarn.lock`, `pnpm-lock.yaml`, or `bun.lock` present — **critical**

**Performance**

- Unbounded frame queues without `encodeQueueSize` backpressure (export)
- Frame cache without LRU eviction and `.close()` on evicted frames
- Effect chain run twice for preview vs export (must share one processed texture)

**SolidJS / UI**

- Media objects or WebGPU handles in `src/ui/`
- Unstable references causing unnecessary re-renders in rAF clock loop
- Missing `onCleanup` for rAF / event listeners

**Tests**

- Timeline model, seek logic, protocol types: unit tests expected for non-trivial changes
- No tests that mock away the architectural invariant being verified

## Output Format

- **Overview** — approach and soundness.
- **Automated Review Status** — resolved vs open bot findings.
- **Issues Found** — severity, `file:line`, impact, fix.
- **Positives** — what the PR does well.
- **Summary** — two to three sentences.

## Platform-Specific Review Tooling

- **Claude**: `@claude review` PR comment.
- **Kiro**: review hooks configured in `.kiro/`.
- **Gemini / Codex**: `/gemini review`, `@codex review`.
