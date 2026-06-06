# Code Style

## TypeScript

- **Strict mode** — `strict: true` is enforced by `tsconfig.json`; no `any`, no non-null assertions without a comment explaining why.
- **Explicit return types** on exported functions and class methods; infer for local variables and callbacks.
- **Discriminated unions** for protocol messages and capability tiers — never use string-keyed lookups on union members; use `switch` on the discriminant.
- **No enums** — use `const` object maps or union literal types instead.
- **Immutability by default** — prefer `readonly` arrays and object properties in data types; mutate only within the owning module.

## SolidJS (main thread)

Follow the [`solid-patterns`](.kiro/skills/solid-patterns/) skill. Key style points:

- **Signals at the leaf** — derive computed values with `createMemo`; avoid threading signals through many components manually.
- **`<Show keyed>`** when narrowing nullable props (prevents stale closure access).
- **`onCleanup`** for every rAF loop, worker reference, and `window` event listener registered in a component.
- No inline `style` objects with computed values unless driven by a fine-grained signal; use CSS custom properties for dynamic values where possible.

## Engine Modules (worker thread)

- Pure TypeScript — no DOM, no SolidJS, no `window`.
- Prefer plain functions over classes; only use a class when lifecycle (`open`/`close`) genuinely improves clarity.
- All `VideoFrame` instances must be `.close()`d exactly once; the closing site should be obvious from control flow, not buried in a finally branch of a distant caller.

## Naming

| Kind | Convention |
|------|-----------|
| UI components | `PascalCase.tsx` in `src/ui/` |
| Engine modules | `kebab-case.ts` in `src/engine/` |
| Signals / stores | `camelCase`; accessors are `createX` or `useX` |
| Constants | `SCREAMING_SNAKE` for true compile-time constants; `camelCase` for derived config objects |
| WGSL shaders | `kebab-case.wgsl`; f16 variant: `*.f16.wgsl` |

## Comments

Write comments only when the **why** is non-obvious — a hidden constraint, a browser-specific workaround, or a subtle invariant. Do not explain what the code does; well-named identifiers do that. Do not reference the current task, issue number, or caller in source comments.

## Formatting

Project is formatted with **Prettier** (defaults). Run `npx prettier --write` or rely on editor integration. Do not add blank lines that Prettier would remove; do not fight the formatter.

## CSS

- All design tokens in `src/global.css` as `:root` CSS custom properties — do not hard-code colour hex values or spacing in component files.
- No CSS-in-JS or runtime style injection.
- Use `gap` / `flex` / `grid` layout; avoid absolute positioning except for overlay layers (scrubhead, playhead) and timeline clip positioning where `left`/`width` encode time.
