import { Zoetrope, EngineTelemetry } from '@zoetrope/core';

async function main() {
  const canvas = document.querySelector<HTMLCanvasElement>('#zoetrope-canvas')!;

  // Telemetry DOM elements
  const elFps = document.querySelector('#hud-fps')!;
  const elFrame = document.querySelector('#hud-frame')!;
  const elDirection = document.querySelector('#hud-direction')!;
  const elMemory = document.querySelector('#hud-memory')!;
  const elHitrate = document.querySelector('#hud-hitrate')!;
  const elBlit = document.querySelector('#hud-blit')!;
  const elVariant = document.querySelector('#hud-variant')!;
  const elAvailP95 = document.querySelector('#hud-avail-p95');
  const elDecodeErr = document.querySelector('#hud-decode-err');
  const elRequests = document.querySelector('#hud-requests');
  const elProgressFill = document.querySelector<HTMLElement>('#hud-progress-fill')!;

  // Controls DOM elements
  const sliderTau = document.querySelector<HTMLInputElement>('#tau-slider')!;
  const labelTau = document.querySelector('#tau-val')!;
  const btnSmoothing = document.querySelector<HTMLButtonElement>('#toggle-smoothing')!;
  const btnFit = document.querySelector<HTMLButtonElement>('#toggle-fit')!;
  const btnJump0 = document.querySelector('#btn-jump-0')!;
  const btnJump50 = document.querySelector('#btn-jump-50')!;
  const btnJump100 = document.querySelector('#btn-jump-100')!;
  const btnStress = document.querySelector('#btn-stress-test')!;

  let smoothingEnabled = true;
  let currentFit: 'cover' | 'contain' = 'cover';

  // Read manifest parameter from query string (e.g. ?manifest=%2Fassets%2Fcustom%2Fmanifest.json)
  const urlParams = new URLSearchParams(window.location.search);
  const rawManifest = urlParams.get('manifest');
  const manifestUrl = rawManifest ? decodeURIComponent(rawManifest) : '/assets/showcase/manifest.json';

  const elManifest = document.querySelector<HTMLElement>('#hud-manifest');
  if (elManifest) {
    elManifest.textContent = manifestUrl;
  }

  // Instantiate Zoetrope
  const engine = new Zoetrope({
    canvas,
    manifest: manifestUrl,
    playback: {
      mode: 'scroll',
      container: window,
      smoothing: {
        enabled: true,
        tau: 28,
        epsilon: 0.0001,
      },
    },
    renderer: {
      fit: 'cover',
      maxDpr: 2.0,
      clearOnStall: false,
    },
    cache: {
      directionalPenalty: 2.0,
    },
    streaming: {
      lookahead: 18,
      lookbehind: 6,
      concurrency: 4,
    },
  });

  // Listen to real-time engine telemetry
  engine.on('frame', ({ frameId, progress, telemetry }: { frameId: number; progress: number; telemetry: EngineTelemetry }) => {
    elFps.textContent = `${telemetry.fps} FPS`;
    elFrame.textContent = `${frameId} / ${telemetry.totalFrames}`;

    let dirText = 'IDLE';
    if (telemetry.direction === 1) dirText = 'FORWARD →';
    else if (telemetry.direction === -1) dirText = '← REVERSE';
    elDirection.textContent = dirText;

    elMemory.textContent = `${telemetry.memoryUsageMb} MB / ${telemetry.maxMemoryMb} MB`;
    elHitrate.textContent = `${telemetry.cacheHitRate}%`;
    elBlit.textContent = `${telemetry.renderTimeMs.toFixed(2)} ms`;
    elVariant.textContent = telemetry.variantId.toUpperCase();

    const s = engine.stats();
    if (elAvailP95) {
      elAvailP95.textContent = `${s.availabilityLatencyMs.p95.toFixed(1)} ms`;
    }
    if (elDecodeErr) {
      elDecodeErr.textContent = `${s.decodeTimeMs.p50.toFixed(1)}ms / e=${s.displayedFrameError.mean}`;
    }
    if (elRequests) {
      elRequests.textContent = `${telemetry.requestsTotal} reqs (blob: ${telemetry.blobMemoryMb}MB)`;
    }

    elProgressFill.style.width = `${(progress * 100).toFixed(1)}%`;
  });

  engine.on('error', (err) => {
    console.error('Engine error:', err);
  });

  await engine.init();
  const initialTotalFrames = engine.getManifest().metadata.totalFrames;
  elFrame.textContent = `0 / ${initialTotalFrames}`;
  if (elManifest) {
    elManifest.textContent = `${manifestUrl} (${initialTotalFrames} frames)`;
  }
  (window as unknown as { __engine: Zoetrope }).__engine = engine;
  console.log('Zoetrope initialized successfully!');

  // Controls Event Listeners
  sliderTau.addEventListener('input', () => {
    const val = parseInt(sliderTau.value, 10);
    labelTau.textContent = `${val}ms`;
    engine.getSmoother().setTau(val);
  });

  btnSmoothing.addEventListener('click', () => {
    smoothingEnabled = !smoothingEnabled;
    btnSmoothing.textContent = smoothingEnabled ? 'ENABLED' : 'DISABLED';
    btnSmoothing.classList.toggle('active', smoothingEnabled);
    engine.getSmoother().setEnabled(smoothingEnabled);
  });

  btnFit.addEventListener('click', () => {
    currentFit = currentFit === 'cover' ? 'contain' : 'cover';
    btnFit.textContent = currentFit.toUpperCase();
    engine.getRenderer().setFit(currentFit);
  });

  btnJump0.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  btnJump50.addEventListener('click', () => {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: maxScroll * 0.5, behavior: 'smooth' });
  });

  btnJump100.addEventListener('click', () => {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: maxScroll, behavior: 'smooth' });
  });

  // Stress-test rapid oscillation between 20% and 80% to demonstrate deterministic seek performance
  let stressInterval: number | null = null;
  btnStress.addEventListener('click', () => {
    if (stressInterval !== null) {
      clearInterval(stressInterval);
      stressInterval = null;
      btnStress.textContent = '⚡ OSCILLATE';
      btnStress.classList.remove('active');
      return;
    }

    btnStress.textContent = '⏹ STOP OSCILLATE';
    btnStress.classList.add('active');

    let phase = 0;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;

    stressInterval = window.setInterval(() => {
      phase += 0.15;
      const progress = 0.5 + 0.4 * Math.sin(phase);
      window.scrollTo({ top: maxScroll * progress, behavior: 'auto' });
    }, 30);
  });
}

main().catch(console.error);
