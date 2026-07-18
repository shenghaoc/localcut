# Product

## Register

product

## Users

Mid-tier creators — YouTubers, short-documentary makers, corporate training producers — who need cuts, clip reordering, transitions, colour correction, text overlays, multi-track audio mixing, and MP4 export. Their context: a browser tab on a capable desktop machine. They want desktop-editor confidence without installing desktop software.

## Product Purpose

A browser-native non-linear video editor that feels close to a desktop tool. Import, cut, preview, and export all run on the user's CPU/GPU — no server-side media pipeline. Cloudflare hosts the static PWA and COOP/COEP headers; the browser supplies the compute. Success means a creator finishes a project from import to export without hitting a dead end, without noticing the browser, and without wishing they'd opened a desktop editor instead.

## Brand Personality

**Minimal, technical, warm.** The interface is precise like a measurement instrument, stripped of decoration — but never sterile. A warm amber accent (the colour of film stock and light meters) and a dark palette with a subtle warm undertone keep it human. JetBrains Mono for every technical readout; DM Sans for chrome. No gradients, no glass, no social-app energy.

## Anti-references

- **kdenlive** — cluttered default layouts, inconsistent panel styling, the "open-source tool" aesthetic that prioritises feature count over visual coherence.
- **Final Cut Pro** — the magnetic timeline model and consumer-leaning chrome; LocalCut is a traditional track-based NLE, not a trackless media browser.
- **CapCut** — consumer-social aesthetic, template-driven, bright and playful.
- **DaVinci Resolve** — industrial density, overwhelming panel count, colour-page complexity as default posture.

## Design Principles

1. **Performance is the product.** The accelerated path uses WebCodecs, WebGPU, workers, and SharedArrayBuffer wherever they materially improve the editing loop. Every frame of latency is a design failure.

2. **Honest hardware adaptation.** Capability tiers, proxy preview resolution, and throughput probes explain what the user's machine can do instead of freezing or failing silently. Limited modes are visible, labeled, and never deceptive.

3. **Task completion over architectural purity.** If a controlled compatibility path lets more users import, cut, preview, or export, it is allowed when explicit, measured, and clearly labeled.

4. **Desktop-class first.** Optimise for desktop Chromium with a keyboard-driven editing workflow. Mobile and touch are not v1 concerns.

5. **Precision over decoration.** Every pixel serves the edit. Typography is a tool (tabular-nums timecodes, monospace technicals), colour is signal (amber for the scrubhead and primary actions, sage for audio, vermillion for danger), and spacing follows a single disciplined scale.

## Accessibility & Inclusion

- **WCAG 2.2 AA** conformance target.
- ARIA patterns on timeline scrub track (`role="slider"`), preview canvas (`aria-label`), and capability warnings (`role="alert"` when workflow-blocking).
- Keyboard navigation throughout the editing surface, with visible focus indicators.
- `prefers-reduced-motion` respected for all animations and transitions.
- Colour is never the sole signal — status indicators pair colour with icons or text.
