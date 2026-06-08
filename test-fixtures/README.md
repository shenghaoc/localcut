# Test Fixture Matrix

Fixtures for integration tests and manual smoke tests. All fixtures are client-side; no server processing, external APIs, or cloud storage required.

## Required CI fixtures

Generated deterministically via scripts in this directory. Run `./generate-fixtures.sh` to recreate.

| Fixture          | Type        | Purpose                           | Generation   |
| ---------------- | ----------- | --------------------------------- | ------------ |
| `tiny-h264.mp4`  | Video+Audio | H.264/AAC import-edit-export path | ffmpeg lavfi |
| `tiny-vp9.webm`  | Video+Audio | VP9/Opus container variant        | ffmpeg lavfi |
| `still-720p.png` | Still image | Still/title/composite path        | ffmpeg lavfi |
| `tone-48k.wav`   | Audio-only  | Audio-only import and waveform    | ffmpeg lavfi |

## Mocked scenarios (unit tests)

These are tested via mocked objects in Vitest, not media files:

| Scenario                     | Test file                                           |
| ---------------------------- | --------------------------------------------------- |
| Worker crash                 | `src/engine/worker-restart.test.ts`                 |
| GPU device lost              | `src/engine/gpu-recovery.test.ts`                   |
| GPU unavailable (no adapter) | `src/engine/gpu-recovery.test.ts`                   |
| Quota exceeded               | `src/engine/storage-cleanup.test.ts`                |
| Export failure               | `src/diagnostics/import-export-diagnostics.test.ts` |
| Import failure               | `src/diagnostics/import-export-diagnostics.test.ts` |
| Offline/relink source        | `src/engine/project.test.ts`                        |

## Optional / manual fixtures

These require specific hardware or browser features and are skipped with explicit capability reasons when unavailable:

| Fixture         | Requirement           | Skip reason                |
| --------------- | --------------------- | -------------------------- |
| HDR/HLG content | GPU with HDR support  | `webgpu.hdr_unsupported`   |
| ProRes source   | Container support     | `import.unsupported_codec` |
| 4K+ source      | Sufficient GPU memory | `gpu.memory_insufficient`  |

## Capability-aware skip reporting

Tests that require specific capabilities use skip reasons from the diagnostics system:

```typescript
const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator;
it.skipIf(!hasWebGPU)('GPU composite test', () => { ... });
```

Skip reasons correspond to diagnostic codes in `src/diagnostics/types.ts`.

## Validation criteria

- Generated fixtures must be deterministic (same content on every run).
- Fixtures stay under 100 KB each.
- Video fixtures: 1 second, 320x240 or smaller.
- Audio fixtures: 1 second, mono or stereo, 48 kHz.
- All fixtures use open codecs or universally-supported codecs (H.264 Baseline, VP9, PNG, WAV).
