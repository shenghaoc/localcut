# Captions

Caption tracks travel with the project. You can import SRT or VTT subtitle
files, edit them inline, restyle them with built-in or custom presets, and
either burn the styled text into the picture on export or write a separate
sidecar file alongside the video.

## Import and edit

- **Import** — open **Text > Captions** and drop an `.srt` or `.vtt`
  file onto the import zone. The parser is permissive: invalid timecodes or
  empty cues are flagged in the panel rather than failing the whole import.
- **Edit text** — click a segment in the panel to open the inline editor.
  Start / end times are also editable from the same row.
- **Split** at the playhead with the split control, **merge** consecutive
  segments via multi-select, and **snap** a segment edge to the playhead or to
  any marker / clip boundary on the timeline.
- **Visibility** — uncheck **Visible** to suppress a track in the preview
  without deleting it. Uncheck **Burn-in** to keep the track visible in the
  preview but excluded from the burned-in export raster (it still exports as
  a sidecar if you chose that option).

## Animated caption styles

Phase 30 adds a styling engine over the existing caption tracks. Every caption
track or segment selects an **animation preset** which controls:

- Text colour, font size, and outline
- Optional **glow** halo
- Optional per-line background **pill**
- Enter / exit **animations** (pop, bounce, slide, typewriter)
- **Karaoke** per-word highlighting when per-word timings are present

### Built-in presets

Ten presets ship with the app. Pick one from the swatch grid in the caption
inspector; the picker shows badges so you can scan them quickly:

| Preset       | Animation | Glow | Pill | Karaoke |
| ------------ | --------- | ---- | ---- | ------- |
| Subtitle     | —         | —    | —    | —       |
| Lower Third  | Slide up  | —    | Yes  | —       |
| Note         | —         | —    | Yes  | —       |
| Bold Outline | —         | —    | —    | —       |
| Neon Glow    | —         | Yes  | —    | —       |
| Karaoke      | —         | —    | —    | Yes     |
| Cinematic    | Pop       | —    | —    | —       |
| Pop Card     | Pop       | —    | Yes  | —       |
| Bounce Card  | Bounce    | —    | —    | —       |
| Slide News   | Slide up  | —    | Yes  | —       |

When you select a preset, the caption's anchor (where on the frame it sits),
maximum width, and line wrapping all follow the preset so a "lower-third"
caption actually moves to the lower third without you having to reposition it.

### Customising and saving a preset

The inspector includes a per-field override form:

- **Text colour, font size, outline colour, outline width**
- **Glow** toggle plus colour and blur radius
- **Pill** toggle plus colour, opacity, and corner radius
- **Enter / exit animation kind and duration**

Edits are local until you click **Save as preset…** — that captures the
current draft, prompts for a name, and stores a new custom preset in the
project. Custom presets show up in the swatch grid alongside the built-ins.

### Importing and exporting preset files

Caption presets can be shared between projects via `.caption-preset.json`
files:

- **Export preset** writes the currently selected preset to a JSON file
  using the system file picker (with an `<a download>` fallback). The
  filename derives from the preset label.
- **Import preset** opens a JSON file, validates it, assigns a fresh
  internal id, and adds it to the project's custom presets. If a custom
  preset with the same label already exists, you're asked whether to
  update it in place or keep both.

Preset files are capped at 64 KiB — they're text styling records with no
embedded raster data, so a much smaller size is plenty.

There is no network involvement in any of this: import and export use only
your local file system.

### Karaoke word timings

When a segment includes per-word timing entries, the caption highlights the
currently spoken word in the preset's highlight colour. Word timings are
stored on the segment as an array of `{ text, startS, endS }` entries
relative to the project timeline. Editing the segment text afterwards does
not invalidate the timings: if a word index falls past the end of the
edited text the highlight falls back to the full-line raster rather than
showing a stale word.

Splitting or merging a karaoke segment partitions or concatenates the word
array along with the text, so highlighting continues to work on both pieces
after a split and on the combined segment after a merge.

Automatic word timings from the on-device speech recognition engine (when
that lands in a future phase) populate the same field — no schema migration
will be needed.

### Non-Latin script support

Glyph rendering uses the bundled LocalCut fonts with a CJK font fallback
stack (`Noto Sans SC`, `PingFang SC`, `Microsoft YaHei`). Characters that
aren't covered by the bundled font fall back to the system fonts on your
machine. No CJK font is bundled with the app.

## Burned-in versus sidecar export

In the exporter:

- **Burn-in** writes the styled caption raster — including glow, pills, and
  karaoke highlights — into the program video frames. The preview and the
  exported video render identically.
- **Sidecar** writes a separate plain-text SRT or VTT file alongside the
  video. Sidecar files never carry styling information: SRT and VTT have no
  standard way to express glow or per-line pills, so the sidecar is always
  unstyled and is only meant for downstream players that overlay their own
  subtitle styling.

## Bundle portability

When you export a project as a bundle, the custom caption presets you've
saved travel inside `project.json`. Importing the bundle on another
machine restores those presets verbatim; segment references to them keep
working because the preset ids round-trip exactly.

## Where things live

- The caption inspector and override form: **Text > Captions**,
  under the active track's controls.
- Custom preset JSON files (when you export them): wherever you chose to
  save them on disk.
- The project's custom preset list: `project.json` inside the project
  bundle, or the autosaved snapshot in browser storage.
