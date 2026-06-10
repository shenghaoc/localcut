# Tasks: Phase 47 — WHIP Publish

## T1 — WHIP HTTP client (R1)

- [x] **T1.1** `src/engine/whip-client.ts`: `publish(offerSdp)` POSTs
  `application/sdp` with optional `Authorization: Bearer`, relies on the
  browser to follow redirects (`redirect: 'follow'` — manual redirect counting
  is not feasible due to opaque-redirect CORS restrictions), resolves the
  `Location` header from the final `201` response, and returns
  `{ resourceUrl, answerSdp, iceServers }`.
- [x] **T1.2** Parse `Link` headers with `rel="ice-server"` (urls + optional
  `username`/`credential`) into `RTCIceServer[]` per RFC 9725 §4.4.
- [x] **T1.3** Typed error mapping: `400` → `rejected-offer`, `401`/`403` →
  `auth`, `404` → `not-found`, `405`/`409`/`5xx`/network → `retryable`;
  bearer token never appears in any error message, log line, or diagnostics
  payload.
- [x] **T1.4** `patchIceRestart()` with
  `Content-Type: application/trickle-ice-sdpfrag`, returning `'unsupported'`
  on `405`/`501`; `teardown()` issues `DELETE` with `keepalive: true` so it
  survives `pagehide`.

## T2 — Session orchestration + reconnect policy (R1, R5)

- [x] **T2.1** `src/engine/whip-session.ts`: main-thread `WhipSession` with an
  injected `RTCPeerConnection` factory; `sendonly` video + audio
  transceivers; wait for ICE gathering complete (bounded timeout) before
  POSTing — no trickle on the initial offer.
- [x] **T2.2** Typed `PublishState` machine (`idle` / `connecting` / `live` /
  `reconnecting` / `ended` / `failed`) with transitions per the design
  diagram; `ended` is reachable only after `DELETE` has been issued.
- [x] **T2.3** `src/engine/whip-reconnect.ts`: `ReconnectController` over
  injected timers — 3 s grace on `disconnected`, ICE restart via PATCH on
  `failed`, fallback to full re-POST when PATCH is unsupported, backoff
  2/4/8/16/16 s (capped at 16 s), max 5 attempts, then terminal `failed`.
- [x] **T2.4** Best-effort teardown on `pagehide`/`beforeunload` via the
  keepalive `DELETE`; local fatal errors also tear down before surfacing.
- [x] **T2.5** `StatsPoller`: `getStats()` at ≤ 1 Hz mapping achieved bitrate,
  RTT, frames sent/dropped into `PublishStats`; stops at `ended`/`failed`.

## T3 — Codec negotiation + encode settings (R2)

- [x] **T3.1** `setCodecPreferences` pinning H.264 constrained baseline up to
  Level 4.1 (`profile-level-id=42e029`, `packetization-mode=1`) by default so
  1080p30 fits the negotiated level; Opus audio.
- [x] **T3.2** AV1 offered only when `av1Encode === 'supported'` **and** the
  endpoint type allows it (MediaMTX, custom); labeled endpoint-dependent in
  the UI.
- [x] **T3.3** Bitrate via `RTCRtpSender.setParameters({ maxBitrate })` with
  per-endpoint-type defaults/caps from the design table; validated override
  range.
- [x] **T3.4** Keyframe interval (default 2 s) via
  `RTCRtpSender.generateKeyFrame()` timer where supported; otherwise the
  control reads as "platform default GOP" instead of a dead knob.
- [x] **T3.5** Optional stream-side resolution/fps cap via
  `scaleResolutionDownBy`/track constraints, leaving preview and export
  untouched.

## T4 — Capability probes + encoder-session budget (R3)

- [x] **T4.1** Extend `src/engine/capability-probe-v2.ts` +
  `CapabilityProbeResult` with `LivePublishProbeResult`: `rtcPeerConnection`,
  `trackGeneratorWorker`, `trackTransfer`, `generateKeyFrame` — same
  `FeatureSupport` pattern as existing probes.
- [x] **T4.2** `src/engine/encoder-budget.ts`: lease ledger shared by publish,
  ISO recording, and export; hardware-encode probe → budget 2, software-only
  → 1; release-exactly-once guarded.
- [x] **T4.3** Gate simultaneous record+stream on a second lease being
  available before any peer connection is created; blocked actions explain
  the budget reason; starting a stream never degrades an in-progress
  recording or export.
- [x] **T4.4** Missing `RTCPeerConnection` (or other required probe) hides the
  publish feature behind a reduced-tier explanation — shell stays alive.

## T5 — Program-feed tap (R4)

- [x] **T5.1** `src/engine/publish-frame-tap.ts` (worker): clone the
  compositor's program `VideoFrame`, write to a `MediaStreamTrackGenerator`
  writer; latest-frame-wins with at most one frame in flight; dropped clones
  closed and counted.
- [x] **T5.2** Close-exactly-once across write/drop/stop/error paths,
  including pending clones at stop — Phase 27 discipline.
- [x] **T5.3** Worker-side generator + transferable track as the primary mode;
  main-thread generator fed by one-in-flight transferred `VideoFrame`s as the
  probed fallback. SAB playback clock untouched in both.
- [x] **T5.4** Audio: master-bus tap via `MediaStreamAudioDestinationNode` on
  the existing `AudioContext` so the stream matches the program monitor
  (post-gain/pan/fades).
- [x] **T5.5** Protocol messages in `src/protocol.ts`: `publish-tap-start` /
  `publish-tap-stop` commands; `publish-tap-track` / `publish-tap-frame` /
  `publish-tap-stats` state messages, structured-clone/transfer safe.

## T6 — UI: publish panel (R6)

- [x] **T6.1** `src/ui/PublishPanel.tsx`: endpoint-type presets (Twitch WHIP,
  Cloudflare-class CDN, self-hosted MediaMTX, custom URL) pre-filling the
  design-table guidance; URL + bearer-token fields; explicit go-live action.
- [x] **T6.2** RTMP honesty copy: YouTube/Douyin/Bilibili need a user-supplied
  WHIP→RTMP gateway; link `docs/LIVE-STREAMING.md` and the MediaMTX docs;
  state that LocalCut never operates relay infrastructure.
- [x] **T6.3** Live state display: connection phase, achieved vs target
  bitrate, reconnect attempt counter; failure reasons use the T1.3 mapping,
  not raw exceptions.
- [x] **T6.4** UI-standards + accessibility pass: keyboard reachable, ARIA
  live region for state transitions, contrast per steering; no media objects
  or WebGPU handles in `src/ui/`; `onCleanup` for the stats subscription.

## T7 — Settings persistence + secret handling (R7)

- [x] **T7.1** `PUBLISH_SETTINGS_STORE` in `src/engine/persistence.ts`:
  app-scoped, outside `ProjectDoc` — no project schema bump.
- [x] **T7.2** Token is session-only by default; "remember token on this
  device" opt-in with plain unencrypted-storage copy.
- [x] **T7.3** Test proving Phase 23 bundle serialization and `ProjectDoc`
  autosave structurally exclude publish settings and tokens.

## T8 — Diagnostics (R5)

- [x] **T8.1** Publish findings (`publish.rtc`, `publish.track-transfer`,
  `publish.generateKeyFrame`, …) in the Phase 25/26 diagnostics snapshot via
  the existing `finding()` pattern.
- [x] **T8.2** Lifecycle events, HTTP statuses (token redacted), retry
  attempts, and tap drop counters recorded so a failed session is explainable
  after the fact.

## T9 — Unit tests (R8)

- [x] **T9.1** `whip-client.test.ts`: mocked `fetch` — POST/201/Location
  resolution (relative + absolute), bearer header on POST/PATCH/DELETE, Link
  ice-server parsing incl. TURN credentials, error mapping incl. `400` →
  rejected-offer, keepalive DELETE.
- [x] **T9.2** `whip-reconnect.test.ts`: fake timers — grace period,
  PATCH-unsupported → re-POST fallback, full 2/4/8/16 s ladder, max-attempts
  terminal `failed`, user stop during `reconnecting` still DELETEs.
- [x] **T9.3** `encoder-budget.test.ts`: acquire/release, exhaustion blocks
  before connection creation, double-release guard, record+stream gating.
- [x] **T9.4** `publish-frame-tap.test.ts`: mocked generator writer —
  latest-frame-wins, drop counting, close-exactly-once across stop/error.
- [x] **T9.5** Protocol type guards for the new commands/messages; all tests
  Node-environment, co-located, no media fixtures; test count grows.

## T10 — CI integration: MediaMTX + Playwright (R8)

- [x] **T10.1** Add `@playwright/test` (devDependency, npm only) and a single
  publish-flow spec; everything else stays in Vitest.
- [x] **T10.2** New CI job (separate from build/test) running a
  `bluenviron/mediamtx` container; Chromium publishes a synthetic program
  feed to `http://localhost:8889/<path>/whip`.
- [x] **T10.3** Assert ingest via the MediaMTX API: session present and
  `bytesReceived` increasing.
- [x] **T10.4** Assert teardown: user stop issues `DELETE` and the MediaMTX
  session disappears.
- [x] **T10.5** Assert reconnect: restart the container mid-stream; client
  walks `reconnecting` → `live` with a fresh session per the documented
  policy.

## T11 — Docs + verification (R8)

- [x] **T11.1** `docs/LIVE-STREAMING.md`: per-endpoint setup, WHIP→RTMP
  gateway requirement for RTMP-only platforms with a MediaMTX config example,
  reconnect policy, record+stream budget rules; link from
  `docs/USER-GUIDE.md`.
- [ ] **T11.2** Manual smoke: publish to local MediaMTX and watch via its
  WebRTC reader page; verify record+stream gating on a software-encode-only
  profile; verify the reduced-tier explanation with WebRTC unavailable.
- [x] **T11.3** `npm run build` and `npm test` green; test count grows.
