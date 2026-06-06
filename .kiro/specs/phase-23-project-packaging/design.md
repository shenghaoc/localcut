# Design: Phase 23 — Project Packaging + Portability

> Status: **Planned** — portable directory bundles so projects survive browser/profile/device changes without IndexedDB or surviving handles.

## Goal

Let users **move whole projects** — timeline, descriptors, embedded or referenced media, and optional warm caches — across browsers and devices using files they control. Phase 23 builds on Phase 9 `ProjectDoc` persistence and re-link rules; it does not replace autosave and does not introduce cloud sync.

The v1 deliverable is a **directory collection** (folder bundle). A single-file zip/tar archive may follow later behind the same manifest types.

## Non-goals

- Cloud project libraries, accounts, or multi-device sync services.
- Silent binding of renamed, resized, or re-encoded media.
- Assuming `FileSystemFileHandle` survives export, email, or another machine.
- Requiring thumbnails, waveform peaks, proxies, or GPU caches for a project to open correctly.
- Buffering entire large media files in memory during export/import.

## Bundle layout (v1 — directory collection)

```
<bundle-root>/
  manifest.json          # ProjectBundleManifest (authoritative)
  project.json           # ProjectDoc at export time (JSON)
  media/                 # embedded sources (deduped by fingerprint)
    <digest-prefix>_<sanitized-name>.<ext>
  assets/
    luts/                # optional .cube files referenced by clips
    captions/            # optional sidecars (srt/vtt) when captions land
  cache/                 # optional — never required for correctness
    thumbnails.json      # manifest of thumbnail blobs + keys
    thumbnails/          # PNG or WebP blobs
    waveforms/           # serialized WaveformPeaks per sourceId
    proxies/             # optional reduced decode proxies
```

Relative paths in the manifest are POSIX-style (`media/…`) regardless of host OS. The bundle root name is user-chosen (`MyEdit.localcut/` is a suggested convention, not a hard requirement).

### Mandatory vs optional

| Path / payload | Mandatory | Notes |
|----------------|-----------|-------|
| `manifest.json` | yes | `bundleSchemaVersion`, asset table, policies, fingerprints |
| `project.json` | yes | Valid `ProjectDoc`; upgraded on import via `deserializeProject` |
| `media/*` embedded assets | policy-dependent | Required when `BundleSourcePolicy.embedMedia === true` |
| `assets/luts/*` | no | Included when clips reference imported LUTs; otherwise re-pick `.cube` |
| `assets/captions/*` | no | Future caption tracks; descriptors always in `ProjectDoc` |
| `cache/**` | no | Warm-start only; missing entries trigger regeneration |

## Core types

```typescript
/** Independent from ProjectDoc.schemaVersion — governs manifest + on-disk layout. */
export const BUNDLE_SCHEMA_VERSION = 1;

export type BundleSourcePolicy =
  | { mode: 'embed-media' }                    // copy bytes into media/
  | { mode: 'reference-only' }                 // descriptors + relative paths only
  | { mode: 'collect-media'; relocate: boolean }; // user folder; optional in-doc path rewrite

export interface MediaFingerprint {
  algorithm: 'sha-256';
  digest: string; // lowercase hex
}

export interface BundleAsset {
  assetId: string;              // stable id inside bundle (uuid)
  kind: 'media' | 'lut' | 'caption' | 'thumbnail' | 'waveform' | 'proxy';
  relativePath: string;         // from bundle root
  fingerprint?: MediaFingerprint; // required for media + lut when embedMedia
  byteSize: number;
  mimeType?: string | null;
  originalFileName: string;       // export-time name for UX / relink hints
  /** sourceIds, clipIds, or lut keys that reference this asset */
  refs: readonly string[];
}

export interface BundleSourceEntry {
  sourceId: string;
  descriptor: SourceDescriptorSnapshot; // embedded copy for offline audit
  mediaAssetId?: string;                // → BundleAsset in media/
  status: 'embedded' | 'external-reference' | 'missing-at-export';
}

export interface ProjectBundleManifest {
  bundleSchemaVersion: typeof BUNDLE_SCHEMA_VERSION;
  bundleId: string;
  createdAt: string;            // ISO
  appVersion: string;           // package version string for support
  projectSchemaVersion: number; // copy of ProjectDoc.schemaVersion at export
  projectId: string;
  displayName: string;          // human label (fileName stem or user title)
  policy: BundleSourcePolicy;
  sources: readonly BundleSourceEntry[];
  assets: readonly BundleAsset[];
  cacheManifest?: BundleCacheManifest;
}

export interface BundleCacheManifest {
  thumbnails?: { assetId: string; key: string }[];
  waveforms?: { sourceId: string; assetId: string; bucketCount: number }[];
  proxies?: { sourceId: string; assetId: string; width: number; height: number }[];
}

export type BundleIntegrityCode =
  | 'ok'
  | 'missing-file'
  | 'size-mismatch'
  | 'fingerprint-mismatch'
  | 'descriptor-mismatch'
  | 'corrupt-json'
  | 'unsupported-bundle-schema'
  | 'unsupported-project-schema'
  | 'cache-stale';

export interface BundleIntegrityItem {
  code: BundleIntegrityCode;
  severity: 'info' | 'warning' | 'error';
  sourceId?: string;
  assetId?: string;
  relativePath?: string;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface BundleIntegrityReport {
  bundleId: string;
  ok: boolean; // false when any blocking error exists
  items: readonly BundleIntegrityItem[];
  summary: {
    sourcesEmbedded: number;
    sourcesOffline: number;
    assetsVerified: number;
    assetsFailed: number;
    cachesSkipped: number;
  };
}
```

`SourceDescriptor` / `SourceDescriptorSnapshot` gain an optional `fingerprint?: MediaFingerprint` once computed (Phase 23 additive field; older docs omit it).

## Fingerprinting + deduplication

```
open File / Blob / bundle entry
  → ReadableStream or chunked FileReader read
  → incremental SHA-256 (SubtleCrypto.digest per chunk or DigestStream when available)
  → MediaFingerprint
```

- **Dedup map:** during export/collect, `digest → BundleAsset`. New `sourceId` with an existing digest only adds a `refs` entry and a `BundleSourceEntry` pointing at the same `mediaAssetId`.
- **Verification on import:** read file size first; if manifest declares a fingerprint, hash the on-disk bytes the same way; mismatch ⇒ `fingerprint-mismatch`, source stays offline.
- **Legacy bundles** without fingerprints fall back to Phase 9 `sourceDescriptorMismatchReasons` after user re-pick or manifest path bind.

## Export flow

```
UI: Export Project… → pick output directory (FS Access) or download-staged folder
  → worker: export-project-bundle { jobId, policy, outputSink }
       1. serializeProject → project.json bytes
       2. walk sources (+ LUTs referenced by clips)
       3. for each readable File/Blob:
            stream-hash → dedup → stream-copy to media/ or assets/
       4. optionally attach cache/* from worker caches (thumbnails, waveform peaks)
       5. write manifest.json
       6. emit bundle-integrity-report + bundle-job-progress
```

**Streaming copy:** use `file.stream()` piped to a `FileSystemWritableFileStream` (FS Access) or chunked `WritableStream` sink. Progress reports bytes written, not frames decoded. No `arrayBuffer()` on whole files in this path.

**Reference-only policy:** `project.json` + `manifest.json` only; `BundleSourceEntry.status = 'external-reference'`; `media/` omitted. Import always enters re-link ladder.

## Import flow

```
UI: Import Project… → pick bundle directory (must contain manifest.json)
  → worker: import-project-bundle { jobId, bundleRoot }
       1. parse + migrate manifest (bundleSchemaVersion gate)
       2. validate required files → preliminary BundleIntegrityReport
       3. deserializeProject(project.json) → ProjectDoc gate
       4. for each embedded source:
            resolve media path → size check → fingerprint check
            → open as File/Blob → adapter inspect → descriptor match
            → on success: register source + store File in IndexedDB
            → on failure: offline source, integrity item
       5. hydrate optional caches (best-effort)
       6. replace timeline in worker; autosave ProjectDoc + sources
       7. emit bundle-import-result + bundle-integrity-report
```

### Conflict handling

| Situation | Behaviour |
|-----------|-----------|
| Target profile already has a project | Prompt: **Replace** (new project id) / **Cancel** — no silent merge in v1 |
| Duplicate `sourceId` collision (re-import) | Generate new `sourceId`s in manifest remap table; update clip references in memory before save |
| Embedded media passes fingerprint but fails descriptor inspect | `descriptor-mismatch`; offline + user may force re-pick (force never bypasses fingerprint check) |
| Partial bundle (some media missing) | Import proceeds; offline clips; report lists missing assets |
| Cache file corrupt | Skip cache entry; regenerate thumbnail/waveform on demand |
| Newer `bundleSchemaVersion` | Reject with `unsupported-bundle-schema`; no partial apply |

Re-link ladder after import matches Phase 9 order: bundled `File` blob (tier 1) → user re-pick with mismatch reasons (tier 3). **No tier-2 handle restore** from bundles — handles are never serialized.

## Collect media

Collect is export with `BundleSourcePolicy.collect-media`:

- User picks an output directory.
- `relocate: false` — copies media + manifest for archival; editor keeps current bindings.
- `relocate: true` — same copy, plus manifest paths rewritten so the bundle is self-contained relative to the collect folder (useful before handoff).

Skipped sources (offline at collect time) appear in the integrity report; other assets still copy.

## Bundle schema migration (separate from ProjectDoc)

```
importBundle(manifestJson):
  v = manifest.bundleSchemaVersion
  if v > BUNDLE_SCHEMA_VERSION: reject
  while v < BUNDLE_SCHEMA_VERSION:
    manifest = migrateBundle(manifest, v, v+1)
    v++
  return manifest
```

`migrateBundle` handles manifest/path renames only. `project.json` migration stays in `deserializeProject` (`PROJECT_SCHEMA_VERSION` currently 7). The manifest records both versions for diagnostics:

```json
{
  "bundleSchemaVersion": 1,
  "projectSchemaVersion": 7,
  ...
}
```

Future bundle v2 might add zip container indirection (`container: { type: 'zip', relativePath: 'bundle.zip' }`) without changing `ProjectDoc` schema.

## Modules

| Module | Responsibility |
|--------|----------------|
| `src/engine/project-bundle/types.ts` | Manifest, asset, policy, integrity types |
| `src/engine/project-bundle/fingerprint.ts` | Streaming SHA-256, `MediaFingerprint` helpers |
| `src/engine/project-bundle/manifest.ts` | serialize/parse/migrate manifest |
| `src/engine/project-bundle/integrity.ts` | Build `BundleIntegrityReport` from validation passes |
| `src/engine/project-bundle/export.ts` | Directory export + collect; stream copy + dedup |
| `src/engine/project-bundle/import.ts` | Directory import; bind media; cache hydrate |
| `src/engine/project-bundle/sinks.ts` | FS Access writable sink + fallback download staging |
| `src/engine/project.ts` | optional `fingerprint` on `SourceDescriptor` |
| `src/engine/persistence.ts` | unchanged API; import calls existing save paths |
| `src/engine/worker.ts` | bundle job orchestration, cancellation |
| `src/protocol.ts` | bundle commands/states |
| `src/ui/BundleDialog.tsx` (new) | export/import/collect UX, policy pickers, integrity summary |

## Protocol sketch

```typescript
// commands (main → worker)
| { type: 'export-project-bundle'; jobId: string; policy: BundleSourcePolicy; output: BundleOutputTarget }
| { type: 'import-project-bundle'; jobId: string; bundle: BundleInputTarget }
| { type: 'collect-project-media'; jobId: string; relocate: boolean; output: BundleOutputTarget }
| { type: 'cancel-bundle-job'; jobId: string }

// states (worker → main)
| { type: 'bundle-job-progress'; jobId: string; phase: string; bytesDone: number; bytesTotal: number | null }
| { type: 'bundle-integrity-report'; jobId: string; report: BundleIntegrityReport }
| { type: 'bundle-import-result'; jobId: string; ok: boolean; projectId?: string; reason?: string }
```

`BundleOutputTarget` / `BundleInputTarget` are opaque handles established by main-thread pickers (directory handle serializations are **not** stored in the bundle — only used for the live job).

## UI expectations

- **Export Project…** — policy: embed / reference-only; directory picker; progress bar; integrity summary on completion with "Show details."
- **Import Project…** — directory picker (`manifest.json` required); pre-flight validation; summary of offline sources with re-pick affordance linking to existing re-link UI.
- **Collect Media…** — output folder + relocate toggle; lighter dialog than full export.

Capability tier: when FS Access directory pickers are unavailable, fall back to zip-less **multi-file download** is out of scope for v1 — show a labeled limited tier: "Export requires a Chromium directory picker" or stage a single `project.json` + manual media copy instructions. Do not regress accelerated preview paths.

## Cache / proxy policy

- **Thumbnails** — JSON manifest + binary blobs; import loads into UI/worker LRU if present; else regenerate via `src/engine/thumbnails.ts`.
- **Waveforms** — store `Float32Array` peaks as binary sidecar; import seeds waveform cache; else decode peaks on demand.
- **Proxies** — optional future preview aid; never referenced by `ProjectDoc` correctness; missing proxy triggers normal decode path.

## Security + privacy

- Bundles are user-owned files; no automatic upload.
- Sanitize file names on write (strip path components, reserved names).
- Parse `manifest.json` and `project.json` with existing strict parsers — no `eval`, no dynamic import from bundle content.
- Cap manifest entry counts and total declared byte size before extraction to reduce zip-bomb risk (relevant when zip support lands).

## Validation (manual)

1. Edit a multi-track project with LUT + title clips; export embedded bundle; copy folder to another profile; import; verify playback + export parity.
2. Import bundle with one deleted `media/` file — timeline loads, affected clips offline, integrity report actionable.
3. Rename a bundled media file on disk — fingerprint/path failure, no silent bind.
4. Export reference-only; import on clean machine — re-pick flow matches descriptors.
5. Export without `cache/` — import succeeds; thumbnails regenerate progressively.
6. Collect media into external SSD; import from that folder on a second machine.
