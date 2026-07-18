# LocalCut Studio release support boundary

LocalCut Studio's supported v1 product is a local-first desktop editing loop: import media, organise it, edit a multi-track timeline, preview the result, finish picture and sound, save or relink the project, and export on the same device.

Support is capability-based rather than tied to a browser version. A feature is available only when LocalCut's runtime probes confirm that the browser, operating system, and hardware provide the APIs and codecs it needs.

## Supported v1 editing loop

- **Import and media management** -- import common browser-readable video, audio, still-image, SRT, and VTT files; inspect source details and health warnings; organise sources in the Media Bin; and relink moved files. Exact container and codec support depends on the browser.
- **Timeline editing** -- create and manage video and audio tracks; split, trim, move, delete, copy, duplicate, insert, overwrite, ripple, roll, slip, slide, lift, and extract clips; use linked audio/video, markers, snapping, track controls, and undo/redo.
- **Preview and sound** -- play, seek, step, and loop the timeline; composite multiple tracks; mix track and clip audio; and use fades, crossfades, gain, pan, mute, solo, and meters. Preview quality and effects depend on the active capability tier.
- **Finishing** -- apply transforms, keyframes, transitions, titles, core colour controls, `.cube` LUTs, scopes, manual captions, caption burn-in, and SRT/VTT sidecar export.
- **Projects and performance** -- autosave locally, restore projects, package project bundles, relink media, generate proxies, and use the bounded local render cache.
- **Direct export** -- export supported codec/container combinations with resolution, frame-rate, bitrate, and timeline-range controls. Export choices are shown only after runtime codec probes succeed.
- **Interchange and conversion** -- export OpenTimelineIO and cuts-only CMX3600 EDL files, and use the standalone local media converter for supported inputs and outputs.
- **Application shell** -- install the PWA, use bundled help and diagnostics, and recover from missing capabilities without losing access to the shell. The app shell works offline after it has been cached; optional runtimes, models, and uncached media remain separate.

## Capability tiers

LocalCut reports one of four canonical tiers:

| Tier                   | Support boundary                                                                                                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core-webgpu`          | Full accelerated path: WebGPU, usable WebCodecs decode, `OffscreenCanvas`, `SharedArrayBuffer`, and cross-origin isolation are available. Individual encode codecs and optional features are still probed separately. |
| `compatibility-webgpu` | WebGPU compatibility rendering with usable decode and `OffscreenCanvas`. Preview is available; export is available only when an encoder probe succeeds, with reduced effects or codec choices where required.         |
| `limited-webcodecs`    | Worker-owned Canvas2D preview over WebCodecs. Compatible export is available only when an encoder probe succeeds; GPU effects and other accelerated-only features are unavailable.                                    |
| `shell-only`           | The application shell, documentation, and diagnostics remain available, but media preview and export are unavailable.                                                                                                 |

## Export truth

LocalCut does not promise a codec merely because the container appears in the UI. It probes the browser before offering:

- H.264 in MP4 when H.264 encoding is supported.
- VP9 in WebM when VP9 encoding is supported.
- AV1 in WebM only in the `core-webgpu` tier and only when AV1 encoding is supported.

An input that can be demuxed or decoded is not necessarily encodable on the same device.

## Experimental features

These surfaces are implemented but remain experimental and may have narrower input support, incomplete workflows, or browser-specific limitations:

- Render queue and saved export presets.
- Auto Captions using the opt-in ORT Whisper runtime and model.
- Smart Reframe, including its optional face-detection model path.
- Portrait Matte using the opt-in MODNet model on ORT-WebGPU.
- Audio Cleanup using the opt-in DTLN model on ORT-WASM.
- Region and element recording sources.
- On-Device Language Tools backed by compatible Chrome built-in AI APIs. The surface stays hidden when those APIs are unavailable.
- WebNN runtime work. It is infrastructure under evaluation, not a guaranteed acceleration path for the currently shipped model features.

## Capability-gated features

- **Recording and replay** require the core tier plus compatible capture, realtime encode, audio encode, and local-storage APIs. Program Mode additionally requires transferable media-track support.
- **WHIP publishing** requires compatible WebRTC APIs and a user-supplied WHIP endpoint. It sends the program output to that external endpoint and is not a local-only operation.
- **Optional ML tools** require an explicit model/runtime download and enough compatible memory, GPU, or WASM support. They are not loaded at startup.
- **Offline use** covers assets already cached on the device. A first model/runtime download and any live-publishing workflow require a network connection.

## Unavailable out of the box

- **Landmark-driven Beauty** has a real gated ORT/WebGPU engine and UI integration, but LocalCut does not bundle a license-verified detector/landmark model pair. Its manifest remains a rejected template, its editing controls never unlock, and the feature is unavailable out of the box.
- **Frame Interpolation** has ORT-WebGPU engine groundwork and a template model manifest, but no license-verified compatible model is bundled and export-time interpolation is not wired for release. It is unavailable out of the box.

## Privacy and network boundary

Normal importing, editing, preview, analysis, project storage, and export run in the browser. LocalCut has no account system, project-sync service, application media-upload backend, or product-analytics telemetry.

Network activity still occurs in these explicit cases:

- Loading the application and uncached static assets from its host.
- Opt-in runtime and model downloads, proxied from documented upstream hosts. The proxy streams those assets; it is not a media-processing or project-storage service.
- Browser-managed downloads used by On-Device Language Tools; inference content remains on device.
- WHIP publishing to the endpoint configured by the user. A bearer token may be stored locally when the user opts in.
- Ordinary hosting and CDN request handling. Hosting infrastructure may retain operational request logs or observability data according to its configuration and provider policy.

## Not supported or out of scope

- Accounts, cloud project sync, shared projects, or multi-user collaboration.
- Mobile-optimised editing.
- Server-side transcoding, rendering, media analysis, or storage for the core editor.
- DRM-protected media.
- Guaranteed support for professional broadcast formats such as ProRes, DNxHR, or MXF.
- Direct RTMP publishing; use a user-managed WHIP endpoint or gateway.
- `.lottie` ZIP packages; plain supported Lottie JSON can be imported.
- Direct AAF or FCPXML generation. Export OTIO and convert it with external tooling when needed.
- Embedded MP4 chapter metadata; chapter sidecars are the supported output.
