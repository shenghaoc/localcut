---
name: LocalCut Studio
description: A browser-native non-linear video editor — precision-instrument dark palette, single amber accent, tabular-nums timecodes.
colors:
  film-stock-amber: "#d4a853"
  amber-pressed: "#c4983e"
  ink: "#0a090f"
  plate: "#0f0e15"
  panel: "#16151c"
  elevated: "#1d1c24"
  well: "#0c0b11"
  edge: "#222230"
  edge-strong: "#33334a"
  text-primary: "#f4f6fa"
  text-secondary: "#c7c9d6"
  text-muted: "#8e90a3"
  text-dim: "#5a5c70"
  vermillion: "#ef4f4f"
  sage: "#6ee7b7"
  signal-amber: "#f5b942"
  cool-slate: "#8b9cc7"
typography:
  display:
    fontFamily: "DM Sans, Noto Sans SC, Noto Sans JP, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.018em"
  body:
    fontFamily: "DM Sans, Noto Sans SC, Noto Sans JP, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "DM Sans, Noto Sans SC, Noto Sans JP, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "11.5px"
    fontWeight: 600
    letterSpacing: "0.12em"
  mono:
    fontFamily: "JetBrains Mono, Noto Sans SC, Noto Sans JP, ui-monospace, SF Mono, monospace"
    fontSize: "12.5px"
    fontFeature: "tabular-nums lining-nums"
rounded:
  xs: "2px"
  sm: "3px"
  md: "4px"
  lg: "6px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "18px"
components:
  button-primary:
    backgroundColor: "{colors.film-stock-amber}"
    textColor: "#1a1100"
    rounded: "{rounded.sm}"
  button-secondary:
    backgroundColor: "{colors.elevated}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.sm}"
  button-destructive:
    backgroundColor: "{colors.vermillion}"
    textColor: "#1a0405"
    rounded: "{rounded.sm}"
---

# Design System: LocalCut Studio

## 1. Overview

**Creative North Star: "The Editing Bench"**

LocalCut Studio is a dark, focused workspace — the digital equivalent of a film editing bench: functional, precise, stripped of decoration. Every surface, every pixel, every type choice serves the edit. There is no chrome that doesn't earn its place. The palette is a single confident amber accent against a sequence of warm-undertone dark surfaces, like the glow of a light meter in a dim cutting room. DM Sans carries the interface voice with quiet authority; JetBrains Mono delivers every timecode, frame rate, and codec string with tabular-nums precision.

This system explicitly rejects the consumer-social energy of CapCut, the industrial panel-density of DaVinci Resolve, the magnetic-track model of Final Cut Pro, and the open-source clutter of kdenlive. No gradients, no glassmorphism, no oversized hero typography. The amber accent is the only colour that draws the eye — its rarity is its power.

**Key Characteristics:**
- Single-accent palette: amber carries all primary actions, focus states, and the scrubhead
- Tonal surface layering (ink → plate → panel → elevated) — no decorative shadows at rest
- No bold, no italic, no uppercase — weight and size carry hierarchy
- Tabular-nums everywhere time is displayed
- Borders are 1px hairlines, never side-stripes
- Everything is measured, nothing is gratuitous

## 2. Colors

A single amber accent against a warm-undertone dark neutral ramp. Three signal colours (sage, vermillion, signal-amber) handle status; cool slate marks functional readouts.

### Primary
- **Film Stock Amber** (`#d4a853`): The scrubhead, primary buttons, focus rings, clip video colour, and waveform fill. The only colour that draws the eye. Used on ≤10% of any screen.
- **Amber Pressed** (`#c4983e`): Active/selected state for amber elements. Darker than the base, never lighter.

### Neutral
- **Ink** (`#0a090f`): App background, toolbar, the darkest surface. The canvas everything sits on.
- **Plate** (`#0f0e15`): Outline button background, the layer between ink and panel.
- **Panel** (`#16151c`): Sidebar backgrounds, card surfaces, muted containers.
- **Elevated** (`#1d1c24`): Button backgrounds, input fields, popover surfaces. The lightest dark surface.
- **Well** (`#0c0b11`): Preview stage background, the recessed area where content lives.
- **Edge** (`#222230`): Default 1px borders. Subtle enough to separate without drawing attention.
- **Edge Strong** (`#33334a`): Borders that need more presence — active inputs, selected panels.
- **Text Primary** (`#f4f6fa`): Body text, headings, active labels. ≥4.5:1 against panel.
- **Text Secondary** (`#c7c9d6`): Supporting text, button labels on elevated surfaces.
- **Text Muted** (`#8e90a3`): Placeholder text, disabled labels, tertiary metadata.
- **Text Dim** (`#5a5c70`): The quietest visible text — non-essential metadata, timestamps in lists.

### Signal
- **Vermillion** (`#ef4f4f`): Destructive actions, error states, delete confirmations.
- **Sage** (`#6ee7b7`): Success states, audio clip colour, confirmed/completed indicators.
- **Signal Amber** (`#f5b942`): Warnings, caution states — brighter than Film Stock Amber to stand out.

### Functional
- **Cool Slate** (`#8b9cc7`): Timecode readouts, technical labels, FPS displays. The "data" colour — emotionally neutral, technically precise.

### Named Rules
**The One Accent Rule.** Film Stock Amber is the only accent that draws attention. It appears on ≤10% of any screen. Sage and vermillion are signal colours only — they appear when there's something to signal, never as decoration. Cool slate is for readouts, not for emphasis.

## 3. Typography

**Display/UI Font:** DM Sans (with Noto Sans SC, Noto Sans JP, system-ui, -apple-system, Segoe UI fallback)
**Mono Font:** JetBrains Mono (with Noto Sans SC, Noto Sans JP, ui-monospace, SF Mono fallback)

**Character:** DM Sans brings a clean geometric warmth without the coldness of Inter or the playfulness of rounded sans-serifs. JetBrains Mono is the ruthless instrument — every timecode, FPS value, codec string, and sample rate is set in it with `font-variant-numeric: tabular-nums lining-nums`. No bold, no italic, no uppercase. Weight and size alone carry the hierarchy.

### Hierarchy
- **Display** (600, 28px / 1.2, tracking -0.018em): Panel headers, dialog titles. Used sparingly.
- **Title** (500, 20px / 1.3): Section headers within panels, card titles.
- **Body** (400, 13.5px / 1.4): Primary UI text. The workhorse. Capped at 65ch in prose contexts.
- **Small** (400, 12.5px / 1.4): Secondary labels, metadata, helper text.
- **Caption** (400, 11.5px / 1.4): The smallest readable text. Timestamps, keyboard shortcuts, tertiary labels.
- **Micro** (400, 10.5px / 1.3): Absolute minimum. Used only for badge counts and density-critical labels.
- **Label** (600, 11.5px / 1.3, tracking 0.12em): Section eyebrow labels. The only element with wide tracking — and even then, only when the label genuinely aids scanning.
- **Mono** (400/500/600, 12.5px / 1.4, `tabular-nums lining-nums`): Every timecode, frame number, codec string, sample rate, bitrate, percentage, and ID. Never used for prose.

### Named Rules
**The Mono-Ruthless Rule.** If it's a number that matters for editing, it's in JetBrains Mono with tabular-nums. Timecodes, frame counts, durations, percentages — no exceptions. DM Sans never displays a timecode.

## 4. Elevation

This system uses **tonal layering**, not shadows, as its primary depth mechanism. Surfaces progress from darkest (ink, at rest) to lightest (elevated, the highest layer). Shadows are reserved for popovers, dialogs, and tooltips — elements that genuinely float above the editing surface. At rest, every surface is flat. The amber glow on primary buttons and the scrubhead is the only "lift" in the default state.

### Shadow Vocabulary
- **Ambient Low** (`0 1px 2px rgb(0 0 0 / 45%)`): Subtle separation for cards within panels.
- **Surface Mid** (`0 6px 18px -4px rgb(0 0 0 / 55%), 0 2px 6px rgb(0 0 0 / 35%)`): Popovers, dropdowns, floating panels.
- **Surface High** (`0 16px 40px -12px rgb(0 0 0 / 70%), 0 4px 12px rgb(0 0 0 / 40%)`): Modal dialogs, the highest elevation.
- **Amber Glow** (`0 0 0 1px rgb(212 168 83 / 18%), 0 0 12px rgb(212 168 83 / 12%)`): Primary buttons, active scrubhead. The only glow in the system.
- **Focus Ring** (`0 0 0 1px var(--amber), 0 0 0 3px rgb(212 168 83 / 18%)`): Keyboard focus indicator. Always amber, never browser-default.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. Shadows appear only as a response to state — a popover opens, a dialog appears, a tooltip floats. The editing surface itself is always shadowless.

## 5. Components

### Buttons
- **Shape:** 3px radius (`--radius-sm`). Sharp enough to feel precise, rounded enough to not feel brittle.
- **Primary (default variant):** Amber background (`#d4a853`), dark text (`#1a1100`), subtle amber glow. Hover lightens the amber slightly. The only button that draws attention — use once per section maximum.
- **Secondary:** Elevated surface background (`#1d1c24`), muted text (`#c7c9d6`), 1px edge border. The default for most actions. Hover shifts border toward amber and lightens background.
- **Outline:** Plate background (`#0f0e15`), same border and text as secondary. For actions in dense toolbars.
- **Ghost:** Transparent background, muted text (`#8e90a3`), no border. For tertiary actions and icon-only buttons.
- **Destructive:** Vermillion-toned background, dark text. For delete, clear, and irreversible actions.
- **Link:** Transparent, amber text, underline. For inline navigation actions.
- **Sizes:** sm (24px), default (28px), lg (36px), icon (28×28px square).
- **Disabled:** 42% opacity, no pointer events. Never greyed-out amber — the opacity carries the state.

### Inputs / Fields
- **Style:** Elevated surface background, 1px edge border, 3px radius.
- **Focus:** Border shifts to edge-strong, amber focus ring appears.
- **Error:** Border shifts to vermillion, no background change.
- **Disabled:** Reduced opacity, muted text.

### Cards / Panels
- **Corner Style:** 4px radius (`--radius-md`).
- **Background:** Panel surface (`#16151c`).
- **Shadow:** None at rest. Ambient-low shadow when floating.
- **Border:** None. Surface contrast separates cards from the app background.

### Navigation
- **Toolbar:** Ink background (`#0a090f`), 112px total height. Top row: menu bar + transport. Middle row: tool buttons. Bottom row: pipeline status chips.
- **Left Dock:** Panel background, houses Media Bin and Beat Panel.
- **Right Rail:** Fixed-width panel, houses Inspector, scopes, and contextual tools.
- **Timeline:** 234px default height, ink background. Clips sit on panel-coloured tracks.

### Timeline (Signature Component)
- **Scrubhead:** 1px amber vertical line, full timeline height. The most important pixel in the app.
- **Clips:** Amber for video, sage for audio. 3px radius, subtle border.
- **Waveform:** Amber fill on dark background. Peaks normalised to clip height.
- **Time Ruler:** JetBrains Mono timecodes, tabular-nums, aligned to scrubhead position.
- **Playhead:** Updates via SAB clock at display refresh rate. Position is always a signal, never an animation.

## 6. Do's and Don'ts

### Do:
- **Do** lead with Film Stock Amber for exactly one primary action per view. Its rarity is the point.
- **Do** use JetBrains Mono with `tabular-nums lining-nums` for every timecode, frame count, and technical value.
- **Do** use tonal surface layering (ink → plate → panel → elevated) for depth. Darker = further back.
- **Do** keep borders at 1px in edge (`#222230`) or edge-strong (`#33334a`). Hairlines separate; they don't decorate.
- **Do** use vermillion only for destructive actions and error states, sage only for success and audio, signal-amber only for warnings.
- **Do** respect `prefers-reduced-motion` — replace all transitions with instant state changes.

### Don't:
- **Don't** introduce a second accent colour. There is one amber. Sage, vermillion, and signal-amber are signals, not accents.
- **Don't** use side-stripe borders (`border-left` > 1px) as coloured accents on cards or list items.
- **Don't** use gradient text, glassmorphism, or decorative blur effects.
- **Don't** display timecodes in DM Sans. If it's a number an editor needs to read precisely, it's JetBrains Mono.
- **Don't** add shadows to surfaces at rest. Shadows belong to floating elements (popovers, dialogs, tooltips).
- **Don't** emulate kdenlive's cluttered panel layouts, Final Cut's magnetic timeline, CapCut's consumer-social chrome, or DaVinci Resolve's industrial density.
- **Don't** use bold, italic, or uppercase as hierarchy tools. Weight and size carry the system.
- **Don't** add an eyebrow label (small uppercase tracked text) above every section. Use only when scanning genuinely benefits.
