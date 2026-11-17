import { ZoetropeComposition, CompositionLayerConfig, Cue } from '@zoetrope/core';

async function init() {
  const canvas = document.querySelector<HTMLCanvasElement>('#composition-canvas')!;
  const hudProgress = document.querySelector('#hud-progress')!;
  const hudL1 = document.querySelector('#hud-l1')!;
  const hudL2 = document.querySelector('#hud-l2')!;
  const hudCue = document.querySelector('#hud-cue')!;

  const cue1 = document.querySelector('#cue-1')!;
  const cue1Fill = document.querySelector<HTMLElement>('#cue-1-fill')!;
  const cue2 = document.querySelector('#cue-2')!;
  const cue2Fill = document.querySelector<HTMLElement>('#cue-2-fill')!;
  const cue3 = document.querySelector('#cue-3')!;
  const cue3Fill = document.querySelector<HTMLElement>('#cue-3-fill')!;

  // Configure layers with shared memory budget and timeline ranges
  const layers: CompositionLayerConfig[] = [
    {
      id: 'background-hero',
      manifest: '/assets/showcase/manifest.json',
      scrollRange: [0.0, 0.75],
      zIndex: 1,
      priority: 2, // 2x budget share
      opacity: [
        { progress: 0.0, value: 1.0 },
        { progress: 0.6, value: 1.0 },
        { progress: 0.75, value: 0.0, easing: 'easeOut' },
      ],
      transform: {
        scale: [
          { progress: 0.0, value: 1.0 },
          { progress: 0.75, value: 1.15, easing: 'easeInOut' },
        ],
      },
    },
    {
      id: 'iris-pip',
      manifest: '/assets/showcase/manifest.json',
      scrollRange: [0.25, 1.0],
      zIndex: 2,
      priority: 1,
      opacity: [
        { progress: 0.25, value: 0.0 },
        { progress: 0.35, value: 1.0, easing: 'easeIn' },
        { progress: 1.0, value: 1.0 },
      ],
      mask: {
        type: 'circle',
        x: 0.5,
        y: 0.5,
        radius: [
          { progress: 0.25, value: 0.05 },
          { progress: 0.55, value: 0.35, easing: 'easeInOut' },
          { progress: 0.85, value: 0.85, easing: 'easeOut' },
        ],
      },
      transform: {
        rotate: [
          { progress: 0.25, value: -0.1 },
          { progress: 0.65, value: 0.0, easing: 'easeOut' },
        ],
      },
    },
  ];

  // Configure synchronized DOM timeline cues
  const cues: Cue[] = [
    {
      id: 'act-1',
      start: 0.05,
      end: 0.3,
      onEnter: () => {
        cue1.classList.add('active');
        hudCue.textContent = 'Act I: Monolith';
      },
      onLeave: () => {
        cue1.classList.remove('active');
        if (hudCue.textContent === 'Act I: Monolith') hudCue.textContent = 'None';
      },
      onProgress: (p) => {
        cue1Fill.style.width = `${(p * 100).toFixed(1)}%`;
      },
    },
    {
      id: 'act-2',
      start: 0.35,
      end: 0.65,
      onEnter: () => {
        cue2.classList.add('active');
        hudCue.textContent = 'Act II: Iris Transition';
      },
      onLeave: () => {
        cue2.classList.remove('active');
        if (hudCue.textContent === 'Act II: Iris Transition') hudCue.textContent = 'None';
      },
      onProgress: (p) => {
        cue2Fill.style.width = `${(p * 100).toFixed(1)}%`;
      },
    },
    {
      id: 'act-3',
      start: 0.7,
      end: 0.95,
      onEnter: () => {
        cue3.classList.add('active');
        hudCue.textContent = 'Act III: Full Convergence';
      },
      onLeave: () => {
        cue3.classList.remove('active');
        if (hudCue.textContent === 'Act III: Full Convergence') hudCue.textContent = 'None';
      },
      onProgress: (p) => {
        cue3Fill.style.width = `${(p * 100).toFixed(1)}%`;
      },
    },
  ];

  const comp = new ZoetropeComposition({
    canvas,
    totalMemoryMb: 384,
    layers,
    cues,
  });

  await comp.init();

  // Connect scroll driver
  const onScroll = () => {
    const scrollMax = document.documentElement.scrollHeight - window.innerHeight;
    const progress = scrollMax > 0 ? window.scrollY / scrollMax : 0;
    comp.setProgress(progress);

    hudProgress.textContent = `${(progress * 100).toFixed(1)}%`;
    hudL1.textContent = progress <= 0.75 ? 'Visible' : 'Faded Out';
    hudL2.textContent = progress >= 0.25 ? 'Active (Iris Clipped)' : 'Hidden';
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  (window as any).__composition = comp;
  console.log('Layered Composition initialized successfully!');
}

init().catch(console.error);
