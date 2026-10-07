import { Point } from '@/client/objects/registry';

/** Generate a handwritten-loop-like path with jitter (~400 points). */
export function generateHandwrittenLoop(): Point[] {
  const points: Point[] = [];
  const numPoints = 400;
  const radius = 80;

  for (let i = 0; i < numPoints; i++) {
    const t = (i / numPoints) * Math.PI * 2;
    // Add realistic jitter
    const jitterX = (Math.sin(t * 7) * 3 + Math.cos(t * 11) * 2);
    const jitterY = (Math.cos(t * 5) * 3 + Math.sin(t * 9) * 2);
    points.push({
      x: 200 + Math.cos(t) * radius + jitterX,
      y: 200 + Math.sin(t) * radius + jitterY,
    });
  }

  return points;
}

/** Generate an underline-like path (~120 points). */
export function generateUnderline(): Point[] {
  const points: Point[] = [];
  const numPoints = 120;

  for (let i = 0; i < numPoints; i++) {
    const t = i / (numPoints - 1);
    const jitterY = Math.sin(i * 0.5) * 1.5 + (Math.random() - 0.5);
    points.push({
      x: 100 + t * 300,
      y: 200 + jitterY,
    });
  }

  return points;
}

/** Generate a synthetic spiral of exactly `n` points. */
export function generateSpiral(n: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < n; i++) {
    const angle = i * 0.1;
    const r = 5 + i * 0.3;
    points.push({
      x: 500 + Math.cos(angle) * r,
      y: 500 + Math.sin(angle) * r,
    });
  }
  return points;
}
