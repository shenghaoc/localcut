# Live streaming (WHIP publish)

LocalCut can broadcast your program output — exactly what the preview monitor
shows and plays — to a live-streaming ingest server using **WHIP**
(WebRTC-HTTP Ingestion Protocol, [RFC 9725](https://www.rfc-editor.org/rfc/rfc9725)).
Everything runs in your browser: LocalCut talks directly to the ingest server
you configure. **LocalCut never operates any relay or streaming
infrastructure, has no accounts, and sends no telemetry.**

## What you need

- A Chromium-based browser with WebRTC and insertable streams (**Capture > Go
  Live** tells you if something is missing — see
  [Capability tiers](USER-GUIDE.md)).
- A WHIP ingest endpoint URL and, usually, a bearer token (stream key) from
  your platform.

## Supported endpoint types

| Endpoint type            | Where to get the URL and token                                     | Notes                                          |
| ------------------------ | ------------------------------------------------------------------ | ---------------------------------------------- |
| **Twitch (WHIP)**        | Twitch's WHIP ingest endpoint; your stream key is the bearer token | H.264 only; keep bitrate ≤ 6000 kbps           |
| **Cloudflare-class CDN** | Your dashboard's live input → WebRTC (WHIP) URL                    | Follow the dashboard's bitrate guidance        |
| **Self-hosted MediaMTX** | `http://<host>:8889/<path>/whip`; token only if you configured one | Accepts H.264 and AV1; you control the limits  |
| **Custom WHIP URL**      | Any RFC 9725-compliant server                                      | LocalCut makes no assumptions about the server |

### RTMP-only platforms (YouTube, Douyin, Bilibili, …)

Browsers cannot speak RTMP — raw network sockets do not exist on the web
platform, in any browser. That is a hard platform boundary, not a missing
LocalCut feature. To stream to an RTMP-only platform you need a **WHIP→RTMP
gateway that you run yourself** (on your own machine or server):

1. Install [MediaMTX](https://github.com/bluenviron/mediamtx) (a single
   binary; also the reference WHIP server LocalCut tests against).
2. Configure a path that re-publishes to your platform's RTMP ingest:

   ```yaml
   # mediamtx.yml
   paths:
     mystream:
       runOnReady: >
         ffmpeg -i rtsp://localhost:8554/mystream
         -c copy -f flv rtmp://a.rtmp.youtube.com/live2/YOUR-STREAM-KEY
   ```

3. Point LocalCut at the gateway's WHIP endpoint:
   `http://localhost:8889/mystream/whip`.

See the [MediaMTX documentation](https://github.com/bluenviron/mediamtx#publish-to-the-server)
for current configuration details.

## Going live

1. Open **Capture > Go Live**.
2. Pick the endpoint type, paste the endpoint URL and bearer token.
3. Check the encode settings. Defaults are H.264 (constrained baseline, up to
   Level 4.1), 4500 kbps, a 2-second keyframe interval, and a 1080p30 cap —
   safe for every listed endpoint type. AV1 is offered only when your
   hardware supports AV1 encoding _and_ the endpoint type accepts it.
4. Click **Go Live**. The panel shows the connection state, the achieved vs
   target bitrate, round-trip time, and frame counters while streaming.
5. Click **Stop** to end the stream. LocalCut sends the standard WHIP
   `DELETE` so the server ends the session immediately rather than waiting
   for a timeout.

The stream follows the program monitor: play the timeline to send moving
video. Keyframe-interval enforcement uses the browser's
`RTCRtpSender.generateKeyFrame()` where available; otherwise the platform
encoder's default GOP applies and the panel says so.

## If the connection drops

LocalCut waits 3 seconds for the connection to heal on its own, then retries
with increasing delays (2 s, 4 s, 8 s, 16 s, 16 s — up to 5 attempts),
first trying a lightweight ICE restart and falling back to a fresh WHIP
session when the server requires it. The panel shows each attempt and the
countdown. After the fifth failed attempt the stream is marked failed and
you can go live again manually. Local playback (and recording, if active)
continues unaffected while the network leg reconnects.

## Streaming while recording

Hardware encoders support a limited number of simultaneous sessions.
LocalCut budgets them conservatively: with confirmed hardware H.264 encoding
you get two concurrent encoder sessions (so streaming alongside an export or
ISO recording is allowed); with software-only encoding you get one, and the
panel explains why simultaneous record + stream is unavailable on that
device. Starting a stream never cancels or degrades an export or recording
already in progress.

## Privacy and your stream key

- Endpoint settings are stored on this device only, never inside project
  files or project bundles — sharing a `.localcut` bundle can never leak a
  stream key.
- The bearer token is kept for the session only, unless you tick
  **Remember token on this device**; it is then stored unencrypted in your
  browser profile (the same trust model OBS uses for stream keys).
- The token is sent only to the endpoint you configured, as an
  `Authorization: Bearer` header, and never appears in logs or diagnostics.
