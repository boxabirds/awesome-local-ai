// e2e helpers for board tests
import { Page } from '@playwright/test'
import type { Camera, Point } from '../../../src/client/canvas/camera'

// ── camera helpers ───────────────────────────────────────────────────────────

export async function getCamera(page: Page): Promise<Camera> {
  const raw = await page.getAttribute('[data-testid="world-layer"]', 'data-camera')
  if (!raw) throw new Error('world-layer data-camera not found')
  const [x, y, zoom] = raw.split(',').map(Number)
  return { x, y, zoom }
}

export async function setCamera(page: Page, cam: Camera): Promise<void> {
  await page.evaluate((c: Camera) => {
    const hook = (window as unknown as Record<string, { setCamera(c: Camera): void }>)
      .__vidi6
    if (!hook) throw new Error('Test hook __vidi6 not available')
    hook.setCamera(c)
  }, cam)
  // Wait a tick for React to process the update
  await page.waitForTimeout(50)
}

// ── screen/world transform helpers (match camera.ts) ────────────────────────

export function screenToWorld(cam: Camera, p: Point): Point {
  return {
    x: p.x / cam.zoom + cam.x,
    y: p.y / cam.zoom + cam.y,
  }
}

export function worldToScreen(cam: Camera, p: Point): Point {
  return {
    x: (p.x - cam.x) * cam.zoom,
    y: (p.y - cam.y) * cam.zoom,
  }
}

// ── origin marker ───────────────────────────────────────────────────────────

/** Returns the centre of the origin crosshair in viewport coordinates. */
export async function getOriginCenter(page: Page): Promise<Point> {
  const box = await page.locator('[data-testid="origin-marker"]').boundingBox()
  if (!box) throw new Error('origin-marker not visible')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Returns the centre of the nth grid-dot landmark (world k*GRID_SPACING, 0). */
export async function getDotCenter(page: Page, k: number): Promise<Point> {
  const box = await page.locator(`[data-testid="grid-dot-${k}"]`).boundingBox()
  if (!box) throw new Error(`grid-dot-${k} not visible`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

// ── mouse drag ──────────────────────────────────────────────────────────────

/**
 * Drags from (fromX, fromY) to (toX, toY) in viewport coordinates.
 * `steps` controls how many intermediate pointermove events are fired.
 */
export async function mouseDrag(
  page: Page,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  steps = 10,
): Promise<void> {
  await page.mouse.move(fromX, fromY)
  await page.mouse.down()
  await page.mouse.move(toX, toY, { steps })
  await page.mouse.up()
  // Allow React to flush the batched camera updates before the caller
  // reads element positions or computes the new camera state.
  await page.waitForTimeout(50)
}

/**
 * Ctrl+wheel (pinch zoom equivalent) at a specific screen point.
 *
 * Playwright's `mouse.wheel(deltaX, deltaY)` does not carry modifier-key
 * state, so we dispatch a synthetic WheelEvent with `ctrlKey: true` via
 * `page.evaluate`.  This exercises the same event-listener path as a real
 * trackpad pinch gesture.
 */
export async function ctrlWheelAt(
  page: Page,
  x: number,
  y: number,
  deltaY: number,
): Promise<void> {
  await page.evaluate(
    ({ x, y, deltaY }) => {
      const vp = document.querySelector('[data-testid="viewport"]') as HTMLElement
      if (!vp) return
      const e = new WheelEvent('wheel', {
        deltaX: 0,
        deltaY,
        ctrlKey: true,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      })
      vp.dispatchEvent(e)
    },
    { x, y, deltaY },
  )
  await page.waitForTimeout(50)
}

/**
 * Plain wheel (no modifier) at a specific screen point.
 * Uses page.mouse.wheel(deltaX, deltaY) — two number arguments.
 */
export async function plainWheelAt(
  page: Page,
  x: number,
  y: number,
  deltaX = 0,
  deltaY = 0,
): Promise<void> {
  await page.mouse.move(x, y)
  await page.mouse.wheel(deltaX, deltaY)
  await page.waitForTimeout(50)
}

// ── viewport visualViewport helper ──────────────────────────────────────────

export async function getVisualViewportScale(page: Page): Promise<number> {
  return page.evaluate(() => window.visualViewport?.scale ?? 1)
}