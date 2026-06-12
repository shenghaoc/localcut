# FAQ

## Is my footage uploaded anywhere?

No. Media is read from your disk, edited on your machine, and exported on your machine. There is no server-side processing, no account, and no telemetry. The app even works offline after the first load.

## Where is my project stored?

In your browser's local storage (IndexedDB) on this computer, autosaved continuously. Clearing the browser's site data deletes projects and working caches — export a **project bundle** (toolbar, next to Export) first if you want a portable backup including media.

## Why does the app want Chrome/Edge/Brave?

The accelerated pipeline is built on WebGPU and WebCodecs, which are most complete in Chromium browsers today. Other browsers run the app in reduced tiers. Details in [Browser limitations](/docs/browser-limitations).

## A file plays in my media player but won't import. Why?

Browsers ship a fixed set of licensed codecs. Formats like AC-3/DTS audio or some camera codecs can't be decoded by _any_ web app. The import warning names the problematic codec; re-encoding to H.264 MP4 fixes nearly all cases. See [Importing media](/docs/importing-media).

## Why are some codecs missing from the export dialog?

The list is probed from your actual browser and hardware — only encoders that really exist on your machine are offered. AV1 encoding, for example, needs recent hardware. The **Why?** link in the export dialog shows the specific constraint.

## Can I stream to YouTube or Twitch?

Twitch has a WHIP ingest that works directly. RTMP-only platforms (YouTube and others) need a small self-hosted WHIP→RTMP gateway, because browsers cannot open RTMP connections. See [Live streaming](/docs/live-streaming).

## Is there a file size or length limit?

No fixed limit, but browser memory and storage quotas are real constraints — very long or very high-resolution timelines need a capable machine. The Diagnostics panel shows storage usage.

## Does editing change my original files?

Never. Edits are non-destructive instructions in your project; originals on disk are read-only to the app.

## Can I move a project to another computer?

Yes — use **Export Bundle** to package the project file and all media into one folder, then **Import Bundle** on the other machine. A `project.otio` interchange file is included for opening the cut in other editors (DaVinci Resolve, Kdenlive).

## Why did my project open with "offline" media?

The project references files by location; if a file moved or the browser lost permission, it shows as offline. Click **Re-link** and pick the file again. See [Troubleshooting](/docs/troubleshooting).
