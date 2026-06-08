# Bundled title fonts (offline-safe)

These open-licence fonts are loaded in the pipeline worker via `FontFace` before
the first title raster (see `src/engine/titles.ts`). They are bundled so the PWA
renders titles **offline** — no network font fetch is ever required. If a file is
missing or blocked, the raster falls back to the browser's generic `sans-serif`
family, which is also offline-safe.

| File                  | Family (`fontFamily`) | Source | Licence                       |
| --------------------- | --------------------- | ------ | ----------------------------- |
| `localcut-sans.woff2` | `LocalCut Sans`       | Inter  | SIL OFL 1.1 (`Inter-OFL.txt`) |
| `localcut-serif.ttf`  | `LocalCut Serif`      | Lora   | SIL OFL 1.1 (`Lora-OFL.txt`)  |

`queryLocalFonts` is a feature-detected enhancement only (see
`hasLocalFontAccess`) and is never required for titles to render.
