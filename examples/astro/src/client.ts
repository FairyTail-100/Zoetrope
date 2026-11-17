import { Zoetrope } from '@zoetrope/core';

export function mountZoetropeIsland(canvasId: string, manifestUrl: string) {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
  if (!canvas) return;

  const engine = new Zoetrope({
    canvas,
    manifest: manifestUrl,
    playback: {
      mode: 'scroll',
      container: window,
    },
    renderer: {
      fit: 'cover',
    },
  });

  engine.init().catch(console.error);
  return engine;
}
