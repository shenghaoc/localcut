# Program Mode

Program Mode lets you compose named **scenes** over live cameras, screen captures, and stills, then switch between them with hotkeys while recording. Every source is independently ISO-encoded, so after stopping you get a fully re-editable multitrack project.

## Adding sources

Each screen/window/tab capture requires exactly one picker gesture — click **+ Screen** and choose the surface. You can add multiple screen sources, each with its own picker.

Cameras are added via **+ Camera** (uses `getUserMedia`). Microphones via **+ Mic**.

Still images are imported before the session starts and composited as static layers.

### One-gesture-per-screen rule

The browser requires a user gesture for each `getDisplayMedia` call. There's no way to silently enumerate or auto-select display surfaces. Each screen source you add needs one click.

## Composing scenes

A **scene** is a named layout preset with:

- **Layers**: each references a source by ID, with position/scale/rotation/opacity/fit
- **Hotkey**: optional `1`–`9` binding for quick switching
- **Visibility**: layers can be hidden per scene

Up to 9 scenes per project. Hotkeys are optional — two scenes can't share the same non-null hotkey.

## Starting a session

1. Add your sources
2. Define your scenes (layer order, transforms, hotkeys)
3. Click **Start**

The encoder budget is checked before starting. If the hardware limit is reached (e.g., budget allows 2 concurrent sessions), you'll see an error message. Reduce the number of video sources or stop any active export.

## During a session

- Press `1`–`9` to switch scenes (hotkeys must be defined)
- The composited output preview shows in the program monitor
- Each source is independently ISO-encoded to OPFS
- Scene switches are recorded as manifest events

## Stopping

Click **Stop**. The session finalizes all ISO tracks and creates a layout track. The result is a fully re-editable multitrack project.

## Re-editing the landed project

After landing:

- **ISO tracks**: one per video/audio source, independently editable (trim, reorder, retransform)
- **layout track**: replays the scene switches through the same compositor
- Re-exporting produces output matching the live mix sequence

## Encoder budget

The encoder budget limits concurrent hardware encoder sessions. On most hardware:

- Hardware encode: 2 concurrent sessions
- Software encode: 1 concurrent session

Program mode acquires N leases (one per video source) before starting. If the budget is exhausted, the session is blocked with an explicit error.

## Browser support

Program Mode requires:

- **WebGPU** (for live compositing in the worker)
- **MediaStreamTrackProcessor** (for live frame capture)
- **WebCodecs realtime encode** (for ISO recording)
- **OPFS SyncAccessHandle** (for crash-safe writing)

Currently Chromium-only. Safari and Firefox see the panel disabled with per-probe reasons.

## Known limitations (v1)

- Accelerated-tier only (no reduced-tier fallback)
- Start/stop only (no pause/resume)
- One program session at a time
- Text source content is fixed at session start
- Cross-origin page content only via tab capture or same-origin Element Capture
