# Tasks: Phase 13 — Transitions

> Status: **Implementation complete — manual verification (T5.1) pending**. Model + validation first; decode readahead and the mix pass build on Phase 12's encoder.

## Model

- [x] **T1.1** Add the `transitions[]` list (`{ id, trackId, fromClipId, toClipId, durationS, kind, params }`) beside the tracks; persist via Phase 9.
- [x] **T1.2** Placement validation: adjacency + `durationS / 2` source headroom per side, reusing trim's source-bounds logic.
- [x] **T1.3** Re-validate on every edit; drop transitions whose neighbours separate or disappear.
- [x] **T1.4** Unit-test placement, clamping, and survival/drop across trim/move/delete.

## Readahead

- [x] **T2.1** Extend `resolveAllAt` to report `{ outgoing, incoming, mixT }` inside transition windows.
- [x] **T2.2** Decode both clips through the frame cache; open a second sink when both share one source.

## Mix pass

- [x] **T3.1** Add `transition-mix.wgsl` (+ `.f16`) parameterized by kind + `mixT`; swap in for the over-blend on the transition pair inside `compositeLayers`.
- [x] **T3.2** Keep the submission counter at one per frame through transition windows (test).

## UI + parity

- [x] **T4.1** Cut-point affordance + duration drag in the timeline; kind picker in the Inspector.
- [x] **T4.2** Commands `add-transition`/`remove-transition`/`set-transition`; `timeline-state` carries transitions.

## Verification

- [ ] **T5.1** Manual: dissolve, dip-to-black, wipe, slide between two clips; trim past the boundary drops the transition.
- [ ] **T5.2** Export parity: file matches preview through a transition; both frames close exactly once.
- [x] **T5.3** `npm run build` and `npm test` green; test count grows.
