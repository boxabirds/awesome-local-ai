import type { Point } from '../../src/client/canvas/camera';

/**
 * Handwritten loop fixture (~400 points with jitter).
 * Generates a realistic looping path for testing smoothing and rendering.
 */
export function generateLoopPath(count: number = 400): Point[] {
  const pts: Point[] = [];
  // Generate points along a slightly irregular ellipse
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    // Add jitter to simulate real handwriting
    const jitter = () => (Math.random() - 0.5) * 3;
    pts.push({
      x: 100 + 60 * Math.cos(t) + jitter(),
      y: 80 + 40 * Math.sin(t) + jitter(),
    });
  }
  return pts;
}

/**
 * Underline fixture (~120 points).
 * A mostly horizontal line with slight waviness.
 */
export function generateUnderlinePath(count: number = 120): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const jitter = () => (Math.random() - 0.5) * 2;
    pts.push({
      x: 20 + t * 200 + jitter(),
      y: 100 + 5 * Math.sin(t * Math.PI * 3) + jitter(),
    });
  }
  return pts;
}

/**
 * Synthetic spiral that exceeds STROKE_MAX_POINTS.
 * Useful for testing splitPoints.
 */
export function generateSpiralPoint(count: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 20;
    const radius = 1 + i * 0.1;
    pts.push({
      x: 100 + radius * Math.cos(angle),
      y: 100 + radius * Math.sin(angle),
    });
  }
  return pts;
}

// Pre-generate commonly used paths for deterministic tests
export const LOOP_PATH = generateLoopPath(400);
export const UNDERLINE_PATH = generateUnderlinePath(120);
export const SPIRAL_PATH_5010 = generateSpiralPoint(5010);
