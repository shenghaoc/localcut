# Converting media

**Convert** turns one media file into another format — MP4 to WebM, MOV to MP4,
or pulling the audio out of a video as MP3 — without adding it to your timeline.
It's a quick utility for when you just need a different format, not an edit.

Like everything else in the app, conversion runs **entirely in your browser**.
Your files never leave your device, there's no upload, and it works offline.

## Opening Convert

Choose **Project → Convert media…**, or search "Convert media" in the command
palette (⌘K / Ctrl-K). The converter opens over the editor; your project stays
exactly as you left it. Press **Escape** or **Back to editor** to return.

## Converting a file

1. **Add files** — drop them on the drop zone, or click to choose. You can add
   several at once, including the same file twice to make two formats.
2. **Pick a format** — each file gets a **Convert to** menu split into two
   groups:
   - **Keep video** — MP4, WebM, MKV, or MOV. The video and audio are both kept.
   - **Audio only (removes video)** — MP3, WAV, or OGG. Only the sound is kept;
     the picture is dropped. The row warns you when this will happen.
3. **Pick a quality** — High, Medium, or Low. Lower quality means a smaller file.
4. **Convert**, then **Save file** when it's done. With several files ready,
   **Convert all** runs them one after another.

## Stream-copy vs. transcode

When the file already uses a codec the new container supports, conversion just
**re-packages** the existing video and audio — this is fast and lossless (for
example, an H.264 `.mov` to `.mp4`). When the codecs don't match, the file is
**re-encoded**, which takes longer and is where the quality setting applies.
The converter decides automatically; you don't have to.

## What formats are offered

The output codecs are checked against what your browser and hardware can
actually encode, so an option that can't work won't be produced — instead the
file shows a clear reason. If a file can't be read at all, it's marked
**Unreadable** rather than failing silently.

## Things to know

- **Works in every tier.** Conversion uses WebCodecs, which doesn't need the
  cross-origin isolation the accelerated editor relies on — so Convert is
  available even when the editor is in limited mode.
- **No editing here.** Convert won't trim, resize, or change frame rate in this
  release. To cut, composite, or grade, import into the timeline and use
  [Export](/docs/exporting) instead.
- **Large files.** Each converted file is held in memory until you save it, so
  very large conversions use more RAM than a timeline export, which streams
  straight to disk.
