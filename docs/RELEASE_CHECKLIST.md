# LocalCut Studio — Release Checklist

Run this checklist before every release or deployment. All automated gates must pass before proceeding to manual verification.

## Automated Gates

Run all automated gates with a single command:

```bash
npm run verify
```

This runs the following in sequence (stops on first failure):

| # | Gate | Command | Passes When |
|---|------|---------|-------------|
| 1 | Lint | `npm run lint` | No ESLint errors or warnings |
| 2 | Format | `npm run format:check` | All files match Prettier formatting |
| 3 | Tests | `npm test` | All Vitest tests pass; test count has not decreased |
| 4 | Build | `npm run build` | TypeScript strict check passes; Vite production build succeeds |

## Local Preview

After automated gates pass:

```bash
npm run preview
```

1. Open `http://localhost:8787` (Wrangler local preview).
2. Verify `crossOriginIsolated === true` in the DevTools console.
3. Confirm the status bar shows the accelerated capability tier.

## Manual Smoke Test

Follow the full checklist in [VERIFY_DEPLOYMENT.md](VERIFY_DEPLOYMENT.md). At minimum:

- [ ] App loads without errors.
- [ ] COOP/COEP isolation is active.
- [ ] Import a test MP4 — clip appears in bin and on timeline.
- [ ] Play/pause/seek work with audio.
- [ ] Split a clip, delete a segment, undo.
- [ ] Export H.264 MP4 — output file is playable.
- [ ] Open Diagnostics — report copies successfully and contains no file names.
- [ ] Reload — project restores from autosave.

## Media Fixture Validation

For thorough validation, run through the fixture categories in [MEDIA_FIXTURES.md](MEDIA_FIXTURES.md):

- [ ] H.264/AAC MP4 (standard)
- [ ] iPhone MOV with rotation
- [ ] WebM VP9/Opus
- [ ] VFR screen recording
- [ ] Audio-only file
- [ ] Caption file (SRT or VTT)
- [ ] Unsupported/corrupt file (graceful error)

## Reduced-Tier Verification

- [ ] Open in a browser without WebGPU — app shows limited mode, no crash.
- [ ] Diagnostics shows specific missing capabilities.

## Pre-Deployment Checks

- [ ] `public/_headers` contains COOP/COEP headers.
- [ ] `wrangler.jsonc` deployment config is correct.
- [ ] No `.env` files, secrets, or credentials are included in `dist/`.
- [ ] Build output in `dist/` contains the service worker and PWA manifest.

## Deploy

```bash
npm run deploy
```

After deployment, verify the live URL using [VERIFY_DEPLOYMENT.md](VERIFY_DEPLOYMENT.md).

## Record Results

Document verification results with:
- Date
- Build SHA (from diagnostics report)
- Browser and OS used for smoke test
- Pass/fail for each gate
- Notes on any issues found
