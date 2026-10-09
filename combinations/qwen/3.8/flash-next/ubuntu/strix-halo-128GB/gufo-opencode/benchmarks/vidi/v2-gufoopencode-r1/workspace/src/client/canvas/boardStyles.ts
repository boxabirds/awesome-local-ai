import type { CSSProperties } from 'react';
import { GRID_SPACING_WORLD } from '../../shared/config';
import type { Camera } from './camera';

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

export function gridStyle(camera: Camera): CSSProperties {
  const spacingPx = GRID_SPACING_WORLD * camera.zoom;
  return {
    position: 'absolute',
    inset: 0,
    backgroundImage: 'radial-gradient(circle, #c3c9d2 1.5px, transparent 1.5px)',
    backgroundSize: `${spacingPx}px ${spacingPx}px`,
    backgroundPosition: `${positiveModulo(-camera.x * camera.zoom, spacingPx)}px ${positiveModulo(
      -camera.y * camera.zoom,
      spacingPx
    )}px`
  };
}

export function worldLayerStyle(camera: Camera): CSSProperties {
  return {
    position: 'absolute',
    top: 0,
    left: 0,
    transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
    transformOrigin: '0 0'
  };
}
