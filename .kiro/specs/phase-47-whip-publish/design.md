# Design: Phase 47 — WHIP Publish

> Status: **Planned**. WHIP (RFC 9725) live publish of the program output over
> `RTCPeerConnection`, coexisting with ISO recording under an explicit
> encoder-session budget. Zero relay infrastructure; zero new runtime
> dependencies.

## Goal

Stream the program feed — the same composited video and master-bus audio the
preview plays — to a user-configured WHIP ingest endpoint. LocalCut acts as a
standards-compliant WHIP client: it POSTs an SDP offer, receives the answer,
pushes media over WebRTC, and DELETEs the session resource on stop. The user
brings the endpoint (Twitch WHIP, a Cloudflare-class CDN, or self-hosted
MediaMTX); LocalCut never operates or proxies through relay infrastructure.

## Why WHIP over RTCPeerConnection (and not RTMP/SRT)

Browsers expose exactly one low-latency media egress primitive:
`RTCPeerConnection`. RTMP and SRT require raw TCP/UDP sockets that the web
platform does not grant, so they are structurally impossible client-side —
not merely out of scope. WHIP (RFC 9725) is the IETF-standard HTTP signaling
shim that turns a peer connection into a broadcast ingest: one `POST` for the
offer/answer, one `DELETE` for teardown, `PATCH` for ICE restart. Twitch,
Cloudflare, and MediaMTX all terminate it natively.

A consequence we embrace rather than fight: with WebRTC, **the browser's
internal media engine does the encoding**, not a JS-owned `VideoEncoder`.
That keeps every architectural hard gate intact — no sustained encode loop in
JS anywhere, main thread included — at the cost of indirect encoder control
(`setCodecPreferences`, `setParameters({ maxBitrate })`,
`generateKeyFrame()` via encoded transforms) instead of a full WebCodecs
config. The design treats those knobs as the contract and labels anything the
platform won't honour (R2.4).

## Non-goals

- **RTMP or SRT output** — no raw sockets in browsers; RTMP-only platforms
  (YouTube, Douyin, Bilibili) are served by a *user-supplied* WHIP→RTMP
  gateway such as MediaMTX, documented but never operated by LocalCut.
- **Simulcast / ABR ladders** — one encoded rendition per session; the ingest
  service transcodes if it wants renditions.
- **Chat, overlays, alerts, or platform-API integrations** — LocalCut speaks
  WHIP and nothing else to the platform.
- **Any hosted relay, account system, or telemetry** — the only network
  traffic is the user-initiated WHIP exchange and the resulting WebRTC flows.
- **Streaming arbitrary inputs (camera/screen) without the timeline** — the
  publish source is the program output; ISO recording and capture sources are
  their own phases.

## Architecture: where things run

`RTCPeerConnection` does not exist in dedicated workers, so the session
object and WHIP HTTP signaling live on the **main thread** — both are
control-plane (a handful of fetches and SDP strings; no per-frame work). The
media data-plane stays worker-fed and zero-copy in JS:

```
            pipeline worker                          main thread
  ┌────────────────────────────────┐      ┌───────────────────────────────┐
  │ compositor (P12/P13/P15)       │      │ WhipSession                   │
  │   │ clone() program VideoFrame │      │  ├ RTCPeerConnection          │
  │   ▼                            │      │  ├ WhipHttpClient (fetch)     │
  │ PublishFrameTap                │      │  │   POST / PATCH / DELETE    │
  │   │ latest-frame-wins,         │      │  ├ ReconnectController        │
  │   │ closes drops               │      │  └ StatsPoller (≤1 Hz)        │
  │   ▼                            │      │           ▲                   │
  │ MediaStreamTrackGenerator ─────┼──────┼─► track (transferred)         │
  │   (video; worker-side when     │      │                               │
  │    transferable tracks exist)  │      │ AudioContext master bus ──►   │
  └────────────────────────────────┘      │ MediaStreamAudioDestination   │
                                          │   └─► audio track             │
                                          └───────────────────────────────┘
```

Encoding happens inside the browser's WebRTC media stack (its own threads),
so hard gate 1 (interactive main thread) and hard gate 2 (no CPU pixel
round-trips) hold by construction. The SAB playback clock is untouched: the
frame tap is data-plane, not the clock (R4.5).

**Fallback when `MediaStreamTrack` transfer is unsupported:** the generator
runs on main and the worker posts each cloned `VideoFrame` (transferable)
with a one-in-flight bound. This is a labeled compatibility path detected by
the R3.1 probes, not the default.

## Components

### `src/engine/whip-client.ts`

Pure WHIP HTTP logic with injected `fetch` — fully unit-testable in Node.

```typescript
interface WhipClientConfig {
  endpointUrl: string;
  bearerToken: string | null;
  fetchFn: typeof fetch;            // injected for tests
}

interface WhipPublishResource {
  resourceUrl: string;              // resolved Location header
  iceServers: RTCIceServer[];       // parsed Link rel="ice-server"
  answerSdp: string;
}

interface WhipClient {
  publish(offerSdp: string): Promise<WhipPublishResource>;       // POST, ≤3 chained 307s
  patchIceRestart(resourceUrl: string, fragment: string): Promise<'ok' | 'unsupported'>;
  teardown(resourceUrl: string): Promise<void>;                  // DELETE, keepalive
}
```

Error mapping per R1.5 is a typed result, not thrown strings:
`{ kind: 'rejected-offer' | 'auth' | 'not-found' | 'retryable'; status: number }`
(`400` → `rejected-offer`, fail fast — retrying a bad SDP is futile). Tokens are
attached as `Authorization: Bearer` headers and never echoed into errors,
logs, or diagnostics (R1.2).

### `src/engine/whip-session.ts`

Main-thread session orchestrator: owns the `RTCPeerConnection` (factory
injected for tests), wires transceivers (`sendonly` video + audio), applies
`setCodecPreferences` and `setParameters`, waits for ICE gathering with a
timeout before POSTing (no trickle on initial offer, R1.6), and drives the
state machine:

```
 idle ──start──► connecting ──answer+connected──► live
                     │                              │ ice failed / grace expiry
                     │ auth / not-found            ▼
                     ▼                        reconnecting ──restored──► live
                  failed ◄──max attempts──────────┘
                     ▲
 live/reconnecting ──user stop──► ended (DELETE always issued first)
```

### `src/engine/whip-reconnect.ts`

`ReconnectController`: pure state machine over injected timers. Policy
(R5.2): 3 s grace on `disconnected`; on `failed` try ICE restart via `PATCH`
(`application/trickle-ice-sdpfrag`); on `405`/`501` or restart failure, full
re-`POST` as a new session; backoff 2 s → 4 s → 8 s → 16 s → 16 s (capped),
max 5 attempts, then terminal `failed`. Unit-tested with fake timers across
every branch.

### `src/engine/encoder-budget.ts`

A small ledger shared by encoder consumers (WHIP publish, ISO recording,
export). `acquire(kind): EncoderLease | 'budget-exhausted'`; leases are
released exactly once. Budget derivation: probe says hardware encode
supported → default 2 concurrent sessions (typical NVENC/VideoToolbox floor);
software-only → 1. The budget is a conservative gate, not a measurement —
exceeding real hardware limits fails at the driver, so we stay under the
floor and say so in the UI (R3.3). Record+stream is offered only when a
second lease is available *before* any peer connection exists (R3.4).

### `src/engine/publish-frame-tap.ts` (worker)

Hooks the compositor's program output. Clones the already-produced
`VideoFrame`, writes to the `MediaStreamTrackGenerator` writer; if a write is
still pending, the previous pending clone is closed and replaced
(latest-frame-wins, R4.2), with a dropped-frame counter for diagnostics.
Close-exactly-once is upheld across write/drop/stop/error — same discipline
as the Phase 27 decode bridge. Audio: master-bus tap via
`MediaStreamAudioDestinationNode` on the existing `AudioContext` (R4.4); the
WebRTC stack does the Opus encode.

### `src/engine/capability-probe-v2.ts` (extended)

New probes following the existing pattern, surfaced in
`CapabilityProbeResult`:

```typescript
interface LivePublishProbeResult {
  rtcPeerConnection: FeatureSupport;
  trackGeneratorWorker: FeatureSupport;   // MediaStreamTrackGenerator in worker
  trackTransfer: FeatureSupport;          // transferable MediaStreamTrack
  rtpScriptTransform: FeatureSupport;     // keyframe-interval enforcement
}
```

`rtcPeerConnection: 'unsupported'` hides the publish feature with a
reduced-tier explanation (R3.1); the others select data-plane mode and
whether the keyframe-interval control is live or labeled best-effort.

### `src/ui/PublishPanel.tsx`

Endpoint-type presets, URL + token fields, codec/bitrate/keyframe/resolution
controls, live state + stats display, and the RTMP-honesty copy (R6.2).
Talks to the session via the protocol messages below; holds no media objects.

### `src/protocol.ts` (extended)

Following existing command/state naming:

```typescript
// commands (UI → worker)
| { type: 'publish-tap-start'; mode: 'worker-track' | 'main-frames' }
| { type: 'publish-tap-stop' }

// state (worker → UI)
| { type: 'publish-tap-track'; track: MediaStreamTrack }   // transferred
| { type: 'publish-tap-frame'; frame: VideoFrame }         // fallback mode, one in flight
| { type: 'publish-tap-stats'; framesDelivered: number; framesDropped: number }
```

Session state for the UI is main-thread-local (the session lives on main),
typed as:

```typescript
type PublishState =
  | { phase: 'idle' }
  | { phase: 'connecting' }
  | { phase: 'live'; stats: PublishStats }
  | { phase: 'reconnecting'; attempt: number; nextRetryMs: number }
  | { phase: 'ended' }
  | { phase: 'failed'; reason: PublishFailureReason };

interface PublishStats {
  bitrateKbps: number;       // achieved, from getStats
  rttMs: number | null;
  framesSent: number;
  framesDropped: number;
}
```

## Codec negotiation and platform guidance

Defaults per endpoint type (overridable within validated ranges, R2.3):

| Endpoint type        | Video codec        | Default / cap bitrate | Keyframe | Notes                                   |
| -------------------- | ------------------ | --------------------- | -------- | --------------------------------------- |
| Twitch WHIP          | H.264 baseline     | 4500 / 6000 kbps      | 2 s      | Twitch guidance caps ingest at ~6 Mbps  |
| Cloudflare-class CDN | H.264 baseline     | 4500 / 8000 kbps      | 2 s      | Follow the dashboard's per-input limits |
| Self-hosted MediaMTX | H.264 (AV1 opt-in) | user-set, 4500 default| 2 s      | AV1 only when probe + server allow      |
| Custom WHIP URL      | H.264 (AV1 opt-in) | 4500 default          | 2 s      | No assumptions about the server         |

H.264 constrained baseline negotiated up to Level 4.1 (`42e029`,
packetization-mode 1) is the lowest-common-denominator default every listed
ingest accepts, with enough level headroom for the 1080p30 stream cap
(Level 3.1 would top out at 720p30). AV1 is gated
twice: the Phase 26 `av1Encode` probe **and** an endpoint type known to take
it (R2.2). Audio is always Opus at 128 kbps stereo (WebRTC mandatory codec).
Keyframe cadence uses `RTCRtpScriptTransform` + `generateKeyFrame()` on a
timer where supported; otherwise the platform GOP applies and the control is
labeled accordingly (R2.4) — an honest label beats a fake knob.

## Settings and secret handling

Publish settings live in a new app-scoped IndexedDB store
(`PUBLISH_SETTINGS_STORE` in `src/engine/persistence.ts`), **not** in
`ProjectDoc` — destinations are device-scoped, and keeping them out of the
project document means Phase 23 bundles and autosaves structurally cannot
leak them (R7.3; a test asserts the bundle serializer's input contains no
publish settings). The bearer token is session-only unless the user opts into
"remember token on this device", with plain copy that it is stored
unencrypted in the browser profile — the same trust model OBS uses for
stream keys (R7.2). No project schema bump is needed.

## Diagnostics (Phase 25 integration)

The publish subsystem contributes to the diagnostic snapshot: probe findings
(`publish.rtc`, `publish.track-transfer`, …), session lifecycle events with
HTTP statuses (token redacted), reconnect attempts, achieved-vs-target
bitrate, and tap drop counters. The `StatsPoller` runs at ≤ 1 Hz and stops at
`ended`/`failed` (R5.4, R5.5).

## Third-party additions

- **No new runtime dependencies.** WHIP is `fetch` + `RTCPeerConnection` +
  insertable-streams APIs, all native.
- **`@playwright/test` (devDependency)** — needed because the acceptance
  criteria require a real browser publishing to a real ingest in CI; Vitest's
  Node environment has no WebRTC. Meets the AGENTS.md bar: Microsoft-backed,
  actively developed, industry-standard. Scope is deliberately narrow per the
  testing steering: one spec file for the publish flow; everything else stays
  in Vitest.
- **MediaMTX (CI-only container, `bluenviron/mediamtx`)** — not a dependency
  of the app; pulled only in the integration workflow as the reference WHIP
  ingest. Actively developed, the de-facto self-hosted WHIP server, and the
  same software our docs recommend users run as a WHIP→RTMP gateway — so CI
  exercises exactly what we document.

## Validation

- **Unit (Vitest, Node, co-located):** `whip-client.test.ts` (mocked fetch:
  POST/201/Location resolution, bearer header on all verbs, Link ice-server
  parsing incl. TURN credentials, bounded 307 chain (≤3, then fail fast),
  error mapping incl. `400` → rejected-offer, DELETE with keepalive);
  `whip-reconnect.test.ts` (fake timers: grace period,
  PATCH-unsupported fallback to re-POST, full backoff ladder, max-attempts
  terminal state); `encoder-budget.test.ts` (acquire/release, exhaustion,
  double-release guard); `publish-frame-tap.test.ts` (mocked generator
  writer: latest-frame-wins, drop counting, close-exactly-once across stop
  and error); persistence test proving bundle serialization excludes the
  publish store; protocol type guards. No media fixtures.
- **Integration (Playwright + MediaMTX container, separate CI job):** publish
  a synthetic program feed to the container's WHIP endpoint; assert via the
  MediaMTX API that the session exists and `bytesReceived` grows; stop and
  assert `DELETE` removed the session; restart the container mid-stream and
  assert the client walks `reconnecting` → `live` with a fresh session per
  the documented policy (R8.3, R8.4).
- **Manual smoke:** publish to a locally run MediaMTX, watch the stream in a
  second tab via MediaMTX's WebRTC reader page, verify record+stream gating
  on a software-encode-only profile, and verify the reduced-tier explanation
  with WebRTC disabled.
