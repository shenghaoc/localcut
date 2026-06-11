import { describe, expect, it } from 'vite-plus/test';
import {
	createShortcutRegistry,
	DEFAULT_SHORTCUTS,
	type ShortcutBinding
} from './shortcut-registry';

describe('ShortcutRegistry', () => {
	it('registers and retrieves bindings', () => {
		const reg = createShortcutRegistry();
		reg.register(DEFAULT_SHORTCUTS[0]!);
		expect(reg.all()).toHaveLength(1);
	});

	it('unregisters bindings', () => {
		const reg = createShortcutRegistry();
		reg.register(DEFAULT_SHORTCUTS[0]!);
		reg.unregister(DEFAULT_SHORTCUTS[0]!.id);
		expect(reg.all()).toHaveLength(0);
	});

	it('filters by scope', () => {
		const reg = createShortcutRegistry();
		for (const s of DEFAULT_SHORTCUTS) reg.register(s);
		const timeline = reg.forScope('timeline');
		expect(timeline.every((b) => b.scope === 'timeline')).toBe(true);
		expect(timeline.length).toBeGreaterThan(0);
	});

	it('resolves highest-priority scope', () => {
		const reg = createShortcutRegistry();
		const globalEsc: ShortcutBinding = {
			id: 'global-esc',
			key: 'escape',
			modifiers: [],
			scope: 'global',
			label: 'Global escape'
		};
		const dialogEsc: ShortcutBinding = {
			id: 'dialog-esc',
			key: 'escape',
			modifiers: [],
			scope: 'dialog',
			label: 'Close dialog'
		};
		reg.register(globalEsc);
		reg.register(dialogEsc);
		const resolved = reg.resolve('escape', [], ['global', 'dialog']);
		expect(resolved?.id).toBe('dialog-esc');
	});

	it('dialog scope wins over timeline', () => {
		const reg = createShortcutRegistry();
		const timeline: ShortcutBinding = {
			id: 'timeline-esc',
			key: 'escape',
			modifiers: [],
			scope: 'timeline',
			label: 'Deselect'
		};
		const dialog: ShortcutBinding = {
			id: 'dialog-esc',
			key: 'escape',
			modifiers: [],
			scope: 'dialog',
			label: 'Close dialog'
		};
		reg.register(timeline);
		reg.register(dialog);
		expect(reg.resolve('escape', [], ['timeline', 'dialog'])?.id).toBe('dialog-esc');
	});

	it('text-entry scope keeps text-editing keys', () => {
		const reg = createShortcutRegistry();
		const globalS: ShortcutBinding = {
			id: 'split',
			key: 's',
			modifiers: [],
			scope: 'timeline',
			label: 'Split'
		};
		const textS: ShortcutBinding = {
			id: 'text-s',
			key: 's',
			modifiers: [],
			scope: 'text-entry',
			label: 'Type s'
		};
		reg.register(globalS);
		reg.register(textS);
		expect(reg.resolve('s', [], ['text-entry', 'timeline'])?.id).toBe('text-s');
	});

	it('returns null when no matching scope is active', () => {
		const reg = createShortcutRegistry();
		reg.register({ id: 'test', key: 'x', modifiers: [], scope: 'dialog', label: 'Test' });
		expect(reg.resolve('x', [], ['timeline'])).toBeNull();
	});

	it('respects when predicate', () => {
		const reg = createShortcutRegistry();
		let condition = false;
		reg.register({
			id: 'conditional',
			key: 'x',
			modifiers: [],
			scope: 'global',
			label: 'Conditional',
			when: () => condition
		});
		expect(reg.resolve('x', [], ['global'])).toBeNull();
		condition = true;
		expect(reg.resolve('x', [], ['global'])?.id).toBe('conditional');
	});

	it('detects conflicts in overlapping scopes', () => {
		const reg = createShortcutRegistry();
		reg.register({ id: 'a', key: 's', modifiers: [], scope: 'global', label: 'A' });
		reg.register({ id: 'b', key: 's', modifiers: [], scope: 'timeline', label: 'B' });
		const conflicts = reg.findConflicts();
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0]!.chord).toBe('s');
	});

	it('no conflict between non-overlapping scopes', () => {
		const reg = createShortcutRegistry();
		reg.register({ id: 'a', key: 's', modifiers: [], scope: 'dialog', label: 'A' });
		reg.register({ id: 'b', key: 's', modifiers: [], scope: 'inspector', label: 'B' });
		expect(reg.findConflicts()).toHaveLength(0);
	});

	it('no conflict when predicates are mutually exclusive', () => {
		const reg = createShortcutRegistry();
		const pred1 = () => true;
		const pred2 = () => false;
		reg.register({ id: 'a', key: 's', modifiers: [], scope: 'global', label: 'A', when: pred1 });
		reg.register({ id: 'b', key: 's', modifiers: [], scope: 'global', label: 'B', when: pred2 });
		expect(reg.findConflicts()).toHaveLength(0);
	});

	it('Escape has one active meaning at a time', () => {
		const reg = createShortcutRegistry();
		reg.register({
			id: 'esc-dialog',
			key: 'escape',
			modifiers: [],
			scope: 'dialog',
			label: 'Close'
		});
		reg.register({
			id: 'esc-timeline',
			key: 'escape',
			modifiers: [],
			scope: 'timeline',
			label: 'Deselect'
		});
		const dialogOnly = reg.resolve('escape', [], ['dialog']);
		expect(dialogOnly?.id).toBe('esc-dialog');
		const timelineOnly = reg.resolve('escape', [], ['timeline']);
		expect(timelineOnly?.id).toBe('esc-timeline');
		const both = reg.resolve('escape', [], ['dialog', 'timeline']);
		expect(both?.id).toBe('esc-dialog');
	});

	it('default shortcuts have no duplicate chords in overlapping scopes', () => {
		const reg = createShortcutRegistry();
		for (const s of DEFAULT_SHORTCUTS) reg.register(s);
		const conflicts = reg.findConflicts();
		const nonBrowserConflicts = conflicts.filter(
			(c) => !c.bindingA.browserReserved && !c.bindingB.browserReserved
		);
		expect(nonBrowserConflicts).toHaveLength(0);
	});
});
