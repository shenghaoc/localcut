# Keystroke overlay

The keystroke overlay turns the shortcuts you press during a tutorial
recording into editable on-screen keycap clips on a dedicated **Keystrokes**
overlay track. Each clip is an ordinary title clip — once generated you can
move, retime, restyle, or delete any of them.

Recording is **opt-in**. Nothing is recorded until you tick the consent box and
press **Start recording**.

## What is captured

Only **non-text shortcuts** are written to the log. The recording gate
explicitly rejects:

- Events from `<input>`, `<textarea>`, `<select>`, `[contenteditable]`, or any
  field with `type="password"`.
- Single printable characters held without `Ctrl`, `Alt`, or `Meta`. **Shift
  alone does not unlock recording** — `Shift+a` (capitalised text) stays
  private.

Modifier combinations (`Ctrl+S`, `Alt+Tab`, `Cmd+Shift+Z`), navigation keys
(`Escape`, arrows, `PageUp`), and function keys (`F5`, `F12`) are recorded.

Each combo is stored as a canonical string with modifiers sorted alphabetically
(`Alt+Ctrl+Shift+...`) and the space key normalised to `Space`.

## Using it

1. Open **Keystroke Overlay** from the toolbar.
2. Tick **I understand and want to record shortcuts**.
3. Click **Start recording**. The panel listens to keydown events globally
   while focus is anywhere outside form fields.
4. Use your tool as you normally would for the tutorial. Recorded combos
   appear in the live log with relative timestamps.
5. Click **Stop recording** when finished.
6. Press **Insert overlay clips** to add the clips to the timeline.

## What you get on the timeline

- Clips land on a **Keystrokes** track at the top of the track list. If no
  Keystrokes track exists, one is created.
- Combos within 300 ms are merged into a single clip with combos joined by
  `·` (e.g. `Ctrl+C · Ctrl+V`). The merge is also capped at **4 combos** or
  **1 second** of span so a rapid run of shortcuts never collapses into one
  giant clip.
- Each clip's default duration is **1.2 seconds**, truncated if the next clip
  begins sooner.
- The keycap style is monospace on a dark pill, ready for screencasts. Edit
  any clip's text or style in the Inspector after insertion.

## Limitations

- Recording only watches the active tab. It cannot read keystrokes in another
  window or in the operating system itself.
- Shortcuts pressed before you click **Start recording** are not recoverable;
  the log only collects events between Start and Stop.
- The overlay is purely cosmetic — it does not control playback timing or fire
  any action.
