# Tasks: Phase 4 — WebGPU Compute Effect Chain

> Status: **Planned**. Execution order respects dependencies.

## Shaders

- [ ] **T1.1** `shaders/brightness-contrast.wgsl` + `.f16.wgsl`.
- [ ] **T1.2** `shaders/saturation.wgsl` + `.f16.wgsl`.
- [ ] **T1.3** `shaders/colour-temperature.wgsl` (+ f16 if precision allows).

## Registry + GPU

- [ ] **T2.1** `effects.ts` — registry entries (shader, uniform layout, defaults); compile pipelines once.
- [ ] **T2.2** `gpu.ts` — storage textures A/B/C; f16/f32 variant selection at device acquisition.
- [ ] **T2.3** `effects.ts` — per-frame encoder builder chaining active effects into ONE submission.

## Parameters

- [ ] **T3.1** `timeline.ts` — per-clip effect assignments + parameter values.
- [ ] **T3.2** `protocol.ts` — `set-effect-param` command; worker updates uniforms without recompile.
- [ ] **T3.3** `Inspector.tsx` — sliders for the three effects; debounced param-update commands.

## Single submission

- [ ] **T4.1** Verify exactly one `queue.submit` per frame for the chain (timestamp queries / counter).
- [ ] **T4.2** Confirm preview present and export path consume the same processed texture.

## Verification

- [ ] **T5.1** Manual: adjust 3 effects per clip; 1080p30 preview stays smooth.
- [ ] **T5.2** f16 device → f16 shaders; non-f16 device → f32 fallback, same result.
- [ ] **T5.3** `npm run build` and `npm test` green.
