# Capability-Probe False Negatives + Editor Chrome Overlap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 8 bugs where features are falsely reported unavailable on a fully capable Chromium profile (WebGPU + WebNN + COOP/COEP), caused by incorrect H.264 probe levels, main-thread-only OPFS probe, overly strict recording gates, duplicate CSS rules, and stale UI strings.

**Architecture:** The H.264 probe fixes (B1/B2) share one helper function; the OPFS fix (B3) moves the probe into a blob worker; the recording gate (B4/B5) relaxes `recordingAvailable()` and adds a main-frames fallback mirroring publish; the CSS fix (B6) removes a duplicate rule block; B7/B8 are label-only changes.

**Tech Stack:** TypeScript strict, SolidJS, Vitest, WebCodecs, OPFS, CSS Grid.

**Spec:** `.kiro/specs/bugfix-capability-probe-and-editor-overlap/`

---

## File Map

| File                                     | Action     | Tasks              |
| ---------------------------------------- | ---------- | ------------------ |
| `src/engine/capability-probe-v2.ts`      | Modify     | T1, T2, T3, T4, T5 |
| `src/engine/capability-probe-v2.test.ts` | Modify     | T1, T2, T3, T4     |
| `src/engine/capture-reasons.ts`          | **Create** | T4                 |
| `src/engine/capture-reasons.test.ts`     | **Create** | T4                 |
| `src/ui/RecordPanel.tsx`                 | Modify     | T4, T5             |
| `src/ui/ProgramPanel.tsx`                | Modify     | T4                 |
| `src/engine/diagnostics.ts`              | Modify     | T4                 |
| `src/global.css`                         | Modify     | T6                 |
| `src/ui/CapabilityMatrixPanel.tsx`       | Modify     | T7                 |
| `src/ui/LiveAudioChainPanel.tsx`         | Modify     | T8                 |

---

## Task 1: H.264 Level Helper + Codec Probes (T1, T2 — B1, B2)

**Covers:** D1, D2

**Files:**

- Modify: `src/engine/capability-probe-v2.ts`
- Test: `src/engine/capability-probe-v2.test.ts`

- [ ] **Step 1: Add `h264ConstrainedBaseline` helper to `capability-probe-v2.ts`**

Add after the `videoCodecStrings` constant (line 56):

```ts
/**
 * Returns an H.264 Constrained-Baseline codec string whose level covers
 * the given frame size. MaxFS per H.264 Table A-1: L3.0=1620, L3.1=3600,
 * L3.2=5120, L4.0/4.1=8192, L4.2=8704, L5.0=22080, L5.1=36864.
 */
export function h264ConstrainedBaseline(width: number, height: number): string {
	const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
	const level =
		mbs <= 1620
			? 0x1e
			: mbs <= 3600
				? 0x1f
				: mbs <= 5120
					? 0x20
					: mbs <= 8192
						? 0x28
						: mbs <= 22080
							? 0x32
							: 0x33;
	return `avc1.42E0${level.toString(16).toUpperCase().padStart(2, '0')}`;
}
```

- [ ] **Step 2: Update `probeCodecs` to use the helper**

In `probeCodecs` (line 132), replace the static `videoCodecStrings.h264` usage. Change:

```ts
const videoBase = { width: 1280, height: 720, bitrate: 5_000_000 };
```

to:

```ts
const videoBase = { width: 1280, height: 720, bitrate: 5_000_000 };
const h264Codec = h264ConstrainedBaseline(1280, 720);
```

Then replace `videoCodecStrings.h264` with `h264Codec` in the two `probeCodec` calls for H.264 decode and encode (lines 144, 147).

- [ ] **Step 3: Update `probeVideoEncodeRealtime` to use the helper**

In `probeVideoEncodeRealtime` (line 376), replace:

```ts
codec: 'avc1.42001E',
```

with:

```ts
codec: h264ConstrainedBaseline(1920, 1080),
```

- [ ] **Step 4: Write unit tests**

In `src/engine/capability-probe-v2.test.ts`, add:

```ts
describe('h264ConstrainedBaseline', () => {
	it('returns L3.0 for ≤720×576', () => {
		expect(h264ConstrainedBaseline(720, 576)).toBe('avc1.42E01E');
	});
	it('returns L3.1 for 720p', () => {
		expect(h264ConstrainedBaseline(1280, 720)).toBe('avc1.42E01F');
	});
	it('returns L4.0 for 1080p', () => {
		expect(h264ConstrainedBaseline(1920, 1080)).toBe('avc1.42E028');
	});
	it('returns ≥L5.1 for 2160p', () => {
		expect(h264ConstrainedBaseline(3840, 2160)).toMatch(/^avc1\.42E03[23]$/);
	});
	it('yields supported when a stubbed encoder accepts L3.1@720p but rejects L3.0@720p', async () => {
		const stub = {
			isConfigSupported: async (config: { codec: string }) => ({
				supported: config.codec !== 'avc1.42E01E'
			})
		};
		const result = await stub.isConfigSupported({
			codec: h264ConstrainedBaseline(1280, 720)
		});
		expect(result.supported).toBe(true);
	});
});
```

- [ ] **Step 5: Run tests**

Run: `vp test run -- src/engine/capability-probe-v2.test.ts`
Expected: All tests pass, including the new `h264ConstrainedBaseline` tests.

- [ ] **Step 6: Commit**

```bash
git add src/engine/capability-probe-v2.ts src/engine/capability-probe-v2.test.ts
git commit -m "fix(probe): use resolution-derived H.264 level in codec probes (B1, B2)"
```

---

## Task 2: OPFS SyncAccessHandle Worker Probe (T3 — B3)

**Covers:** D3

**Files:**

- Modify: `src/engine/capability-probe-v2.ts`
- Test: `src/engine/capability-probe-v2.test.ts`

- [ ] **Step 1: Add `probeOpfsSyncAccessHandleInWorker` to `capability-probe-v2.ts`**

Replace the existing `probeOpfsSyncAccessHandle` function (lines 406-421) with:

```ts
async function probeOpfsSyncAccessHandleInWorker(): Promise<FeatureSupport> {
	if (typeof Worker === 'undefined' || typeof navigator?.storage?.getDirectory !== 'function') {
		return 'unsupported';
	}
	const src = `self.onmessage = async () => {
		try {
			const root = await navigator.storage.getDirectory();
			const name = '_cap_probe_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.tmp';
			const handle = await root.getFileHandle(name, { create: true });
			if (typeof handle.createSyncAccessHandle !== 'function') { self.postMessage('unsupported'); return; }
			const access = await handle.createSyncAccessHandle();
			access.close();
			await root.removeEntry(name);
			self.postMessage('supported');
		} catch { self.postMessage('unknown'); }
	};`;
	const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
	const worker = new Worker(url);
	try {
		return await new Promise<FeatureSupport>((resolve) => {
			const timer = setTimeout(() => resolve('unknown'), 3_000);
			worker.onmessage = (e) => {
				clearTimeout(timer);
				resolve(e.data as FeatureSupport);
			};
			worker.onerror = () => {
				clearTimeout(timer);
				resolve('unknown');
			};
			worker.postMessage('go');
		});
	} finally {
		worker.terminate();
		URL.revokeObjectURL(url);
	}
}
```

- [ ] **Step 2: Update `probeCaptureCapabilities` to use the worker probe**

In `probeCaptureCapabilities` (line 432), replace `probeOpfsSyncAccessHandle()` with `probeOpfsSyncAccessHandleInWorker()`.

Remove or keep the old `probeOpfsSyncAccessHandle` function as dead code (remove if nothing else references it).

- [ ] **Step 3: Write unit test**

In `capability-probe-v2.test.ts`, add a test for the worker probe. Since the test runs in a Node environment where `Worker` may not exist, test the early-return paths:

```ts
describe('probeOpfsSyncAccessHandleInWorker', () => {
	it('returns unsupported when Worker is unavailable', async () => {
		const origWorker = globalThis.Worker;
		// @ts-expect-error -- testing absence
		delete globalThis.Worker;
		try {
			const result = await probeOpfsSyncAccessHandleInWorker();
			expect(result).toBe('unsupported');
		} finally {
			globalThis.Worker = origWorker;
		}
	});
});
```

Note: Export `probeOpfsSyncAccessHandleInWorker` for testability, or test via the `probeCaptureCapabilities` integration.

- [ ] **Step 4: Run tests**

Run: `vp test run -- src/engine/capability-probe-v2.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/engine/capability-probe-v2.ts src/engine/capability-probe-v2.test.ts
git commit -m "fix(probe): move OPFS SyncAccessHandle probe to worker context (B3)"
```

---

## Task 3: Recording Gate + Program Mode Messaging (T4 — B4)

**Covers:** D4

**Files:**

- Create: `src/engine/capture-reasons.ts`
- Create: `src/engine/capture-reasons.test.ts`
- Modify: `src/ui/RecordPanel.tsx`
- Modify: `src/ui/ProgramPanel.tsx`
- Modify: `src/engine/diagnostics.ts`
- Modify: `src/engine/capability-probe-v2.ts` (for `recordingAvailable` export)
- Modify: `src/engine/capability-probe-v2.test.ts`

- [ ] **Step 1: Create `src/engine/capture-reasons.ts`**

Promote `captureUnavailableReasons` from `RecordPanel.tsx` to a shared helper:

```ts
import type { CapabilityProbeResult } from '../protocol';

/**
 * Returns user-facing reason strings for each capture probe that is not
 * 'shared'. Shared between RecordPanel (recording) and ProgramPanel (program
 * mode) so both surfaces name the actual blocker.
 */
export function captureUnavailableReasons(probe: CapabilityProbeResult): string[] {
	const reasons: string[] = [];
	if (probe.capture.mediaStreamTrackProcessor !== 'supported') {
		reasons.push('MediaStreamTrackProcessor is unavailable.');
	}
	if (probe.capture.transferableMediaStreamTrack !== 'supported') {
		reasons.push('Transferable MediaStreamTrack is unavailable.');
	}
	if (probe.capture.displayCapture !== 'supported') {
		reasons.push('Display capture is unavailable.');
	}
	if (probe.capture.videoEncodeRealtime !== 'supported') {
		reasons.push('Realtime video encode is unavailable.');
	}
	if (probe.capture.opfsSyncAccessHandle !== 'supported') {
		reasons.push('OPFS SyncAccessHandle is unavailable.');
	}
	return reasons;
}
```

Note: Keep the `!== 'supported'` check (stricter than `recordingAvailable`'s `!== 'unsupported'`) so the UI always surfaces degraded probes, even `'unknown'` ones. The gate in `recordingAvailable` will be relaxed separately in T5.

- [ ] **Step 2: Create `src/engine/capture-reasons.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { captureUnavailableReasons } from './capture-reasons';
import type { CapabilityProbeResult } from '../protocol';

function probe(overrides: Partial<CapabilityProbeResult['capture']> = {}): CapabilityProbeResult {
	return {
		capture: {
			mediaStreamTrackProcessor: 'supported',
			transferableMediaStreamTrack: 'supported',
			displayCapture: 'supported',
			displayAudioCapture: 'supported',
			videoEncodeRealtime: 'supported',
			audioEncodeOpus: 'supported',
			audioEncodeAac: 'supported',
			opfsSyncAccessHandle: 'supported',
			...overrides
		}
	} as unknown as CapabilityProbeResult;
}

describe('captureUnavailableReasons', () => {
	it('returns empty array when all capture probes pass', () => {
		expect(captureUnavailableReasons(probe())).toEqual([]);
	});
	it('names realtime video encode when missing', () => {
		const reasons = captureUnavailableReasons(probe({ videoEncodeRealtime: 'unsupported' }));
		expect(reasons).toContain('Realtime video encode is unavailable.');
	});
	it('names OPFS SyncAccessHandle when missing', () => {
		const reasons = captureUnavailableReasons(probe({ opfsSyncAccessHandle: 'unknown' }));
		expect(reasons).toContain('OPFS SyncAccessHandle is unavailable.');
	});
});
```

- [ ] **Step 3: Update `RecordPanel.tsx` to use the shared helper**

Remove the local `captureUnavailableReasons` function (lines 151-170) and import from the shared module:

```ts
import { captureUnavailableReasons } from '../engine/capture-reasons';
```

Update the call site (line 649) to pass `props.probe` (which is `CapabilityProbeResult | null`), handling the null case inline:

```tsx
<For each={props.probe ? captureUnavailableReasons(props.probe) : ['Capability probe is still running.']}>
```

- [ ] **Step 4: Update `ProgramPanel.tsx` to show dynamic reasons**

Import the shared helper and `Show`/`For` from SolidJS (already imported). Replace the static message at lines 99-108:

```tsx
<Show
    when={!isDisabled()}
    fallback={
        <div class="program-panel program-panel--disabled" role="region" aria-label="Program Mode">
            <h3>Program Mode</h3>
            <Show
                when={props.probe}
                fallback={<p class="program-panel-disabled-reason">Capability probe is still running.</p>}
            >
                <div class="program-panel-disabled-reason">
                    <p>Program Mode is unavailable:</p>
                    <ul>
                        <For each={captureUnavailableReasons(props.probe!)}>
                            {(reason) => <li>{reason}</li>}
                        </For>
                    </ul>
                    <Show when={props.probe!.webGPUCore !== 'supported'}>
                        <p>WebGPU is also required for Program Mode.</p>
                    </Show>
                </div>
            </Show>
        </div>
    }
>
```

Check that `props.probe` is passed to ProgramPanel. If not, add it to the component props.

- [ ] **Step 5: Update `diagnostics.ts` messages**

At lines 407-412, replace the static messages with dynamic ones. Import `captureUnavailableReasons`:

```ts
import { captureUnavailableReasons } from './capture-reasons';
```

Then update the finding:

```ts
(input.programMode === 'supported'
	? 'Program Mode is available (WebGPU + capture probes OK).'
	: `Program Mode unavailable: ${captureUnavailableReasons(input.probe ?? probeStub).join(' ')}`,
	input.programMode === 'supported'
		? undefined
		: 'Fix the capture probes listed above, then retry.');
```

Note: Check the exact `input` type for `diagnostics.ts` — it may receive a `CapabilityProbeResult` or a subset. Adjust the call accordingly.

- [ ] **Step 6: Write tests for the dynamic Program Mode message**

In `capability-probe-v2.test.ts`, add:

```ts
describe('captureUnavailableReasons in Program Mode context', () => {
	it('names "Realtime video encode" not WebGPU/WebCodecs when encode probe fails', () => {
		const probe = {
			webGPUCore: 'supported',
			capture: {
				videoEncodeRealtime: 'unsupported',
				opfsSyncAccessHandle: 'supported',
				mediaStreamTrackProcessor: 'supported',
				transferableMediaStreamTrack: 'supported',
				displayCapture: 'supported'
			}
		} as unknown as CapabilityProbeResult;
		const reasons = captureUnavailableReasons(probe);
		expect(reasons.some((r) => r.includes('Realtime video encode'))).toBe(true);
		expect(reasons.some((r) => r.includes('WebGPU'))).toBe(false);
	});
});
```

- [ ] **Step 7: Run tests**

Run: `vp test run`
Expected: All tests pass, including the new capture-reasons tests.

- [ ] **Step 8: Commit**

```bash
git add src/engine/capture-reasons.ts src/engine/capture-reasons.test.ts \
    src/ui/RecordPanel.tsx src/ui/ProgramPanel.tsx src/engine/diagnostics.ts \
    src/engine/capability-probe-v2.test.ts
git commit -m "fix(ui): dynamic capture-unavailable reasons for Record + Program panels (B4)"
```

---

## Task 4: Main-Frames Capture Fallback (T5 — B5)

**Covers:** D5

**Files:**

- Modify: `src/engine/capability-probe-v2.ts`
- Modify: `src/ui/RecordPanel.tsx`
- Modify: `src/engine/capability-probe-v2.test.ts`

This task relaxes `recordingAvailable()` so `transferableMediaStreamTrack` is not a hard requirement when `mediaStreamTrackProcessor === 'supported'`, and adds a labeled degraded capture path in RecordPanel.

- [ ] **Step 1: Relax `recordingAvailable()` in `capability-probe-v2.ts`**

At line 538, change:

```ts
cap.transferableMediaStreamTrack !== 'unsupported' &&
```

to:

```ts
(cap.transferableMediaStreamTrack !== 'unsupported' || cap.mediaStreamTrackProcessor === 'supported') &&
```

This means recording is available when either track transfer works OR MSTP is available (for the main-frames fallback).

- [ ] **Step 2: Add capture tap mode helper to `RecordPanel.tsx`**

Add a `selectCaptureTapMode` function mirroring publish's `selectTapMode`:

```ts
type CaptureTapMode = 'worker-track' | 'main-frames';

function selectCaptureTapMode(probe: CapabilityProbeResult): CaptureTapMode {
	return probe.capture.transferableMediaStreamTrack === 'supported'
		? 'worker-track'
		: 'main-frames';
}
```

- [ ] **Step 3: Update `beginRecording` for main-frames mode**

In `beginRecording()` (line 489), detect the tap mode. In `main-frames` mode, use MSTP to read frames from each source and post VideoFrame objects to the writer worker instead of transferring the track:

```ts
function beginRecording(): void {
	const tapMode = props.probe ? selectCaptureTapMode(props.probe) : 'worker-track';
	writerWorker?.terminate();
	writerWorker = new CaptureWriterWorker();
	const channel = new MessageChannel();
	writerWorker.postMessage({ type: 'init', port: channel.port1 }, [channel.port1]);

	if (tapMode === 'worker-track') {
		for (const source of sources()) transferSource(source);
	}
	// In main-frames mode, sources are read via MSTP on main thread;
	// frames are posted individually to the writer worker (see startMstpReaders).

	props.onStart(
		{
			chunkDurationS: 2,
			videoCodec: 'avc1.64002a',
			audioCodec: 'mp4a.40.2',
			videoBitrate: 5_000_000,
			canvasWidth: 1920,
			canvasHeight: 1080,
			webcamPreset: settings().webcamPreset,
			captureTapMode: tapMode
		},
		channel.port2,
		props.retakeClipId,
		tapMode === 'worker-track' ? [channel.port2] : []
	);
	props.onRetakeCleared();
	if (tapMode === 'main-frames') {
		startMstpReaders();
	}
}
```

- [ ] **Step 4: Add MSTP reader for main-frames fallback**

Add a `startMstpReaders()` function that reads VideoFrames from each source via MSTP on the main thread and posts them to the writer worker:

```ts
let mstpControllers: AbortController[] = [];

function startMstpReaders(): void {
	for (const source of sources()) {
		const controller = new AbortController();
		mstpControllers.push(controller);
		const processor = new MediaStreamTrackProcessor({
			track: source.track as MediaStreamVideoTrack
		});
		const reader = processor.readable.getReader();
		const readLoop = async () => {
			try {
				while (!controller.signal.aborted) {
					const { done, value } = await reader.read();
					if (done) break;
					const frame = value as VideoFrame;
					writerWorker?.postMessage(
						{ type: 'video-frame', sourceId: source.descriptor.sourceId, frame },
						[frame]
					);
				}
			} catch {
				// Track ended or aborted
			}
		};
		void readLoop();
	}
}

function stopMstpReaders(): void {
	for (const controller of mstpControllers) controller.abort();
	mstpControllers = [];
}
```

Call `stopMstpReaders()` in `stopRecording()` and on cleanup.

- [ ] **Step 5: Add degraded-mode badge in RecordPanel UI**

When `captureTapMode === 'main-frames'`, show a labeled note next to the record button:

```tsx
<Show when={props.probe && selectCaptureTapMode(props.probe) === 'main-frames'}>
	<span
		class="capture-compat-badge"
		title="Using compatibility capture — frames are read on the main thread"
	>
		Compatibility capture
	</span>
</Show>
```

Add minimal CSS for `.capture-compat-badge` (a small yellow/warning label).

- [ ] **Step 6: Update `captureUnavailableReasons` for the relaxed gate**

In `src/engine/capture-reasons.ts`, conditionally suppress the "Transferable MediaStreamTrack" reason when MSTP is available (since recording can still work via main-frames):

```ts
if (
	probe.capture.transferableMediaStreamTrack !== 'supported' &&
	probe.capture.mediaStreamTrackProcessor !== 'supported'
) {
	reasons.push('Transferable MediaStreamTrack is unavailable.');
}
```

- [ ] **Step 7: Write tests**

In `capability-probe-v2.test.ts`:

```ts
describe('recordingAvailable with main-frames fallback', () => {
	it('returns true when transferableMediaStreamTrack is unsupported but MSTP is supported', () => {
		const probe = makeProbe({
			capture: {
				...defaultCapture,
				transferableMediaStreamTrack: 'unsupported',
				mediaStreamTrackProcessor: 'supported'
			}
		});
		expect(recordingAvailable(probe)).toBe(true);
	});
	it('returns false when both transferableMediaStreamTrack and MSTP are unsupported', () => {
		const probe = makeProbe({
			capture: {
				...defaultCapture,
				transferableMediaStreamTrack: 'unsupported',
				mediaStreamTrackProcessor: 'unsupported'
			}
		});
		expect(recordingAvailable(probe)).toBe(false);
	});
});
```

Also add a test for `selectCaptureTapMode`:

```ts
describe('selectCaptureTapMode', () => {
	it('returns worker-track when transferableMediaStreamTrack is supported', () => {
		expect(selectCaptureTapMode(makeProbe())).toBe('worker-track');
	});
	it('returns main-frames when transferableMediaStreamTrack is unsupported', () => {
		const probe = makeProbe({
			capture: { ...defaultCapture, transferableMediaStreamTrack: 'unsupported' }
		});
		expect(selectCaptureTapMode(probe)).toBe('main-frames');
	});
});
```

- [ ] **Step 8: Run tests**

Run: `vp test run`
Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/engine/capability-probe-v2.ts src/ui/RecordPanel.tsx \
    src/engine/capture-reasons.ts src/engine/capability-probe-v2.test.ts
git commit -m "fix(capture): main-frames fallback for recording when track transfer unavailable (B5)"
```

---

## Task 5: CSS Layout Consolidation (T6 — B6)

**Covers:** D6

**Files:**

- Modify: `src/global.css`

- [ ] **Step 1: Remove the superseded original `.workspace` rules**

Remove the first `.workspace` block (lines 1681-1692) and its rail-collapsed variants (lines 2201-2207). These are fully overridden by the precision-instrument block at lines 6339-6355.

- [ ] **Step 2: Remove the Ark duplicate `.workspace` rules**

Remove the Ark duplicate block (lines 7641-7658) and its media-query collapse (lines 7833-7841). These override the precision-instrument block and defeat the responsive collapse.

Keep the Ark visual styles (background, gap, padding) by merging them into the surviving precision-instrument block if they differ.

- [ ] **Step 3: Fix the middle track in the surviving block**

In the precision-instrument block (lines 6339-6355), change the middle column from `minmax(480px, 1fr)` to `minmax(0, 1fr)` so it can shrink:

```css
.workspace {
	gap: 6px;
	padding: 6px;
	grid-template-columns: minmax(0, 1fr) 304px;
}
.workspace.has-bin {
	grid-template-columns: 236px minmax(0, 1fr) 304px;
}
```

- [ ] **Step 4: Raise the single-column collapse breakpoint**

Update the `@media` collapse (around line 4710) to fire at a breakpoint above the layout's true minimum width. Change:

```css
@media (max-width: 900px) {
```

to:

```css
@media (max-width: 1240px) {
```

Ensure this rule comes after (or has sufficient specificity to win against) the base workspace block. Verify that `.workspace`, `.workspace.has-bin`, `.workspace.rail-collapsed`, and `.workspace.has-bin.rail-collapsed` all collapse to `1fr` or `flex-direction: column`.

- [ ] **Step 5: Verify no remaining duplicates**

Grep for `.workspace {` in `global.css` and confirm exactly one non-media-query block survives.

- [ ] **Step 6: Commit**

```bash
git add src/global.css
git commit -m "fix(css): consolidate workspace layout rules and fix responsive collapse (B6)"
```

---

## Task 6: WebNN Row + Noise Suppression Label (T7, T8 — B7, B8)

**Covers:** D7, D8

**Files:**

- Modify: `src/ui/CapabilityMatrixPanel.tsx`
- Modify: `src/ui/LiveAudioChainPanel.tsx`

- [ ] **Step 1: Add WebNN capability row to `CapabilityMatrixPanel.tsx`**

In the `rowsForProbe` function, add a WebNN row after the cleanup row (around line 289). Source the value from `navigator.ml` presence and the ORT EP:

```ts
function webnnRow(probe: CapabilityProbeResult): CapabilityRow {
	const hasMl = typeof navigator !== 'undefined' && 'ml' in navigator;
	const ortEp = probe.cleanup?.accelerator;
	return {
		label: 'WebNN (ML acceleration)',
		support: hasMl ? 'supported' : 'unsupported',
		active: ortEp === 'webnn',
		action: hasMl ? `ORT EP: ${ortEp ?? 'wasm'}` : 'Enable the WebNN flag in chrome://flags'
	};
}
```

Add `webnnRow(probe)` to the returned rows array.

- [ ] **Step 2: Relabel the noise suppression insert in `LiveAudioChainPanel.tsx`**

At lines 189-198, change the status text from:

```tsx
<span class="insert-status bypassed">Available in a future update</span>
```

to:

```tsx
<span class="insert-status bypassed">Use Voice Cleanup / Local Audio Cleanup</span>
```

Optionally, add a tooltip or link that scrolls to the cleanup panels.

- [ ] **Step 3: Verify no stale strings remain**

Grep for `"Available in a future update"` across the codebase. Confirm no other UI copy implies noise suppression is missing.

- [ ] **Step 4: Commit**

```bash
git add src/ui/CapabilityMatrixPanel.tsx src/ui/LiveAudioChainPanel.tsx
git commit -m "fix(ui): surface WebNN capability row, relabel noise suppression insert (B7, B8)"
```

---

## Task 7: Quality Gate (T9)

**Covers:** Acceptance criteria 9

- [ ] **Step 1: Run the full quality gate**

```bash
vp run check
```

Expected: format:check + lint + typecheck + Vitest + production build all green.

- [ ] **Step 2: Verify test count**

Run: `vp test run` and confirm test count has not decreased. New tests expected:

- `h264ConstrainedBaseline` (5 tests)
- `probeOpfsSyncAccessHandleInWorker` (1 test)
- `captureUnavailableReasons` (3 tests)
- `recordingAvailable with main-frames fallback` (2 tests)
- `selectCaptureTapMode` (2 tests)

- [ ] **Step 3: Verify no VideoFrame leaks**

Grep for `VideoFrame` in any touched capture/publish paths. Confirm every `VideoFrame` is `.close()`d exactly once.

---

## Task 8: Manual Verification (T10)

- [ ] **Step 1: Export codec verification**

On Chrome with WebGPU + COOP/COEP: open the export dialog and confirm H.264/MP4 appears in the codec list.

- [ ] **Step 2: Recording panel verification**

Confirm the Record panel shows no "Realtime video encode" or "OPFS SyncAccessHandle" unavailability reasons. Recording and Program Mode are available (or degrade with an accurate, labeled reason).

- [ ] **Step 3: Responsive layout verification**

Resize the browser window through 900-1280px. Confirm no overlap between the left dock, preview, and right side-rail.

- [ ] **Step 4: WebNN and noise suppression verification**

Check the Capability Matrix panel shows a WebNN row. Confirm the Live Audio Chain no longer says "available in a future update" for noise suppression.
