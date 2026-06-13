# Caption Styles and Animation (Phase 30)

LocalCut's caption styling engine lets you apply rich visual presets to caption
tracks — glow effects, per-line background pills, and enter/exit animations.
Karaoke-style word highlighting is available when per-word timing data is
present (e.g. from Phase 29 auto-captions ASR).

## Built-in Presets

| ID             | Label        | Enter Animation | Glow      | Pill             | Highlight |
| -------------- | ------------ | --------------- | --------- | ---------------- | --------- |
| `subtitle`     | Subtitle     | none            | —         | —                | —         |
| `lower-third`  | Lower Third  | slide-up        | —         | charcoal         | —         |
| `note`         | Note         | none            | —         | semi-transparent | —         |
| `bold-outline` | Bold Outline | none            | —         | —                | —         |
| `neon-glow`    | Neon Glow    | none            | cyan 20px | —                | —         |
| `karaoke`      | Karaoke      | none            | —         | —                | yellow    |
| `cinematic`    | Cinematic    | pop (opacity)   | —         | —                | —         |
| `pop-card`     | Pop Card     | pop             | —         | dark             | —         |
| `bounce-card`  | Bounce Card  | bounce          | —         | —                | —         |
| `slide-news`   | Slide News   | slide-up        | —         | charcoal         | —         |

## Animation Types

All animations are applied at composite time via uniforms — the cached texture
is not re-rasterized per frame.

| Kind         | Enter Behavior                               | Exit Behavior                 |
| ------------ | -------------------------------------------- | ----------------------------- |
| `none`       | Identity (no animation)                      | Identity                      |
| `pop`        | Scale 0→1.15→1.0 with overshoot, opacity 0→1 | Scale 1.0→0.8, opacity 1→0    |
| `bounce`     | TranslateY +40→-8→0, opacity 0→1             | TranslateY 0→+40, opacity 1→0 |
| `slide-up`   | TranslateY +60→0, opacity 0→1                | TranslateY 0→+60, opacity 1→0 |
| `slide-down` | TranslateY -60→0, opacity 0→1                | TranslateY 0→-60, opacity 1→0 |
| `typewriter` | cropRightFrac 0→1 (left-to-right reveal)     | None (hold at full reveal)    |

### Parameter Ranges

- `durationS`: [0.05, 1.0] seconds. Default: 0.25s.
- When `segDuration < 2 × durationS`, enter and exit durations are each clamped
  to `segDuration / 2` so they don't overlap.

## Karaoke Word Highlighting

When a `CaptionSegment` has a `words` array and the preset sets
`highlightColor`, the rasterizer produces a highlight texture variant with the
active word drawn in `highlightColor`. The compositor swaps to this variant
atomically at word boundaries — no per-frame re-rasterization.

### Word Timing Format

```typescript
interface CaptionWord {
	text: string; // Must match the corresponding word in the segment text
	startS: number; // Start time in seconds (absolute, not segment-relative)
	endS: number; // End time in seconds
}
```

**Constraints:**

- Words must be time-ordered (each `startS` >= previous `endS`).
- Words must not overlap.
- Each word's range should lie within `[segment.start, segment.start + segment.duration]`.
  Out-of-range entries emit a warning but are not rejected.
- Phase 29 auto-captions ASR output populates the `words` field automatically.

## Custom Presets

Custom presets are stored in `ProjectDoc.customAnimCaptionPresets` and survive
Phase 23 bundle round-trips (they ride in `project.json`).

### Import

1. Click **Import preset** in the caption style inspector.
2. Select a `.caption-preset.json` file.
3. The preset is validated, assigned a new UUID, and added to the project.

### Export

1. Select a preset in the picker.
2. Click **Export preset**.
3. Save the `.caption-preset.json` file.

### Preset JSON Schema

```json
{
	"captionStyleSchemaVersion": 1,
	"label": "My Custom Preset",
	"anchor": "bottom-center",
	"maxWidthPercent": 80,
	"lineWrap": "balanced",
	"titleStyle": { "fontSizePx": 64, "color": "#ffffff" },
	"glow": { "color": "#ff00ff", "blurPx": 15 },
	"animation": { "enter": "pop", "exit": "none", "durationS": 0.3 },
	"highlightColor": "#ffff00"
}
```

## CJK Font Fallback

CJK scripts use the system font stack via Canvas2D font fallback:

```
'LocalCut Sans', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif
```

No CJK font is bundled with LocalCut. The system font fallback keeps text
legible on CJK locales but the exact rendering depends on installed fonts.

## Bundle Portability

Custom presets are embedded in `project.json` inside Phase 23 media bundles.
No separate preset files are included in the bundle asset manifest. When you
import a bundle, custom presets are restored automatically.

## Capability Tier Notes

- **Full tier** (WebGPU + COOP/COEP): All features available.
- **Reduced tier** (no WebGPU): Burn-in styled captions are not available.
  The inspector shows a reduced-tier notice. Non-burned-in styled captions
  are unaffected.
