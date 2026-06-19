# Beat detection

LocalCut can analyse any imported audio source to detect its tempo and beat positions, then snap edits or auto-cut clips to those beats. The analysis runs entirely on your device in the pipeline worker — no audio is uploaded, and no server is involved.

## How to use it

1. Import an audio source (MP3, AAC, WAV, etc.) into the Media Bin.
2. Open the **Beat Detection** panel below the Media Bin.
3. Click **Analyse** next to the audio source. A progress bar shows the analysis status. Click **Cancel** to abort.
4. Once complete, the detected tempo (BPM) and beat count are displayed.
5. Click **On** to enable the beat grid display on the timeline ruler. Beat ticks appear in purple; the first beat of each bar is taller.

## Beat grid controls

- **Offset nudge** (–500 ms to +500 ms): shifts all displayed beat times forward or backward in time. Use this to align the beat grid with the actual musical beats if the detected grid is slightly off.
- **Snap to beats**: enable **Snap**, then toggle the **Beat** button in the top chrome or timeline toolbar to include beat positions in the snap target set. When enabled, dragging clip edges or the playhead snaps to the nearest beat.
- **Auto-cut**: select one or more clips on the timeline, then click **Split** or **Align** in the Beat Detection panel:
  - **Split mode**: splits each selected clip at every beat time that falls inside its span. Segments shorter than 0.2 seconds are skipped to avoid creating uneditable slivers.
  - **Align mode**: moves each selected clip's start to the nearest beat time. Selected clips are sorted chronologically before alignment so overlap-skip decisions are deterministic. Locked tracks are skipped with a diagnostics finding, and linked audio and video clips move together.

## Where the cache lives

- Results are cached per source fingerprint in OPFS. Re-importing the same audio file in the same browser profile does not re-run the analysis.
- Beat-grid settings (which sources are enabled and the global offset) ride in the project autosave/restore.
- When you export a project bundle, the OPFS beat cache is embedded under `cache/beats/`; importing the bundle on another machine restores the cache so analysis does not re-run.

## Technical notes

- Tempo detection range: **60–200 BPM**.
- Algorithm: STFT spectral flux → onset peak picking → autocorrelation tempo over the onset envelope → phase-aligned beat lattice. Pure scalar; the FFT hot path is hand-written WASM with a transparent JS fallback. Results are bit-exact for a given code path.
- Beat times are derived from the analysis and are **not** stored as editable markers. They do not appear in the export markers range selector.
- Silent or near-silent audio is detected before grid generation and produces an empty beat list rather than a spurious dense grid.
