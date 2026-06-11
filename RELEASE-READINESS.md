# Release Readiness Checklist

Generated from Phase 25 spec. Every item maps to a command, test, diagnostic panel state, or documented capability skip.

## Build and Test Gates

| Gate                       | Command                                | Status |
| -------------------------- | -------------------------------------- | ------ |
| TypeScript strict build    | `pnpm build`                           |        |
| Vitest suite               | `pnpm test`                            |        |
| Test count (no regression) | Compare `pnpm test` output to previous |        |

## Fixture Matrix

| Fixture               | Path                           | Validation                              |
| --------------------- | ------------------------------ | --------------------------------------- |
| H.264/AAC video+audio | `test-fixtures/tiny-h264.mp4`  | Import, timeline placement, export      |
| VP9/Opus video+audio  | `test-fixtures/tiny-vp9.webm`  | Import, timeline placement              |
| Still image           | `test-fixtures/still-720p.png` | Import, still duration, composite       |
| Audio-only            | `test-fixtures/tone-48k.wav`   | Import, waveform generation             |
| Title clip            | In-app "Add Title"             | Create, edit text, composite over video |

Generate fixtures: `cd test-fixtures && ./generate-fixtures.sh`

## Diagnostics Privacy

| Check                             | Method                                           |
| --------------------------------- | ------------------------------------------------ |
| No media bytes in report          | Open diagnostics, copy report, search for binary |
| No file names/paths               | Copy report, search for path separators          |
| No title/caption content          | Copy report, search for user text                |
| No raw project JSON               | Copy report, verify structured summary only      |
| No raw fingerprints               | Copy report, verify aliases only                 |
| Source aliases are session-stable | Copy twice, verify same aliases                  |

## Recovery Simulations

| Scenario                 | Procedure                                   | Expected                                                 |
| ------------------------ | ------------------------------------------- | -------------------------------------------------------- |
| Worker crash             | Simulate via devtools worker termination    | Shell stays mounted, auto-restart, restore from autosave |
| GPU device lost          | Simulate via `device.destroy()` in devtools | Preview pauses, error recorded, retry available          |
| GPU unavailable          | Test in browser without WebGPU              | Limited mode with clear message                          |
| Audio init failure       | Block AudioContext autoplay                 | Editor usable, retry action shown                        |
| Storage quota exceeded   | Fill quota via devtools                     | Cleanup dialog available, project preserved              |
| Import failure (corrupt) | Import non-media file                       | Error with specific code, project unchanged              |
| Export failure           | Cancel mid-export                           | Settings preserved, retry available                      |
| Permission loss          | Revoke file handle permission               | Offline marker, re-pick available                        |

## Performance Budgets

| Metric                 | Target        | Warning | Breach |
| ---------------------- | ------------- | ------- | ------ |
| GPU submits/frame      | 1             | 2       | 3+     |
| Dropped preview frames | <5%           | <10%    | >25%   |
| Export throughput      | >=1x realtime | >=0.5x  | <0.25x |
| Decode queue depth     | <=4 frames    | <=8     | >12    |
| Audio underruns/min    | 0             | <3      | >=10   |

## COOP/COEP Verification

| Environment                       | Check                                     |
| --------------------------------- | ----------------------------------------- |
| Dev (`pnpm dev`)                  | `crossOriginIsolated === true` in console |
| Production build (`pnpm preview`) | `crossOriginIsolated === true` in console |
| Cloudflare Pages                  | `public/_headers` sets COOP/COEP          |
| Missing isolation                 | Limited mode with actionable message      |

## Accessibility

| Area             | Keyboard test                                            |
| ---------------- | -------------------------------------------------------- |
| Import           | Tab to Import button, Enter to trigger                   |
| Timeline         | Arrow keys for selection, S for split, Delete for remove |
| Inspector        | Tab through fields, Enter to commit                      |
| Diagnostics      | Tab to open, Tab through sections, copy button           |
| Export queue     | Tab to retry/cancel buttons                              |
| Storage cleanup  | Tab through cleanup actions                              |
| Dialogs          | Escape to close, focus trap active                       |
| Recovery actions | Tab to action buttons in diagnostics                     |

## Blocker Classification

See `BLOCKER-CLASSIFICATION.md` for severity definitions.

## Manual Smoke Tests

### Full-tier (Chromium with WebGPU)

1. Open `http://localhost:5173`
2. Status bar shows "Pipeline ready - WebGPU"
3. Import `tiny-h264.mp4`
4. Play/pause/seek
5. Split clip, delete segment
6. Add title clip
7. Export with default settings
8. Open diagnostics, verify accelerated tier
9. Copy diagnostics report

### Limited-tier (non-isolated)

1. Open without COOP/COEP headers
2. Status bar shows "Limited shell"
3. Diagnostics shows specific missing capability
4. Shell stays alive and responsive
