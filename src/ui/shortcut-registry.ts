export type ShortcutScope =
  | 'global'
  | 'timeline'
  | 'dialog'
  | 'inspector'
  | 'text-entry';

export interface ShortcutBinding {
  readonly id: string;
  readonly key: string;
  readonly modifiers: readonly ('ctrl' | 'shift' | 'alt' | 'meta')[];
  readonly scope: ShortcutScope;
  readonly label: string;
  readonly when?: () => boolean;
  readonly browserReserved?: boolean;
}

export interface ShortcutConflict {
  readonly bindingA: ShortcutBinding;
  readonly bindingB: ShortcutBinding;
  readonly chord: string;
}

function chordKey(binding: ShortcutBinding): string {
  const parts: string[] = [...binding.modifiers].sort();
  parts.push(binding.key.toLowerCase());
  return parts.join('+');
}

const SCOPE_PRIORITY: Record<ShortcutScope, number> = {
  'dialog': 0,
  'text-entry': 1,
  'inspector': 2,
  'timeline': 3,
  'global': 4,
};

export interface ShortcutRegistry {
  register(binding: ShortcutBinding): void;
  unregister(id: string): void;
  all(): readonly ShortcutBinding[];
  forScope(scope: ShortcutScope): readonly ShortcutBinding[];
  findConflicts(): readonly ShortcutConflict[];
  resolve(key: string, modifiers: readonly string[], activeScopes: readonly ShortcutScope[]): ShortcutBinding | null;
}

export function createShortcutRegistry(): ShortcutRegistry {
  const bindings = new Map<string, ShortcutBinding>();

  return {
    register(binding: ShortcutBinding): void {
      bindings.set(binding.id, binding);
    },

    unregister(id: string): void {
      bindings.delete(id);
    },

    all(): readonly ShortcutBinding[] {
      return [...bindings.values()];
    },

    forScope(scope: ShortcutScope): readonly ShortcutBinding[] {
      return [...bindings.values()].filter((b) => b.scope === scope);
    },

    findConflicts(): readonly ShortcutConflict[] {
      const conflicts: ShortcutConflict[] = [];
      const byChord = new Map<string, ShortcutBinding[]>();

      for (const binding of bindings.values()) {
        const chord = chordKey(binding);
        const group = byChord.get(chord) ?? [];
        group.push(binding);
        byChord.set(chord, group);
      }

      for (const [chord, group] of byChord) {
        if (group.length < 2) continue;
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const a = group[i]!;
            const b = group[j]!;
            if (scopesOverlap(a.scope, b.scope) && !predicatesMutuallyExclusive(a, b)) {
              conflicts.push({ bindingA: a, bindingB: b, chord });
            }
          }
        }
      }

      return conflicts;
    },

    resolve(key: string, modifiers: readonly string[], activeScopes: readonly ShortcutScope[]): ShortcutBinding | null {
      const normalizedMods = [...modifiers].sort();
      const targetChord = [...normalizedMods, key.toLowerCase()].join('+');

      let best: ShortcutBinding | null = null;
      let bestPriority = Infinity;

      for (const binding of bindings.values()) {
        if (chordKey(binding) !== targetChord) continue;
        if (!activeScopes.includes(binding.scope)) continue;
        if (binding.when && !binding.when()) continue;

        const priority = SCOPE_PRIORITY[binding.scope];
        if (priority < bestPriority) {
          best = binding;
          bestPriority = priority;
        }
      }

      return best;
    },
  };
}

function scopesOverlap(a: ShortcutScope, b: ShortcutScope): boolean {
  if (a === b) return true;
  if (a === 'global' || b === 'global') return true;
  return false;
}

function predicatesMutuallyExclusive(a: ShortcutBinding, b: ShortcutBinding): boolean {
  if (!a.when || !b.when) return false;
  return a.when !== b.when;
}

export const DEFAULT_SHORTCUTS: ShortcutBinding[] = [
  { id: 'undo', key: 'z', modifiers: ['ctrl'], scope: 'global', label: 'Undo' },
  { id: 'redo', key: 'z', modifiers: ['ctrl', 'shift'], scope: 'global', label: 'Redo' },
  { id: 'redo-y', key: 'y', modifiers: ['ctrl'], scope: 'global', label: 'Redo' },
  { id: 'copy', key: 'c', modifiers: ['ctrl'], scope: 'global', label: 'Copy' },
  { id: 'paste', key: 'v', modifiers: ['ctrl'], scope: 'global', label: 'Paste' },
  { id: 'duplicate', key: 'd', modifiers: ['ctrl'], scope: 'global', label: 'Duplicate' },
  { id: 'zoom-in', key: '=', modifiers: ['ctrl'], scope: 'global', label: 'Zoom in', browserReserved: true },
  { id: 'zoom-out', key: '-', modifiers: ['ctrl'], scope: 'global', label: 'Zoom out', browserReserved: true },
  { id: 'split', key: 's', modifiers: [], scope: 'timeline', label: 'Split at playhead' },
  { id: 'delete', key: 'delete', modifiers: [], scope: 'timeline', label: 'Delete selection' },
  { id: 'backspace-delete', key: 'backspace', modifiers: [], scope: 'timeline', label: 'Delete selection' },
  { id: 'step-back', key: 'j', modifiers: [], scope: 'timeline', label: 'Step backward' },
  { id: 'pause', key: 'k', modifiers: [], scope: 'timeline', label: 'Pause' },
  { id: 'play', key: 'l', modifiers: [], scope: 'timeline', label: 'Play' },
  { id: 'escape-dialog', key: 'escape', modifiers: [], scope: 'dialog', label: 'Close dialog' },
];
