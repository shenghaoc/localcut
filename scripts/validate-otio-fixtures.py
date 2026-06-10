#!/usr/bin/env python3
"""Validate the golden .otio fixtures with the reference OpenTimelineIO
implementation (Phase 48, R11.5).

CI-only: the app never ships or requires Python. The Vitest golden tests
assert the TypeScript serialiser produces these exact bytes, so parsing the
goldens here transitively validates serialiser output against the real
library.
"""

import sys
from pathlib import Path

import opentimelineio as otio

FIXTURE_DIR = Path(__file__).resolve().parent.parent / "test-fixtures" / "interchange"

# Sanity expectations per fixture: (video tracks, audio tracks, markers).
EXPECTED = {
    "multi-track.otio": (2, 1, 3),
    "multi-track-bundle.otio": (2, 1, 3),
    "missing-source.otio": (1, 0, 0),
}


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    fixtures = sorted(FIXTURE_DIR.glob("*.otio"))
    if not fixtures:
        fail(f"no .otio fixtures found in {FIXTURE_DIR}")
    for path in fixtures:
        timeline = otio.adapters.read_from_file(str(path))
        if not isinstance(timeline, otio.schema.Timeline):
            fail(f"{path.name}: root is not a Timeline")
        video = len(list(timeline.video_tracks()))
        audio = len(list(timeline.audio_tracks()))
        markers = len(timeline.tracks.markers)
        expected = EXPECTED.get(path.name)
        if expected is not None and (video, audio, markers) != expected:
            fail(
                f"{path.name}: expected (video, audio, markers) == {expected}, "
                f"got {(video, audio, markers)}"
            )
        # Every item must survive a range computation — this exercises the
        # rational-time maths on real library types.
        for track in timeline.tracks:
            for child in track:
                if isinstance(child, otio.core.Item):
                    track.range_of_child(child)
        print(f"OK: {path.name} ({video}V/{audio}A, {markers} markers)")


if __name__ == "__main__":
    main()
