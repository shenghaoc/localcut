# Browser limitations

LocalCut Studio does all media work inside the browser, so what your browser supports decides what the app can do. This page explains the tiers, why browsers differ, and what is simply impossible on the web platform.

## Capability tiers

The app probes your browser at startup and picks the best pipeline it can:

| Tier                  | What you get                                     | What it needs                                           |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| **Accelerated**       | Full GPU preview, real-time effects, fast export | Chromium browser with WebGPU and cross-origin isolation |
| **Compatibility GPU** | Reduced GPU preview and export                   | Chromium with a compatibility WebGPU adapter            |
| **Limited WebCodecs** | Basic preview and constrained export             | WebCodecs decode without usable WebGPU                  |
| **Shell only**        | App loads; preview/export unavailable            | Any modern browser                                      |

Your current tier shows in the pipeline strip and the status bar. **Capabilities** (in the pipeline strip) lists each feature, whether it was found, and what would unlock more.

## Why browsers behave differently

- **WebGPU** powers the accelerated preview and effects. It is mature in Chromium (Chrome, Edge, Brave), newer and more limited elsewhere. No WebGPU means a reduced preview path.
- **WebCodecs** gives the app direct access to the browser's video decoders and encoders. The codec list is whatever your browser + operating system + GPU drivers provide — it is not the same everywhere. H.264 is near-universal; AV1 _encoding_ is rare without recent hardware.
- **Cross-origin isolation (COOP/COEP)** is a security mode the app's server enables so the browser allows `SharedArrayBuffer`, which the app uses as its high-precision playback clock. If the badge says **COOP/COEP needed**, the app runs in a reduced tier.
- **Optional on-device ML tools** such as Audio Cleanup and Auto Captions still need WebAssembly as the baseline. Audio Cleanup defaults to **ONNX Runtime DTLN** on the WASM (CPU) execution provider, with **LiteRT DTLN** still selectable as an alternate engine. The LiteRT engine prefers experimental WebNN first, then WebGPU, and falls back to WASM; the panel shows which accelerator actually loaded.
- **Codec licensing**: formats like AC-3 or DTS audio and some camera codecs are not licensed for browser decoding at all. Those tracks can't be read by any web app.

## Limits of browser-only editing

Honest expectations for an in-browser editor:

- **Memory and storage are browser-managed.** Very large projects compete for tab memory, and browser storage quotas cap how much working data (caches, captures, proxies) can be kept. The Diagnostics panel shows storage usage.
- **Hardware encoders are shared.** Other tabs and apps using the GPU encoder (video calls, OBS, games) can make exports slower or fail to start.
- **No raw network sockets.** Browsers cannot speak RTMP — live streaming uses WHIP/WebRTC instead (see [Live streaming](/docs/live-streaming)).
- **Files are sandboxed.** The app only sees files you explicitly pick or drop, and it can't watch folders; moved files need re-linking.

## Recommended setup

A recent **Chrome, Edge, or Brave** on a machine with a working GPU driver. Firefox and Safari load the app but currently land in reduced tiers for most workflows. If you're stuck in a reduced tier on a Chromium browser, check that hardware acceleration is enabled in browser settings and your GPU drivers are current — then see [Troubleshooting](/docs/troubleshooting).
