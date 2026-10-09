import { afterEach, expect, it, vi } from 'vite-plus/test';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import ScopePanel from '../ui/ScopePanel';
import {
	SCOPE_RES_X,
	histogramSlotOffset,
	scopeTotalBufferBytes,
	writeScopeHeader
} from '../engine/scopes';

let dispose: (() => void) | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
	dispose?.();
	dispose = undefined;
	container?.remove();
	vi.unstubAllGlobals();
});

it('replaces the frame loop on buffer swaps, pauses while collapsed, and cancels on disposal', () => {
	let nextId = 0;
	const frames = new Map<number, FrameRequestCallback>();
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
		frames.set(++nextId, callback);
		return nextId;
	});
	vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
	const tick = () => {
		const pending = [...frames.values()];
		frames.clear();
		for (const callback of pending) callback(0);
	};
	const buffer = (clipped: number) => {
		// No concurrent worker is needed here; an ArrayBuffer has the same scope layout
		// and works in Browser Mode without cross-origin isolation.
		const data = new ArrayBuffer(scopeTotalBufferBytes(SCOPE_RES_X));
		writeScopeHeader(new Float32Array(data), histogramSlotOffset(), 0, clipped);
		return data as unknown as SharedArrayBuffer;
	};
	const [sab, setSab] = createSignal<SharedArrayBuffer | null>(buffer(10));
	const [collapsed, setCollapsed] = createSignal(false);
	container = document.createElement('div');
	document.body.append(container);
	dispose = render(
		() => (
			<ScopePanel
				scopeSab={sab()}
				framePixelCount={() => 100}
				collapsed={collapsed}
				setCollapsed={setCollapsed}
			/>
		),
		container
	);

	expect(frames.size).toBe(1);
	tick();
	expect(container.textContent).toContain('10.0% clipped');
	setSab(buffer(20));
	expect(frames.size).toBe(1);
	tick();
	expect(container.textContent).toContain('20.0% clipped');
	setCollapsed(true);
	expect(frames.size).toBe(0);
	setSab(buffer(30));
	expect(frames.size).toBe(0);
	setCollapsed(false);
	expect(frames.size).toBe(1);
	tick();
	expect(container.textContent).toContain('30.0% clipped');
	setSab(null);
	expect(frames.size).toBe(0);
	setSab(buffer(40));
	expect(frames.size).toBe(1);
	dispose();
	dispose = undefined;
	expect(frames.size).toBe(0);
});
