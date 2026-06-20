# Language tools (on-device)

Language Tools are an **optional, Chrome-only** bonus built on Chrome's built-in AI. They run
**entirely on your device** — nothing is uploaded, and there is **no cloud fallback**. On browsers
that don't expose these APIs (Firefox, Safari, most Chromium derivatives, or hardware below
Chrome's requirements), the feature is simply hidden — everything else in the app works exactly
the same.

When available, Language Tools appear under **Text > Language Tools** and are also reachable from the command palette (**⌘K** / **Ctrl+K** → **Language Tools**):

- **Translate captions** — turn a caption track into a second, timing-identical track in the other
  language (zh ⇄ en), ready for bilingual subtitle export.
- **Draft** — turn a track's transcript into suggested titles, hashtags, and a 文案 (social
  caption) you can copy.

## Requirements

- A recent **desktop Chrome** (the built-in AI APIs and their on-device models).
- Enough free disk and a capable GPU — Chrome enforces its own hardware floor and reports the
  feature as unavailable below it (in which case the button never appears).
- A **one-time model download per tool**, managed by Chrome:
  - Translation language packs are small (on the order of tens of MB per language pair).
  - Drafting uses Gemini Nano, a multi-GB model that Chrome downloads **once** and shares across
    every site — so it's only fetched the first time anything on your machine needs it.
- The first time you use a tool, you'll see a **download progress** indicator. After that, the
  tool works **offline**.

We never host, fetch, or cache these models ourselves — Chrome owns them.

## Translate captions

1. Import or auto-generate a caption track first (see **Importing media** / auto captions).
2. Open **Text > Language Tools**, pick the **source track**, and choose a **target** — leave it on
   **Auto-detect** to let the on-device detector pick the direction, or force English/Chinese.
3. Click **Translate**. Each caption is translated individually, so the new track has the **exact
   same timing** as the source — only the text changes.

The result is an ordinary caption track: editable, undoable, and exportable like any other.

> **Note:** because captions are translated cue-by-cue to preserve timing, a sentence split across
> two cues is translated as two fragments. This keeps subtitles perfectly aligned at the cost of a
> little cross-cue context.

### Bilingual export

Export the **source** and the **translated** track as separate SRT/VTT sidecars (with
language-suffixed names, e.g. `clip.en.srt` and `clip.zh.srt`) through the normal caption export —
no special export mode is needed.

## Draft (titles / hashtags / 文案)

1. Pick a source track and click **Generate Draft**.
2. The transcript is summarised on-device, then used to draft a few title options, a set of
   hashtags, and a short 文案. Output streams in as it's generated.
3. Use the **copy** buttons to copy any field.

Drafts are **suggestions only**. They are read-only and are **never written into your project** —
copy whatever is useful and paste it wherever you like.

If only the summariser is available (and not the Prompt model), you'll still get a short
description you can copy.

## Privacy

All translation and drafting run on your device through Chrome's built-in AI. No captions,
transcripts, or media ever leave your browser, and there is no cloud API — by design, and
permanently.
