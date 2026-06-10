# Interchange Verification Checklist (Phase 48)

Manual verification that exported `.otio` and `.edl` files open correctly in
external applications. Automated coverage (Vitest golden fixtures, the
structural OTIO validator, the CMX3600 grammar validator, and the reference
Python `opentimelineio` parse in CI) verifies the files are well-formed; this
checklist verifies real applications interpret them correctly.

Run before a release that touched `src/engine/interchange/` or the bundle
writer, on the most recent Kdenlive (25.04+) and DaVinci Resolve.

## 1. Build the fixture project

In LocalCut, build a project matching `buildMultiTrackFixtureDoc()`
(`src/engine/interchange/fixture-docs.ts`):

1. Import two short video clips (call them A and B).
2. **V1**: clip A at `0s` for `4s` (source in-point `1s`), clip B at `4s` for
   `3s` (in-point `0.5s`) — adjacent cut at `4s`.
3. **V2**: a title clip "Opening" from `2s` to `5s` (gap before it).
4. **A1**: audio from clip A at `0.5s` for `6s`.
5. A 1-second cross-dissolve on the V1 cut at `4s`.
6. Markers at `0s` ("Start"), `3.5s` ("Scene 2"), `7s` ("End").

## 2. Bundle export

- [ ] Export a project bundle with **embed media**.
- [ ] `project.otio` exists at the bundle root next to `project.json` and
      `manifest.json`.
- [ ] Every `target_url` in `project.otio` points at an existing
      `media/<digest-prefix>_<name>` file in the bundle.

## 3. Kdenlive (25.04+)

Open the bundle's `project.otio` (Project → Open, or via OTIO import).

- [ ] Two video tracks and one audio track appear.
- [ ] Clip count per track matches (2 / 1 / 1); the title appears as a
      placeholder clip of the correct duration.
- [ ] Every cut is frame-exact at the sequence rate: V1 cut at `4s`
      (frame 120 at 30 fps), title from frame 60 to 150, audio from frame 15.
- [ ] The three markers/guides sit at frames 0, 105, and 210 with their labels.
- [ ] The dissolve is centred on the V1 cut with a total of 30 frames.
- [ ] Media resolves from the bundle's `media/` folder without relink prompts.

## 4. DaVinci Resolve

File → Import → Timeline → the bundle's `project.otio`.

- [ ] Same track/clip/marker/dissolve checks as Kdenlive.
- [ ] If media is not auto-found, the relink dialog shows the **original file
      names** (from the OTIO reference names), not opaque IDs.

## 5. otioconvert path (AAF / FCPXML)

- [ ] `pip install opentimelineio` then
      `otioconvert -i project.otio -o project.xml` completes without errors
      (FCPXML; AAF needs `otio-aaf-adapter`).

## 6. EDL

Export the `.edl` for V1 from the Interchange menu.

- [ ] `npm test` passes (includes the CMX3600 grammar check on goldens).
- [ ] Import the EDL into Resolve (File → Import → Timeline → EDL) at the
      project rate: two events, record TC starting `01:00:00:00`, cut at
      `01:00:04:00`, source TCs honouring the in-points (`00:00:01:00`,
      `00:00:00:15`).
- [ ] The Interchange menu listed the expected warnings (other tracks
      omitted, dissolve flattened to a cut).

## 7. Determinism

- [ ] Export the unchanged project twice; the two `.otio` files are
      byte-identical (`cmp` or `diff`).
