# Requirements: Phase 9 — Project Persistence + Undo/Redo

## R1 — Project Serialization

- **R1.1** Serialize the timeline and per-source descriptors into a versioned `ProjectDoc` JSON document (`schemaVersion`, project id, timeline snapshot, source descriptors).
- **R1.2** Source descriptors carry identity metadata only — file name, byte size, duration, video/audio stream parameters — never media bytes.
- **R1.3** Deserialization gates on `schemaVersion` and upgrades or rejects unknown versions explicitly; a bad document must never crash the shell.

## R2 — Undo/Redo History

- **R2.1** The pipeline worker keeps a bounded snapshot history (~100 entries) of the authoritative timeline; every mutating command pushes the pre-edit snapshot.
- **R2.2** `undo`/`redo` commands restore a snapshot and re-emit timeline state; the UI reflects `canUndo`/`canRedo`.
- **R2.3** Rapid `set-effect-param` edits to the same `(clipId, key)` coalesce into one history entry so a slider drag is a single undo step.

## R3 — Autosave + Restore

- **R3.1** Autosave the `ProjectDoc` to IndexedDB after edits, debounced; native IndexedDB only, no new dependency.
- **R3.2** On launch, offer to restore the last project and rebuild the timeline before any new import.
- **R3.3** Persistence lives engine-side; file handles and stored `File`s never cross into `src/ui/`.

## R4 — Media Re-linking

- **R4.1** Attempt silent re-attachment first: `File` blobs stored in IndexedDB re-open directly through `openMediaFile`.
- **R4.2** Where supported, stored `FileSystemFileHandle`s re-attach after a one-click `requestPermission` re-grant.
- **R4.3** As the guaranteed floor, prompt the user to re-pick files and match them to descriptors by name + size + duration; mismatches are flagged, never silently bound.
- **R4.4** A restored project with missing sources keeps the shell alive and editable; unresolved clips are visibly marked offline.

## R5 — Tests

- **R5.1** Unit-test serialize/deserialize round-trip and `schemaVersion` handling.
- **R5.2** Unit-test history push/undo/redo, the entry cap, and coalescing.
- **R5.3** Unit-test descriptor matching for re-link, including mismatch rejection.
