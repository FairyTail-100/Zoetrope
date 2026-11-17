'use client';

import React, { useState } from 'react';
import { NextZoetropePlayer } from '@zoetrope/react';
import type { EngineTelemetry } from '@zoetrope/core';

export default function Page() {
  const [telemetry, setTelemetry] = useState<EngineTelemetry | null>(null);

  return (
    <main style={{ height: '300vh', position: 'relative' }}>
      <div
        style={{
          position: 'sticky',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <NextZoetropePlayer
          options={{
            manifest: '/assets/showcase/manifest.json',
            playback: {
              mode: 'scroll',
              container: typeof window !== 'undefined' ? window : undefined,
            },
            renderer: {
              fit: 'cover',
            },
          }}
          fallback={<div style={{ color: '#888' }}>Loading...</div>}
          onTelemetry={(t) => setTelemetry(t)}
          style={{ width: '100%', height: '100%' }}
        />

        {telemetry && (
          <div
            style={{
              position: 'absolute',
              top: 20,
              left: 20,
              padding: '10px 16px',
              background: 'rgba(0,0,0,0.8)',
              borderRadius: 6,
              fontFamily: 'monospace',
              fontSize: 12,
              color: '#66fcf1',
              pointerEvents: 'none',
            }}
          >
            <div>Frame: {telemetry.currentFrame} / {telemetry.totalFrames}</div>
            <div>FPS: {telemetry.fps} | Hit Rate: {telemetry.cacheHitRate}%</div>
          </div>
        )}
      </div>
    </main>
  );
}
