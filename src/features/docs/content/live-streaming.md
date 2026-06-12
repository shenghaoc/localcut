# Live streaming

LocalCut Studio can broadcast the program output — exactly what the preview shows and plays — to a live-streaming ingest server using **WHIP** (WebRTC-HTTP Ingestion Protocol). The browser talks directly to the ingest server you configure; LocalCut operates no relay, has no accounts, and sends no telemetry.

## What you need

- A Chromium-based browser with WebRTC (the **Go Live** panel tells you if something is missing).
- A WHIP ingest endpoint URL and, usually, a bearer token (stream key) from your platform.

## Supported endpoints

| Endpoint type            | Where to get URL and token                                    | Notes                                   |
| ------------------------ | ------------------------------------------------------------- | --------------------------------------- |
| **Twitch (WHIP)**        | Twitch's WHIP ingest endpoint; stream key is the bearer token | H.264 only; keep bitrate ≤ 6000 kbps    |
| **Cloudflare-class CDN** | Dashboard live input → WebRTC (WHIP) URL                      | Follow the dashboard's bitrate guidance |
| **Self-hosted MediaMTX** | `http://<host>:8889/<path>/whip`                              | Accepts H.264 and AV1                   |
| **Custom WHIP URL**      | Any RFC 9725-compliant server                                 | No assumptions made about the server    |

### RTMP-only platforms (YouTube and others)

Browsers cannot speak RTMP — raw network sockets don't exist on the web platform. To reach an RTMP-only platform, run a small WHIP→RTMP gateway yourself (MediaMTX is a single binary that does this) and point LocalCut at the gateway's WHIP endpoint.

## Going live

1. Click **Go Live** in the pipeline strip.
2. Pick the endpoint type, paste the URL and bearer token.
3. Check the encode settings — defaults are H.264, 4500 kbps, 2-second keyframes, capped at 1080p30, which is safe for every listed endpoint. AV1 is offered only when your hardware can encode it _and_ the endpoint accepts it.
4. Click **Go Live**. The panel shows connection state, bitrate, and frame statistics while streaming; **Stop** tears the session down cleanly.

## Recording while streaming

Streaming and recording share your machine's encoder sessions. The panel tells you whether record-while-streaming is available on your hardware; when the budget is too tight, recording is disabled rather than risking the live stream.

## If the stream drops

Short network interruptions trigger an automatic reconnect (ICE restart). Persistent failures show in the panel with the server's response — check the endpoint URL, token validity, and that your platform's ingest expects WHIP rather than RTMP.
