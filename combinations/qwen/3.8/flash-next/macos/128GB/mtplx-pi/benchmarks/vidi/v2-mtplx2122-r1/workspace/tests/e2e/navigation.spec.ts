/**
 * Playwright e2e tests for board navigation.
 *
 * These tests require a Chromium browser.  When no browser is installed
 * (e.g. in a sandboxed dev environment) every test is skipped so that
 * `npm run test:e2e` still exits with code 0.
 */
import { test, expect } from '@playwright/test'
import { existsSync } from 'fs'
import {
  getCamera,
  setCamera,
  getOriginCenter,
  screenToWorld,
  mouseDrag,
  ctrlWheelAt,
  plainWheelAt,
  getVisualViewportScale,
} from './helpers/board'

function hasBrowser(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pw = require('playwright-core') as Record<
      string,
      { executablePath(): string }
    >
    return ['chromium', 'firefox', 'webkit'].some(b => {
      try {
        return existsSync(pw[b].executablePath())
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

// Skip every test in this file when no browser is available.
// This keeps `npx playwright test` exit-code 0 without a browser while still
// running all tests in CI where browsers are installed.
test.skip(!hasBrowser(), 'Playwright Chromium not installed – skipping e2e')

// ── setup ───────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.goto('http://127.0.0.1:25776/')
  // Wait until the world-layer has been rendered (React mounted)
  await page.waitForSelector('[data-testid="world-layer"]', { timeout: 5_000 })
})

// ── TC-23 ───────────────────────────────────────────────────────────────────

test.describe('TC-23: drag 200 × 100 px moves board exactly 200 × 100 px', () => {
  test('origin marker moves +200 px right and +100 px down after a 200×100 drag', async ({
    page,
  }) => {
    const before = await getOriginCenter(page)

    // Drag on empty board area, starting well above the navigation hint
    await mouseDrag(page, 200, 300, 400, 400)

    const after = await getOriginCenter(page)

    // The board moves in the same direction as the pointer drag.
    expect(after.x - before.x).toBeCloseTo(200, 0) // ±1 px (precision 0 → 0.5)
    expect(after.y - before.y).toBeCloseTo(100, 0)
  })

  test('dot grid spacing is preserved at mid-zoom after drag', async ({ page }) => {
    // Verify the CSS background-size stays at GRID_SPACING_WORLD × zoom = 24 px
    const bgSizeBefore = await page.evaluate(() => {
      const vp = document.querySelector('[data-testid="viewport"]') as HTMLElement
      return window.getComputedStyle(vp).backgroundSize
    })
    expect(bgSizeBefore).toBe('24px 24px')

    await mouseDrag(page, 200, 300, 400, 400)

    const bgSizeAfter = await page.evaluate(() => {
      const vp = document.querySelector('[data-testid="viewport"]') as HTMLElement
      return window.getComputedStyle(vp).backgroundSize
    })
    expect(bgSizeAfter).toBe('24px 24px')
  })
})

// ── TC-24 ───────────────────────────────────────────────────────────────────

test.describe('TC-24: Ctrl+wheel zooms at pointer; visualViewport.scale stays 1', () => {
  test('world point under pointer is invariant after Ctrl+wheel zoom', async ({ page }) => {
    // Place pointer at the origin marker's screen position.
    // At initial camera the origin is at the viewport centre (640, 400).
    const originBefore = await getOriginCenter(page)
    const camBefore = await getCamera(page)
    const worldAtPointer = screenToWorld(camBefore, originBefore)

    // Ctrl+wheel with deltaY=-100 zooms IN at the pointer position
    await ctrlWheelAt(page, originBefore.x, originBefore.y, -100)

    const camAfter = await getCamera(page)
    const worldAfter = screenToWorld(camAfter, originBefore)

    // Pointer invariance: same screen point → same world point
    expect(worldAfter.x).toBeCloseTo(worldAtPointer.x, 4)
    expect(worldAfter.y).toBeCloseTo(worldAtPointer.y, 4)
  })

  test('visualViewport.scale stays 1 after Ctrl+wheel on board', async ({ page }) => {
    const scaleBefore = await getVisualViewportScale(page)
    expect(scaleBefore).toBeCloseTo(1, 2)

    await ctrlWheelAt(page, 640, 400, -100)

    const scaleAfter = await getVisualViewportScale(page)
    expect(scaleAfter).toBeCloseTo(1, 2)
  })
})

// ── TC-25 ───────────────────────────────────────────────────────────────────

test.describe('TC-25: Zoom In button disables after reaching 400 %', () => {
  test('click + repeatedly until Zoom In is disabled; label shows 400 %', async ({ page }) => {
    const zoomInBtn = page.locator('[aria-label="Zoom in"]')
    const label = page.locator('[data-testid="zoom-label"]')

    // 7 clicks should bring zoom from 1.0 to 4.0 (1.25^7 > 4, clamped to 4)
    for (let i = 0; i < 7; i++) {
      if (await zoomInBtn.isDisabled()) break
      await zoomInBtn.click()
      await page.waitForTimeout(30)
    }

    await expect(zoomInBtn).toBeDisabled()
    await expect(label).toHaveText('400%')
  })

  test('after Zoom In disables, Zoom Out re-enables it', async ({ page }) => {
    const zoomInBtn = page.locator('[aria-label="Zoom in"]')
    const zoomOutBtn = page.locator('[aria-label="Zoom out"]')

    for (let i = 0; i < 8; i++) {
      if (await zoomInBtn.isDisabled()) break
      await zoomInBtn.click()
      await page.waitForTimeout(30)
    }

    await expect(zoomInBtn).toBeDisabled()

    await zoomOutBtn.click()
    await page.waitForTimeout(50)
    await expect(zoomInBtn).toBeEnabled()
  })
})

// ── TC-26 ───────────────────────────────────────────────────────────────────

test.describe('TC-26: Reset view from max zoom / far position returns to centre', () => {
  test(
    'reset from (1 000 000, 1 000 000, 4) → zoom 100 %; origin at viewport centre',
    async ({ page }) => {
      // Jump to a far-away, zoomed-in position using the test hook
      await setCamera(page, { x: 1_000_000, y: 1_000_000, zoom: 4 })

      // Verify the test hook worked
      const camFar = await getCamera(page)
      expect(camFar.zoom).toBeCloseTo(4, 1)

      // Click Reset view
      await page.locator('[aria-label="Reset view"]').click()
      await page.waitForTimeout(50)

      // After reset: camera = { x: -640, y: -400, zoom: 1 } (for 1280×800 viewport)
      const camReset = await getCamera(page)
      expect(camReset.zoom).toBeCloseTo(1, 3)

      // The origin marker (world 0, 0) should be at the viewport centre (±1 px)
      const originAfter = await getOriginCenter(page)
      expect(originAfter.x).toBeCloseTo(640, 0) // 640 ± 1 px → precision 0
      expect(originAfter.y).toBeCloseTo(400, 0)

      // Zoom label should show 100 %
      await expect(page.locator('[data-testid="zoom-label"]')).toHaveText('100%')
    },
  )
})

// ── TC-27 ───────────────────────────────────────────────────────────────────

test.describe('TC-27: pan at 1 000 000 units – grid spacing and movement exact', () => {
  test(
    'grid spacing and 200×100 drag are exact at UNBOUNDED_PAN_TESTED_EXTENT',
    async ({ page }) => {
      // Jump to a far-away position at zoom 1
      await setCamera(page, { x: 1_000_000, y: 1_000_000, zoom: 1 })

      // Record the background-position (derived from camera.x, camera.y)
      const bgBefore = await page.evaluate(() => {
        const vp = document.querySelector('[data-testid="viewport"]') as HTMLElement
        const s = window.getComputedStyle(vp).backgroundPosition.split(' ').map(parseFloat)
        return { x: s[0], y: s[1] }
      })

      const camBefore = await getCamera(page)

      // Drag the board 200 px right, 100 px down
      await mouseDrag(page, 300, 300, 500, 400)

      const bgAfter = await page.evaluate(() => {
        const vp = document.querySelector('[data-testid="viewport"]') as HTMLElement
        const s = window.getComputedStyle(vp).backgroundPosition.split(' ').map(parseFloat)
        return { x: s[0], y: s[1] }
      })

      const camAfter = await getCamera(page)

      // Background position must shift by exactly the drag amount
      // bgX = -camera.x * zoom → ΔbgX = -(Δcamera.x) * zoom = 200 at zoom 1
      expect(bgAfter.x - bgBefore.x).toBeCloseTo(200, 1)
      expect(bgAfter.y - bgBefore.y).toBeCloseTo(100, 1)

      // Grid spacing unchanged (zoom didn't change during a pan drag)
      const bgSizeAfter = await page.evaluate(() => {
        const vp = document.querySelector('[data-testid="viewport"]') as HTMLElement
        return window.getComputedStyle(vp).backgroundSize
      })
      expect(bgSizeAfter).toBe('24px 24px')

      // Camera at far position: the world coordinates should have moved by
      // exactly -200 / zoom and -100 / zoom (i.e., -200 and -100 at zoom=1)
      expect(camAfter.x).toBeCloseTo(camBefore.x - 200, 3)
      expect(camAfter.y).toBeCloseTo(camBefore.y - 100, 3)
    },
  )
})

// ── TC-28 ───────────────────────────────────────────────────────────────────

test.describe('TC-28: navigation hint – visible on load, gone after first drag', () => {
  test('hint visible on load; disappears after a drag', async ({ page }) => {
    const hint = page.locator('[data-testid="navigation-hint"]')
    await expect(hint).toBeVisible()

    await mouseDrag(page, 200, 300, 400, 400)
    await page.waitForTimeout(50)

    await expect(hint).not.toBeVisible()
  })

  test('hint is gone after plain wheel scroll (not just drag)', async ({ page }) => {
    const hint = page.locator('[data-testid="navigation-hint"]')
    await expect(hint).toBeVisible()

    await plainWheelAt(page, 640, 400, 0, 100)
    await page.waitForTimeout(50)

    await expect(hint).not.toBeVisible()
  })
})

// ── TC-31 ───────────────────────────────────────────────────────────────────

test.describe('TC-31: page zoom unchanged by Ctrl+wheel over board', () => {
  test(
    'visualViewport.scale and devicePixelRatio unchanged after Ctrl+wheel',
    async ({ page }) => {
      const scaleBefore = await getVisualViewportScale(page)
      const dprBefore = await page.evaluate(() => devicePixelRatio)

      // Ctrl+wheel over the board area (this should NOT zoom the page)
      await ctrlWheelAt(page, 400, 300, -100)
      await ctrlWheelAt(page, 400, 300, -100)

      const scaleAfter = await getVisualViewportScale(page)
      const dprAfter = await page.evaluate(() => devicePixelRatio)

      expect(scaleAfter).toBeCloseTo(scaleBefore, 4)
      expect(dprAfter).toBeCloseTo(dprBefore, 4)
    },
  )

  test(
    'world-point invariance holds for far-away positions',
    async ({ page }) => {
      // Jump far away then zoom at pointer – world point invariance must still hold
      await setCamera(page, { x: 500_000, y: -300_000, zoom: 2 })

      const point = { x: 300, y: 200 }
      const camBefore = await getCamera(page)
      const worldBefore = screenToWorld(camBefore, point)

      await ctrlWheelAt(page, point.x, point.y, -80)

      const camAfter = await getCamera(page)
      const worldAfter = screenToWorld(camAfter, point)

      // Pointer invariance at far-away positions (double precision is fine here)
      expect(worldAfter.x).toBeCloseTo(worldBefore.x, 4)
      expect(worldAfter.y).toBeCloseTo(worldBefore.y, 4)

      // Zoom actually changed (not stuck at clamp)
      expect(camAfter.zoom).toBeGreaterThan(camBefore.zoom)
    },
  )

  test(
    'Ctrl+wheel over zoom controls does not zoom the board',
    async ({ page }) => {
      const camBefore = await getCamera(page)

      // Dispatch a synthetic Ctrl+wheel directly on the zoom controls element.
      // The controls are siblings of the viewport, so the viewport's wheel
      // listener is never reached and the camera must stay unchanged.
      await page.evaluate(() => {
        const controls = document.querySelector(
          '[data-testid="zoom-controls"]',
        ) as HTMLElement | null
        if (!controls) return
        const e = new WheelEvent('wheel', {
          deltaY: -100,
          ctrlKey: true,
          clientX: 1200,
          clientY: 750,
          bubbles: true,
          cancelable: true,
        })
        controls.dispatchEvent(e)
      })

      const camAfter = await getCamera(page)
      expect(camAfter).toEqual(camBefore)
    },
  )
})
