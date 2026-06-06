# Tasks: Phase 9 — Project Persistence + Undo/Redo

> Status: **Active**. Land serialization first; history and autosave build on it; re-linking last.

## Serialization

- [ ] **T1.1** Add `src/engine/project.ts` with `ProjectDoc`/`SourceDescriptor` types and pure `serializeProject`/`deserializeProject`.
- [ ] **T1.2** Gate deserialization on `schemaVersion` with explicit upgrade/reject paths.
- [ ] **T1.3** Unit-test round-trip and version handling.

## History

- [ ] **T2.1** Add `src/engine/history.ts`: bounded snapshot stack, `canUndo`/`canRedo`, coalesce predicate keyed `(clipId, key)`.
- [ ] **T2.2** Push pre-edit snapshots at every worker mutation site; handle `undo`/`redo` commands and emit `history-state`.
- [ ] **T2.3** Coalesce `set-effect-param` bursts to match the Inspector's 80ms debounce.
- [ ] **T2.4** Unit-test push/undo/redo, the cap, and coalescing.

## Autosave + restore

- [ ] **T3.1** Add `src/engine/persistence.ts`: native IndexedDB stores for the project doc and per-source `File`/handle.
- [ ] **T3.2** Debounced autosave after each mutation; restore attempt on `init` emitting `restore-available` with descriptors.

## Re-linking

- [ ] **T4.1** Store `File` blobs (and handles where available) per source at import; silent re-attach tier on restore.
- [ ] **T4.2** `requestPermission` re-grant tier; extend the `FileSystemFileHandle` typing.
- [ ] **T4.3** Re-pick tier: `relink-source` matching by name + size + duration, flagging mismatches; mark unresolved clips offline.

## UI

- [ ] **T5.1** Undo/redo toolbar buttons + Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z wired to the new commands.
- [ ] **T5.2** Restore banner listing unresolved sources with a re-pick affordance.

## Verification

- [ ] **T6.1** Reload restores the project in Chromium without re-picking files.
- [ ] **T6.2** Undo storm leaves the model consistent; no `VideoFrame` leak.
- [ ] **T6.3** `npm run build` and `npm test` green; test count does not decrease.
