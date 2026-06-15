# YouTube chapter export

Every timeline marker with a non-empty label is a candidate chapter. When you
open the **Chapters** section in the Export dialog, the editor turns those
markers into the plain-text format YouTube parses on upload — and validates
the result against YouTube's rules so you do not paste a chapter list that
silently gets ignored.

## Where the chapters come from

- The source is `ProjectDoc.markers` filtered to markers whose `label.trim()`
  is non-empty.
- Markers are sorted ascending by `time`. If no marker exists at `00:00:00`,
  the editor prepends an automatic `Intro` chapter.
- Markers past the end of the program duration are dropped (they could never
  appear).

## What "valid" means

YouTube enforces three rules; the editor reports a clear error per rule:

1. **At least 3 chapters** — including the auto-`Intro`.
2. **At least 10 seconds between consecutive chapters.** If two chapters are
   too close, the editor names the offending chapter.
3. **At least 10 seconds of headroom before the program end** — YouTube hides
   the last chapter when there is no runtime left for it. The editor names
   the chapter so you can move it earlier or extend the program.

## Output formats

- **`.chapters.txt`** — the YouTube-ready text, one line per chapter:
  `HH:MM:SS Label`.
- **`.chapters.json`** — the same data as `[ { time, label }, … ]` if you want
  to consume it elsewhere (description templates, automation, etc.).
- **Copy to clipboard** — paste straight into a YouTube video description.

## Notes on containers

Mediabunny does not currently expose a chapter-metadata API, so the editor
**does not** embed chapter markers into the exported MP4 itself. This is by
design — chapter sidecars are honest about that gap. If you upload to YouTube,
paste the `.chapters.txt` into the description and the platform creates the
chapter overlay on its end.
