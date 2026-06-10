# Requirements: Phase 47 — WHIP Publish

LocalCut gains a live-publish path: the program output (the same composited
feed the preview shows) can be streamed to a WHIP ingest endpoint per
**RFC 9725** over `RTCPeerConnection`. Everything runs client-side — LocalCut
talks directly to the user's chosen ingest server and never operates or
proxies through relay infrastructure. Streaming must coexist with local ISO
recording under an explicit encoder-session budget, and every capability is
gated by the Phase 26 probe rather than assumed.

## R1 — WHIP protocol client (RFC 9725)

- **R1.1** Publishing starts with an HTTP `POST` of the SDP offer
  (`Content-Type: application/sdp`) to the configured endpoint URL. A `201
  Created` response provides the SDP answer body and a `Location` header; the
  resolved `Location` URL is retained as the session resource for the lifetime
  of the publish.
- **R1.2** When a bearer token is configured, every WHIP request (`POST`,
  `PATCH`, `DELETE`) carries `Authorization: Bearer <token>`. The token never
  appears in logs, diagnostics snapshots, or error messages.
- **R1.3** `Link` headers with `rel="ice-server"` in the `201` response are
  parsed and applied as the peer connection's ICE server configuration
  (including `username` / `credential` attributes for TURN), per RFC 9725 §4.4.
- **R1.4** Stopping the stream sends an HTTP `DELETE` to the session resource
  URL. Teardown is clean in all exit paths the client controls: user stop,
  page `pagehide`/`beforeunload` (best effort via `keepalive` fetch), and
  fatal local errors. The peer connection closes only after the `DELETE` has
  been issued.
- **R1.5** HTTP failure modes map to actionable states: `401`/`403` → invalid
  token (no retry), `404` → wrong endpoint URL (no retry), `405`/`409`/`5xx`
  and network errors → retryable per the R5 reconnect policy. Redirects
  (`307`) on the initial `POST` are followed once per RFC 9725 §4.1.
- **R1.6** ICE restart uses an HTTP `PATCH` to the session resource with
  `Content-Type: application/trickle-ice-sdpfrag` when the server advertised
  support; if the server answers `405`/`501` the client falls back to a full
  re-`POST` (new session) per the R5 policy. No trickle-ICE `PATCH` is sent
  for initial candidates — the offer waits for ICE gathering to complete
  (bounded by a timeout) so that servers without trickle support work.

## R2 — Codec negotiation and encode settings

- **R2.1** Video defaults to **H.264 constrained baseline**
  (`profile-level-id=42e01f`, `packetization-mode=1`), enforced via
  `setCodecPreferences` on the video transceiver. Audio is **Opus** (WebRTC
  mandatory-to-implement; always available).
- **R2.2** AV1 is offered as a video codec choice only when the Phase 26 probe
  reports `av1Encode: 'supported'` **and** the selected endpoint type is known
  to accept AV1 (self-hosted MediaMTX, custom). The UI labels AV1 as
  endpoint-dependent; H.264 remains the default everywhere.
- **R2.3** Target video bitrate is applied via `RTCRtpSender.setParameters`
  (`maxBitrate`) and defaults follow the per-endpoint-type guidance table in
  the design (e.g. ≤ 6000 kbps for Twitch-class ingest). Users can override
  within a validated range; the UI shows the platform-recommended cap for the
  selected endpoint type.
- **R2.4** Keyframe interval (default 2 s) is enforced by a timer calling
  `generateKeyFrame()` through an `RTCRtpScriptTransform` where the browser
  supports it; where it does not, the platform encoder's default GOP applies
  and the settings UI states this plainly instead of showing a dead control.
- **R2.5** The published resolution and frame rate follow the project's
  program output; an optional stream-side cap (e.g. 1080p, 30 fps) downscales
  via `scaleResolutionDownBy` / track constraints without touching the
  preview or export pipelines.

## R3 — Capability gating and encoder-session budget

- **R3.1** The Phase 26 probe gains live-publish probes: `RTCPeerConnection`
  availability, `MediaStreamTrackGenerator` (in worker and on main),
  transferable `MediaStreamTrack`, and `RTCRtpScriptTransform`. Each reports
  `supported` / `unsupported` / `unknown` like existing probes; absence of any
  required feature hides or disables the publish UI with a reduced-tier
  explanation, never a crash.
- **R3.2** A single encoder-session budget governs hardware encoder consumers:
  WHIP publish (WebRTC's internal encoder), ISO recording, and export each
  check out a session from `src/engine/encoder-budget.ts`. The budget is
  derived from the probe (hardware vs software encode support) with a
  conservative platform default, never assumed unlimited.
- **R3.3** Simultaneous record + stream is gated explicitly: it is offered
  only when the budget grants ≥ 2 concurrent sessions, and the UI states the
  reason when it is unavailable ("hardware encoder budget allows one session
  on this device"). Starting a stream never silently degrades or cancels an
  in-progress recording or export, and vice versa.
- **R3.4** When the budget is exhausted, the publish action is blocked with a
  clear message before any peer connection is created — no partial sessions.

## R4 — Bounded program-feed tap

- **R4.1** The pipeline worker taps composited program frames into the publish
  path without adding CPU pixel round-trips: each published `VideoFrame` is a
  clone of the frame the compositor already produced, written to a
  `MediaStreamTrackGenerator` writer. Preview and export paths are unchanged.
- **R4.2** The tap is latest-frame-wins: at most one frame is in flight to the
  generator. If the writer back-pressures, older frames are dropped (and the
  drop counted), never queued unboundedly.
- **R4.3** Every cloned `VideoFrame` and `AudioData` in the publish path is
  closed exactly once across normal write, drop, error, and stop paths —
  including the frames buffered when the stream stops mid-write.
- **R4.4** Audio taps the Phase 16 master bus output (post-gain, post-pan,
  post-fades) so the stream hears exactly what the program monitor plays.
  Opus encoding is handled by the WebRTC stack, not by JS.
- **R4.5** Where transferable `MediaStreamTrack` is supported, the generator
  lives in the worker and its track transfers to main. Where it is not, the
  generator runs on main and the worker transfers frames over `postMessage`
  (bounded to one in flight). The SAB playback clock (hard gate 3) is
  untouched in both modes; this data-plane transfer is not the playback clock.

## R5 — Connection lifecycle, reconnect, and stats

- **R5.1** The publish session exposes a typed state machine: `idle` →
  `connecting` → `live` → (`reconnecting` ⇄ `live`) → `ended` /
  `failed`, mirrored to the UI via worker/main protocol messages.
- **R5.2** On `iceconnectionstatechange` → `disconnected`, the client waits a
  short grace period (default 3 s) for self-healing; on `failed` (or grace
  expiry) it attempts ICE restart (R1.6), then falls back to a full
  re-`POST`. Retries use exponential backoff (2 s, 4 s, 8 s, 16 s; max 5
  attempts) before declaring `failed`. The whole policy is documented and the
  integration test exercises it (R8.4).
- **R5.3** During `reconnecting`, the local timeline keeps playing and ISO
  recording (if active) continues unaffected; only the network leg retries.
- **R5.4** A low-rate `getStats()` poll (≤ 1 Hz) surfaces achieved bitrate,
  RTT, and dropped/sent frame counts into the publish panel and the Phase 25
  diagnostics snapshot. Polling stops when the session ends.
- **R5.5** All lifecycle transitions, HTTP status codes (without tokens), and
  retry attempts are recorded in the diagnostics ring so a failed session can
  be explained after the fact.

## R6 — UI: endpoint presets and honest platform guidance

- **R6.1** The publish panel offers endpoint-type presets: **Twitch WHIP**,
  **Cloudflare-class CDN (WHIP)**, **self-hosted MediaMTX**, and **Custom
  WHIP URL**. Each preset pre-fills bitrate/keyframe guidance and a URL hint;
  the user supplies the endpoint URL and bearer token (stream key).
- **R6.2** The panel states plainly that RTMP-only platforms (YouTube, Douyin,
  Bilibili) require a user-supplied WHIP→RTMP gateway, links the MediaMTX
  documentation for running one, and makes explicit that LocalCut never
  operates relay infrastructure. No UI copy implies LocalCut can reach RTMP
  endpoints directly.
- **R6.3** Connection state, achieved vs target bitrate, and reconnect
  attempts are visible in the panel while live; failures show the mapped
  reason from R1.5 (e.g. "endpoint rejected the token") rather than raw
  exceptions.
- **R6.4** The panel follows the UI standards steering (dark professional
  aesthetic, keyboard accessible, ARIA live region for state changes) and the
  go-live action requires an explicit click — never autostarts.

## R7 — Settings persistence and secret handling

- **R7.1** Publish settings (endpoint type, URL, codec, bitrate, keyframe
  interval, resolution cap) persist in an app-scoped IndexedDB store, not in
  `ProjectDoc` — stream destinations are device/account-scoped, not project
  content.
- **R7.2** The bearer token is session-only by default. Persisting it requires
  an explicit "remember token on this device" opt-in, and the UI notes it is
  stored unencrypted in the browser profile (consistent with how OBS stores
  stream keys).
- **R7.3** Publish settings — and especially tokens — are **never** included
  in Phase 23 project bundles, autosaves of `ProjectDoc`, or any export.
  A test asserts the bundle serializer cannot see the store.
- **R7.4** No telemetry, no accounts, no server: the only network traffic this
  phase introduces is the user-initiated WHIP HTTP exchange and the WebRTC
  media/ICE flows to the user's configured endpoint.

## R8 — Tests, CI integration, and docs

- **R8.1** Unit tests (Vitest, Node environment, co-located) cover: WHIP HTTP
  client against a mocked `fetch` (POST/201/Location, bearer header, Link
  ice-server parsing, DELETE on stop, 401/404/5xx mapping, single-redirect
  follow); the reconnect state machine with fake timers (grace period,
  backoff sequence, max attempts, PATCH-then-re-POST fallback); the
  encoder-budget ledger; the frame-tap drop/close accounting with mocked
  generator writers; and protocol type guards. No large media fixtures.
- **R8.2** The publish state machine and WHIP client are pure-logic modules
  with injected `fetch`/timers/`RTCPeerConnection` factories so they test
  without a browser.
- **R8.3** A CI integration job runs a **MediaMTX container** and drives a
  Playwright Chromium session that publishes a synthetic program feed to
  MediaMTX's WHIP endpoint, then asserts via the MediaMTX API that the ingest
  session exists and media is flowing (bytes received increasing).
- **R8.4** The same integration job verifies: (a) user stop issues `DELETE`
  and the MediaMTX session disappears; (b) a mid-stream network drop
  (container restart) drives the client through `reconnecting` and back to
  `live` with a new ingest session, matching the R5.2 policy.
- **R8.5** Playwright is used only for this UI-critical publish flow; all
  other coverage stays in Vitest. The integration job is separate from the
  existing build/test job so unit CI stays fast and container-free.
- **R8.6** `docs/LIVE-STREAMING.md` documents setup per endpoint type, the
  WHIP→RTMP gateway requirement for RTMP-only platforms (with MediaMTX
  config example), the reconnect policy, and the record+stream budget rules;
  `docs/USER-GUIDE.md` links to it. `npm run build` and `npm test` stay
  green and the test count grows.
