# Time Remapping

Speed ramps change how quickly a source clip advances while the timeline keeps playing forward. LocalCut stores the ramp on the clip as output-time keyframes, so preview and export use the same timing map.

## Speed curve

Each speed keyframe has a clip-local time, a speed from 0.25x to 4x, and an easing mode:

- **Linear** changes speed evenly between keyframes.
- **Ease** uses the same Hermite smoothstep easing as transform keyframes.
- **Hold** keeps the previous speed until the next keyframe.

Speeds stay positive, so reverse playback is not supported in this version.

## Duration

Changing speed changes the clip's timeline duration. A 0.5x section takes longer, and a 2x section takes less time. The clip grows or shrinks from its right edge; neighbouring clips are not rippled automatically.

## Audio

When **Pitch Preserve** is on, LocalCut uses WSOLA time-stretching so speech and music keep their natural pitch. When it is off, audio follows the speed change like tape varispeed, so faster playback raises pitch and slower playback lowers it.
