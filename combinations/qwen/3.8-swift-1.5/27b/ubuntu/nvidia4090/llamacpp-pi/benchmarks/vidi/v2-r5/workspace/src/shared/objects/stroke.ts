// src/shared/objects/stroke.ts
// Stroke object schema: createStroke, scaledPoints, StrokeSnap.

import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../board-model';
import type { ObjectSnapshot } from '../board-model';
import type { Point } from '../geometry';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../config';

export type { PenColor, PenThickness };

export interface StrokeSnap extends ObjectSnapshot {
  type: 'stroke';
  points: readonly number[];
  baseWidth: number;
  baseHeight: number;
  color: PenColor;
  thickness: PenThickness;
  width: number;
  height: number;
}

function getObjects(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects');
}

function getMaxZ(doc: Y.Doc): number {
  const objects = getObjects(doc);
  let maxZ = 0;
  objects.forEach((obj) => {
    const z = (obj.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });
  return maxZ;
}

function isValidPenColor(color: string): color is PenColor {
  return color in PEN_COLORS;
}

function isValidPenThickness(thickness: string): thickness is PenThickness {
  return thickness in PEN_THICKNESS_WORLD;
}

function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/**
 * Creates a stroke object on the board.
 * - Validates points (non-empty, all finite), colour and thickness names.
 * - Computes bbox padded by thickness/2.
 * - For a single point (dot): bbox = thickness square centred on the point.
 * - Stores flattened points relative to bbox origin plus baseWidth/baseHeight.
 * - One LOCAL_ORIGIN transaction.
 *
 * Returns the new id, or null for invalid input.
 */
export function createStroke(
  doc: Y.Doc,
  a: { points: readonly Point[]; color: PenColor; thickness: PenThickness },
  by: string,
): string | null {
  // Validate
  if (a.points.length === 0) return null;
  for (const p of a.points) {
    if (!isFinitePoint(p)) return null;
  }
  if (!isValidPenColor(a.color)) return null;
  if (!isValidPenThickness(a.thickness)) return null;

  const thickness = PEN_THICKNESS_WORLD[a.thickness];
  const pad = thickness / 2;

  // Compute bbox of points
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of a.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  // Pad by thickness/2
  const x = minX - pad;
  const y = minY - pad;
  let width = maxX - minX + thickness;
  let height = maxY - minY + thickness;

  // For a single point (dot): bbox = thickness square
  if (a.points.length === 1) {
    width = thickness;
    height = thickness;
    // Re-center: the point should be at the centre of the square
    // x = point.x - thickness/2, y = point.y - thickness/2
    // Which is the same as minX - pad since minX = maxX = point.x
    // So x = point.x - pad = point.x - thickness/2 ✓
  }

  // Store points relative to bbox origin
  const relPoints: number[] = [];
  for (const p of a.points) {
    relPoints.push(p.x - x, p.y - y);
  }

  const id = crypto.randomUUID();
  const z = getMaxZ(doc) + 1;

  doc.transact(() => {
    const objects = getObjects(doc);
    const obj = new Y.Map<unknown>();
    obj.set('type', 'stroke');
    obj.set('x', x);
    obj.set('y', y);
    obj.set('width', width);
    obj.set('height', height);
    obj.set('points', relPoints);
    obj.set('baseWidth', width);
    obj.set('baseHeight', height);
    obj.set('color', a.color);
    obj.set('thickness', a.thickness);
    obj.set('z', z);
    obj.set('createdAt', Date.now());
    obj.set('createdBy', by);
    objects.set(id, obj);
  }, LOCAL_ORIGIN);

  return id;
}

/**
 * Returns the world-space points of a stroke, scaled to its current width/height.
 * Points are stored relative to the bbox origin at baseWidth/baseHeight size.
 * The scale factor is width/baseWidth, height/baseHeight.
 * Thickness is NOT scaled.
 */
export function scaledPoints(s: StrokeSnap): Point[] {
  const { points, baseWidth, baseHeight, width, height, x, y } = s;
  const sx = baseWidth > 0 ? width / baseWidth : 1;
  const sy = baseHeight > 0 ? height / baseHeight : 1;

  const result: Point[] = [];
  for (let i = 0; i < points.length; i += 2) {
    result.push({
      x: x + points[i] * sx,
      y: y + points[i + 1] * sy,
    });
  }
  return result;
}
