import { useEffect, useRef, useState } from 'react';
import {
  Zoetrope,
  ZoetropeOptions,
  EngineTelemetry,
} from '@zoetropejs/core';

export interface UseZoetropeReturn {
  engine: Zoetrope | null;
  telemetry: EngineTelemetry | null;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  isReady: boolean;
  error: Error | null;
}

export function useZoetrope(
  options: Omit<ZoetropeOptions, 'canvas'>
): UseZoetropeReturn {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [engine, setEngine] = useState<Zoetrope | null>(null);
  const [telemetry, setTelemetry] = useState<EngineTelemetry | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const instance = new Zoetrope({
      ...options,
      canvas,
    });

    instance.on('frame', ({ telemetry }) => {
      setTelemetry(telemetry);
    });

    instance.on('error', (err) => {
      setError(err);
    });

    instance
      .init()
      .then(() => {
        setEngine(instance);
        setIsReady(true);
      })
      .catch((err) => {
        setError(err);
      });

    return () => {
      instance.destroy();
      setEngine(null);
      setIsReady(false);
    };
  }, [options.manifest]);

  return {
    engine,
    telemetry,
    canvasRef,
    isReady,
    error,
  };
}
