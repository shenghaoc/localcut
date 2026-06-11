## 2024-05-20 - Timeline Playhead Memoization Bottleneck
**Learning:** In SolidJS, a `createMemo` tracking the timeline playhead (`boundedCurrentTime()`) to build an array of snap targets forces an O(N) recalculation of all clips/markers on every animation frame during playback, even when no user interaction (dragging/trimming) is occurring.
**Action:** Extract continuously updating values (like the playhead time) from static array computations. Pass the continuous value directly down as a non-tracked prop to interactive components (`TimelineClip`) and incorporate it only at the point of action (e.g., in `resolveSnap` during pointer events) to avoid continuous background re-allocation.

## 2024-06-09 - CSS Layout Thrashing on Scrubhead
**Learning:** Animating a DOM element's position using the CSS `left` property inline (e.g. `style={{ left: \`\${time}px\` }}`) during high-frequency events like a 60fps playback loop forces main-thread layout recalculations (reflows) on every frame. This thrashes performance.
**Action:** Use hardware-accelerated CSS `transform: translateX(...)` instead. The browser can offload this to the compositor thread (GPU), bypassing the layout phase entirely for much smoother animation.

## 2024-08-20 - CSS Layout Thrashing on Audio Meters
**Learning:** Animating a DOM element's `height` property inline (e.g. `style={{ height: \`${percent}%\` }}`) during high-frequency events like a 60fps audio meter reader forces main-thread layout recalculations (reflows) on every frame. This thrashes performance.
**Action:** Use hardware-accelerated CSS `transform: scaleY(...)` combined with `transform-origin: bottom` and `height: 100%` on the base class. The browser can offload this to the compositor thread (GPU), bypassing the layout phase entirely.
