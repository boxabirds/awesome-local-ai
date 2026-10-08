/**
 * Minimal world-space geometry primitives shared by the shape and connector
 * models (story 10). Kept free of any DOM / camera import so the shared layer
 * stays testable in node and reusable by the client and story 11.
 */

export interface Point {
  readonly x: number
  readonly y: number
}

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}