/**
 * Story 2 · board.model — Yjs document schema and every board mutation
 * (design "Board document model").
 *
 * Stubbed in task 1: the module is written test-first, so this file only
 * declares the contract and throws until task 2 implements it. Kept
 * framework-free so the story-4 Durable Object can import it for validation.
 */
import * as Y from 'yjs';
import type { StickyColor } from './config';

export const LOCAL_ORIGIN: unique symbol = Symbol('local');

export interface StickySnapshot {
  id: string;
  type: 'sticky';
  x: number;
  y: number;
  color: StickyColor;
  text: string;
  z: number;
  createdAt: number;
}

export function initDoc(_doc: Y.Doc): void {
  throw new Error('not implemented');
}

export function createSticky(
  _doc: Y.Doc,
  _at: { x: number; y: number },
  _color?: StickyColor,
): string {
  throw new Error('not implemented');
}

export function moveObject(_doc: Y.Doc, _id: string, _x: number, _y: number): boolean {
  throw new Error('not implemented');
}

export function bringToFront(_doc: Y.Doc, _id: string): boolean {
  throw new Error('not implemented');
}

export function setStickyColor(
  _doc: Y.Doc,
  _id: string,
  _color: string,
): boolean {
  throw new Error('not implemented');
}

export function deleteObject(_doc: Y.Doc, _id: string): boolean {
  throw new Error('not implemented');
}

export function getStickyText(_doc: Y.Doc, _id: string): Y.Text | undefined {
  throw new Error('not implemented');
}

export function snapshot(_doc: Y.Doc): readonly StickySnapshot[] {
  throw new Error('not implemented');
}