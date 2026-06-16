# Animated Overlays

LocalCut Studio can use animated images, Lottie animations, and alpha-channel video clips as overlays on tracks above your main footage. They composite through the same WebGPU pipeline as everything else, so transforms, opacity, and effects work on them the same way.

## Animated Images (WebP, AVIF, GIF)

Animated WebP, AVIF, and GIF files can be imported as image sources. On browsers that support the `ImageDecoder` API for the specific codec (current Chromium covers all three; Safari supports most), animations play frame-accurately at their authored per-frame delays.

If your browser exposes `ImageDecoder` but doesn't support the file's specific codec, or doesn't have the API at all (Firefox today), the import falls back to a static still showing the first frame. When that happens you'll see a non-blocking **"static (browser limitation)"** info warning on the import so the silent first-frame behaviour isn't mistaken for "the animation just isn't playing yet".

## Lottie Animations

Plain `.json` Lottie files (exported from After Effects, LottieFiles, etc.) can be imported as overlay sources. The animation plays frame-accurately in the pipeline worker using lottie-web, and the clip's duration matches the animation's natural length instead of the still-image default.

**Note**: `.lottie` zip containers are not yet supported. The import is rejected with a structured `lottie-zip-unsupported` warning — export plain `.json` from your Lottie tool to use it here.

## Alpha Video Overlays

VP9 and AV1 video files with alpha channels can be used as overlays. Place the alpha video on a higher track; the compositor's premultiplied-alpha over-blend composites it automatically over lower tracks.

If your browser cannot decode alpha (the VP9/AV1 decode probe is unsupported), the video imports as opaque with an **"Alpha channel not decoded"** warning in the media bin so you don't get a silently-broken composite.
