# Design: Design-system foundation and editor-chrome hardening

> Status: **Implemented and verified.**

## Intent

Turn the existing precision-instrument restyle into a coherent, documented
foundation while closing the interaction defects exposed by the final review.
This is a chrome change, not a media-render redesign. The engine's project
schema, callout defaults, padded-background defaults, worker protocols,
render/export paths, and undo model remain unchanged.

## Sources of truth

| Concern | Authority |
| --- | --- |
| Product personality and platform promise | [`PRODUCT.md`](../../../PRODUCT.md) |
| Palette, type, radius, spacing, component rules | [`DESIGN.md`](../../../DESIGN.md) |
| Runtime token values and responsive cascade | [`src/global.css`](../../../src/global.css) |
| Generated design metadata | [`.impeccable/design.json`](../../../.impeccable/design.json) |
| Accessible primitives | Ark UI plus focused SolidJS wrappers |

Kiro steering links to the root design context. Generated session caches and
critique files are deliberately not product artifacts.

## Visual foundation

The runtime maps the design context onto a single warm-dark ramp and a single
film-stock amber interaction accent. Semantic signal colours never become
selection or focus colours. DM Sans carries chrome; JetBrains Mono carries
timecodes and technical data. Panels use 1px boundaries and restrained 1–6px
radii. Shadows are limited to genuinely floating surfaces.

Historical cyan contracts in the Ark refresh and post-merge chrome cleanup are
structural history, not current palette authority. Their specs explicitly link
here where the amber foundation supersedes visual tokens.

## Component and module boundaries

- `App.tsx` composes existing panels and places Replay before Record; it does not
  own replay logic.
- `SecondaryRailTabs.tsx` owns the accessible relationship between secondary
  navigation and its panel, including the solo-destination label.
- `CaptionStyleInspector.tsx` owns caption-preset interaction. A focused
  `CaptionPresetDialog` helper centralises native-dialog open/close/focus
  semantics without creating a general modal framework.
- `global.css` owns visual tokens and responsive layout. Final authoritative
  media/coarse-pointer rules live after general desktop rules to avoid equal-
  specificity regressions.
- Engine render defaults remain with their existing engine types. Chrome colour
  tokens are not imported into persisted media payloads.

No duplicate component, navigation, persistence, or rendering system is added.

## Capture and Replay information architecture

Capture's secondary choices are Record, Program, and Go Live. Replay is a
section of the Record workflow because it uses the same capture source and
prerequisites. Within the Record panel, the collapsed Replay header comes first;
the recorder form follows. Both use content-sized flex behaviour so an expanded
Replay section exposes Start Capture without a hidden nested full-height panel.

## Caption preset modal flow

`CaptionPresetDialog` renders a native `<dialog>` and calls `showModal()` after
mount. Native modality provides background inertness and focus containment.
The helper labels/describes the dialog, selects an explicit initial-focus target,
handles native cancel/Escape, closes during cleanup, and lets the browser restore
focus to the invoking control.

The name prompt state contains the suggested label plus snapshots of the base
and edited preset. It remains mounted while that object exists, even when the
input value is empty. Conflict state uses an alert dialog; Cancel leads, Save a
copy is the trailing safe default, and Update existing uses the destructive
treatment because it overwrites a saved preset.

## Responsive strategy

The final cascade is measured against actual toolbar content rather than named
device categories:

- `>=1500px`: full single-row toolbar.
- `1184–1499px`: compact single-row toolbar; edit history, snap modes, source
  format, and the meter strip collapse, while master gain remains.
- `980–1183px`: the same compact controls in a two-row toolbar; the editor grid
  remains desktop-like.
- `901–979px`: compact controls may wrap to a third row while the editor grid
  remains desktop-like and every required command stays visible.
- `<=900px`: one-column workspace and stacked toolbar.
- `<=560px`: phone-sized preview, rail, dock, and timeline refinements declared
  after the tablet rules.
- `pointer: coarse`: interaction rows and targets expand together after all
  fixed desktop heights.

`html` and `body` own the usable viewport; `#root` fills its parent. Fixed and
full-page surfaces consume safe-area variables directly. Containers that can
host fixed descendants use `contain: style`, never `contain: layout`.

## Desktop/HIG alignment

The interface keeps familiar desktop patterns: explicit menus for taxonomy,
toolbar controls for frequent commands, concise status and destructive labels,
native modal keyboard behaviour, a conservative default on replacement, and
visible disabled states. The web editor does not imitate macOS chrome; it follows
the platform interaction expectations that matter—keyboard access, focus return,
modality, predictable cancellation, and clear destructive hierarchy.

## Verification design

Unit tests protect pure labels and source-copy invariants. Real-browser component
tests exercise native dialog focus/Escape/modality and computed CSS. A live app
sweep measures toolbar overflow and Capture/Replay geometry and supplies visual
evidence. The CI-equivalent gate remains the final authority.
