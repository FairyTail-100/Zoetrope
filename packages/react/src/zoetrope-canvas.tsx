import React from 'react';

export interface ZoetropeCanvasProps extends React.CanvasHTMLAttributes<HTMLCanvasElement> {
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
}

export const ZoetropeCanvas: React.FC<ZoetropeCanvasProps> = ({
  canvasRef,
  style,
  ...props
}) => {
  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        ...style,
      }}
      {...props}
    />
  );
};
