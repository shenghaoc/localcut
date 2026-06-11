## Summary

<!-- Briefly describe what this PR does and why. -->

## Checklist

### Documentation

<!-- User-facing docs live in docs/ as the single source of truth. They render on GitHub AND in the in-app Help panel. -->

- [ ] User-facing changes are documented in `docs/`
- [ ] New features have corresponding user guide updates
- [ ] Changed or removed features have docs updated accordingly
- [ ] New keyboard shortcuts are documented in the shortcuts reference table

### Quality Gates

- [ ] `pnpm build` succeeds (strict TypeScript)
- [ ] `pnpm test` passes (test count has not decreased for non-trivial logic)
- [ ] No `VideoFrame` leaked (every `.close()` exactly once)
- [ ] Main thread stays interactive (no sustained media loops)
- [ ] COOP/COEP verified in dev and preview modes

### Accessibility

- [ ] Interactive elements are keyboard-accessible
- [ ] Icon-only controls have `aria-label`
- [ ] Focus indicators visible (`:focus-visible`)
- [ ] Dialogs trap focus and close with Escape

### Self-Review

- [ ] I have reviewed my own code for logic errors, race conditions, and dead code
- [ ] Error paths are handled with user-visible messages (no silent failures)
- [ ] Comments accurately describe the code they accompany
