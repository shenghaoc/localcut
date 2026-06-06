# Design: Phase 9 — Project Persistence + Undo/Redo

> Status: **Active** — make projects survive reload and every edit reversible before more editing surface lands.

## Goal

Persist the worker-owned timeline across reloads and give every mutating command an undo path. The model is already immutable (`cloneTimeline` in `src/engine/timeline.ts`) and the pipeline worker is its sole writer, so snapshot history and serialization are cheap and race-free. Persistence is IndexedDB in the user's browser — Cloudflare stays static hosting.

## Project document

```
ProjectDoc {
  schemaVersion: 1, projectId, savedAt,
  timeline: TimelineSnapshot,     // existing mirror types
  sources: SourceDescriptor[]     // { sourceId, fileName, byteSize, durationS,
}                                 //   video?: { width, height }, audio?: { channels, sampleRate } }
```

Descriptors carry identity metadata only; media bytes stay in the user's files (or a stored `File` blob), never inside the document.

## Re-link ladder

| Tier | Mechanism | Experience |
|------|-----------|------------|
| 1 | `File` blob stored in IndexedDB → `BlobSource(file)` (`src/engine/media-io.ts`) | silent restore |
| 2 | Stored `FileSystemFileHandle` + `requestPermission()` | one-click re-grant |
| 3 | Re-pick prompt matched by name + size + duration | guaranteed floor |

Each tier falls through to the next; a project with missing media keeps an editable shell with clips marked offline — the capability-tier philosophy applied to media.

## Modules

| Module | Work |
|--------|------|
| `src/engine/project.ts` (new) | pure `serializeProject` / `deserializeProject` + `schemaVersion` gate |
| `src/engine/history.ts` (new) | bounded snapshot stack (~100); coalesce keyed `(clipId, key)` |
| `src/engine/persistence.ts` (new) | native IndexedDB stores: project doc + per-source `File`/handle |
| `src/engine/worker.ts` | push pre-edit snapshots at mutation sites; handle `undo`/`redo`; debounced autosave; restore offer on `init` |
| `src/protocol.ts` | commands `undo`, `redo`, `relink-source`, `new-project`; states `history-state`, `restore-available`, `relink-result` |
| `src/ui/Toolbar.tsx`, `src/ui/App.tsx` | undo/redo buttons, Cmd/Ctrl+Z / Shift+Z, restore banner with re-pick |

Handles and stored `File`s never cross into `src/ui/`; the UI sees descriptors and pick requests only. Extend the hand-rolled `FileSystemFileHandle` typing with `queryPermission`/`requestPermission`.

## Undo semantics

- History sits beside the timeline in the worker; the UI renders `canUndo`/`canRedo` from `history-state` and never holds its own stack.
- The coalescing window is pinned to the Inspector's existing 80ms debounce so one slider drag is one entry.
- Snapshots are clip metadata only (no frame data); a 100-entry cap costs well under a megabyte.

## Validation

- Reload mid-edit: timeline and effect params return; sources re-attach silently in Chromium.
- An undo storm across mixed edits leaves the model consistent and leaks no `VideoFrame`.
- Build and tests stay green; `crossOriginIsolated` behaviour unchanged.
