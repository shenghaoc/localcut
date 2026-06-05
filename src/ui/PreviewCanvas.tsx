import { onMount } from 'solid-js';

interface PreviewCanvasProps {
  onOffscreenReady: (canvas: OffscreenCanvas) => void;
}

export function PreviewCanvas(props: PreviewCanvasProps) {
  let canvasEl: HTMLCanvasElement | undefined;

  onMount(() => {
    if (!canvasEl) return;
    const offscreen = canvasEl.transferControlToOffscreen();
    props.onOffscreenReady(offscreen);
  });

  return (
    <canvas
      ref={canvasEl}
      class="preview-canvas"
      width={1280}
      height={720}
      aria-label="Video preview"
    />
  );
}
