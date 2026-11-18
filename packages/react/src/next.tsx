'use client';

import React, { useEffect, useState } from 'react';
import { ZoetropeOptions, EngineTelemetry } from '@zoetropejs/core';
import { useZoetrope } from './use-zoetrope.js';
import { ZoetropeCanvas } from './zoetrope-canvas.js';

export interface NextZoetropePlayerProps extends Omit<React.CanvasHTMLAttributes<HTMLCanvasElement>, 'onError'> {
  options: Omit<ZoetropeOptions, 'canvas'>;
  fallback?: React.ReactNode;
  onTelemetry?: (telemetry: EngineTelemetry) => void;
  onReady?: () => void;
  onError?: (err: Error) => void;
}

/**
 * SSR-safe, client-only Next.js wrapper for Zoetrope.
 * Guarantees zero SSR execution, prevents hydration mismatches, and mounts safely on client.
 */
export const NextZoetropePlayer: React.FC<NextZoetropePlayerProps> = ({
  options,
  fallback = null,
  onTelemetry,
  onReady,
  onError,
  style,
  className,
  ...props
}) => {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (!hasMounted) {
    return <>{fallback}</>;
  }

  return (
    <ClientPlayerInternal
      options={options}
      onTelemetry={onTelemetry}
      onReady={onReady}
      onError={onError}
      style={style}
      className={className}
      {...props}
    />
  );
};

const ClientPlayerInternal: React.FC<NextZoetropePlayerProps> = ({
  options,
  onTelemetry,
  onReady,
  onError,
  style,
  className,
  ...props
}) => {
  const { canvasRef, isReady, error, telemetry } = useZoetrope(options);

  useEffect(() => {
    if (isReady && onReady) onReady();
  }, [isReady, onReady]);

  useEffect(() => {
    if (error && onError) onError(error);
  }, [error, onError]);

  useEffect(() => {
    if (telemetry && onTelemetry) onTelemetry(telemetry);
  }, [telemetry, onTelemetry]);

  return (
    <ZoetropeCanvas
      canvasRef={canvasRef}
      className={className}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        ...style,
      }}
      {...props}
    />
  );
};
