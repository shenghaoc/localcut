# Accessibility Audit Checklist

Manual checklist for keyboard-only and screen reader workflows. Each item must pass before release.

## Import workflow

- [ ] Tab to "Import" button in toolbar
- [ ] Enter/Space opens file picker
- [ ] After import, focus returns to the app (not stuck in picker)
- [ ] Status bar announces import result via `aria-live="polite"`

## Timeline selection and editing

- [ ] Tab into timeline area
- [ ] Arrow keys or Tab between clips
- [ ] Enter/Space selects focused clip
- [ ] `S` key splits at playhead (timeline scope)
- [ ] `Delete`/`Backspace` removes selected clip(s)
- [ ] `J`/`K`/`L` keys for step-back/pause/play
- [ ] Escape deselects all clips
- [ ] Timeline clip trim handles have `aria-label`

## Inspector panel edits

- [ ] Tab through inspector fields when a clip is selected
- [ ] Numeric fields accept keyboard input
- [ ] Enter commits field changes
- [ ] Transform values editable via keyboard
- [ ] Effect parameters reachable via Tab

## Diagnostics panel

- [ ] Button to open diagnostics is focusable
- [ ] Focus moves into panel on open
- [ ] Tab through capability sections
- [ ] Copy report button is focusable and actionable
- [ ] Copy success announced via `aria-live`
- [ ] Recovery action buttons are focusable
- [ ] Escape closes panel
- [ ] Focus returns to trigger on close

## Export queue

- [ ] Tab to export button
- [ ] Export dialog opens with focus trap
- [ ] Tab through codec/settings fields
- [ ] Start export via keyboard
- [ ] Progress announced via status bar
- [ ] Retry/Cancel buttons focusable after failure
- [ ] Escape cancels/closes

## Storage cleanup dialog

- [ ] Open via diagnostics or dedicated action
- [ ] Tab through cleanup target buttons
- [ ] Enter activates cleanup
- [ ] Results announced
- [ ] Persistent storage request button is focusable

## Recovery actions

- [ ] Recovery action buttons in diagnostics panel are focusable
- [ ] "Restart worker" action triggered via Enter/Space
- [ ] Recovery state shown in status bar badge

## Dialog behavior

- [ ] All dialogs trap focus (Tab cycles within dialog)
- [ ] Escape closes any open dialog
- [ ] Focus returns to element that opened the dialog
- [ ] Dialog backdrops do not steal focus

## General

- [ ] No interactive element relies solely on pointer events
- [ ] All icon-only buttons have `aria-label`
- [ ] `aria-pressed` used for toggle buttons
- [ ] Heading hierarchy is sequential (h1 > h2 > h3)
- [ ] No content uses color alone to convey meaning
- [ ] Reduced-motion preference respected for animations
- [ ] Status bar uses `role="status"` with `aria-live="polite"`
- [ ] Focus indicators visible on all interactive elements (`:focus-visible`)
