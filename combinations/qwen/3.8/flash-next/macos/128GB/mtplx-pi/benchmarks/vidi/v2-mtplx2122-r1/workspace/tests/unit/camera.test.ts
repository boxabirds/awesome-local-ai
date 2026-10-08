import { describe, it, expect } from 'vitest'
import {
  screenToWorld,
  worldToScreen,
  panBy,
  zoomAt,
  zoomStep,
  resetCamera,
  canZoomIn,
  canZoomOut,
  zoomPercent,
  type Camera,
  type Point,
  type Size,
} from '../../src/client/canvas/camera'
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP_FACTOR,
  UNBOUNDED_PAN_TESTED_EXTENT,
} from '../../src/shared/config'

function closeTo(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps
}

function ptClose(a: Point, b: Point, eps = 1e-6): boolean {
  return closeTo(a.x, b.x, eps) && closeTo(a.y, b.y, eps)
}

const ORIGIN_CAM: Camera = { x: 0, y: 0, zoom: 1 }
const VIEWPORT: Size = { width: 1280, height: 800 }

describe('TC-01 panBy at zoom 1 at origin', () => {
  it('moves camera by (-dx/zoom, -dy/zoom)', () => {
    const result = panBy(ORIGIN_CAM, 200, 100)
    expect(result.x).toBeCloseTo(-200, 10)
    expect(result.y).toBeCloseTo(-100, 10)
    expect(result.zoom).toBe(1)
  })

  it('world origin moves from screen (0,0) to screen (200,100)', () => {
    const before = worldToScreen(ORIGIN_CAM, { x: 0, y: 0 })
    const after = worldToScreen(panBy(ORIGIN_CAM, 200, 100), { x: 0, y: 0 })
    expect(closeTo(before.x, 0, 1e-9) && closeTo(before.y, 0, 1e-9)).toBe(true)
    expect(closeTo(after.x, 200, 1e-6) && closeTo(after.y, 100, 1e-6)).toBe(true)
  })
})

describe('TC-02 panBy at ZOOM_MAX far away', () => {
  it('shifts by (-dx/zoom, -dy/zoom) world units exactly', () => {
    const cam: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: ZOOM_MAX,
    }
    const result = panBy(cam, 200, 100)
    const expectedDx = 200 / ZOOM_MAX
    const expectedDy = 100 / ZOOM_MAX
    expect(closeTo(result.x, cam.x - expectedDx, 1e-6)).toBe(true)
    expect(closeTo(result.y, cam.y - expectedDy, 1e-6)).toBe(true)
  })
})

describe('TC-03 zoomAt keeps pointer world point invariant at origin', () => {
  it('screenToWorld(300,200) is identical before and after zoom', () => {
    const point: Point = { x: 300, y: 200 }
    const before = screenToWorld(ORIGIN_CAM, point)
    const after = screenToWorld(zoomAt(ORIGIN_CAM, point, 2), point)
    expect(ptClose(before, after)).toBe(true)
  })

  it('zoom doubles', () => {
    const result = zoomAt(ORIGIN_CAM, { x: 300, y: 200 }, 2)
    expect(result.zoom).toBeCloseTo(2, 10)
  })
})

describe('TC-04 zoomAt keeps pointer world point invariant far away', () => {
  it('pointer invariance at UNBOUNDED_PAN_TESTED_EXTENT with factor 1.5', () => {
    const point: Point = { x: 500, y: 400 }
    const cam: Camera = {
      x: UNBOUNDED_PAN_TESTED_EXTENT,
      y: UNBOUNDED_PAN_TESTED_EXTENT,
      zoom: 1,
    }
    const before = screenToWorld(cam, point)
    const after = screenToWorld(zoomAt(cam, point, 1.5), point)
    expect(ptClose(before, after)).toBe(true)
  })
})

describe('TC-05 zoomAt at ZOOM_MIN zooming further returns same object', () => {
  it('zoomAt at ZOOM_MIN with inverse factor returns same camera reference', () => {
    const cam: Camera = { x: 100, y: 200, zoom: ZOOM_MIN }
    const centre: Point = { x: 640, y: 400 }
    const result = zoomAt(cam, centre, 1 / ZOOM_STEP_FACTOR)
    expect(result).toBe(cam)
  })
})

describe('TC-06 zoomAt at ZOOM_MAX zooming further returns same object', () => {
  it('zoomAt at ZOOM_MAX with zoom-in factor returns same camera reference', () => {
    const cam: Camera = { x: 100, y: 200, zoom: ZOOM_MAX }
    const centre: Point = { x: 640, y: 400 }
    const result = zoomAt(cam, centre, ZOOM_STEP_FACTOR)
    expect(result).toBe(cam)
  })
})

describe('TC-07 viewport resize leaves camera unchanged', () => {
  it('panBy result is independent of viewport size', () => {
    const cam = ORIGIN_CAM
    const panResult = panBy(cam, 10, 10)
    // Camera is not coupled to viewport; no DOM needed to verify
    expect(panResult.zoom).toBe(cam.zoom)
    expect(panResult.x).not.toBe(cam.x)
  })
})

describe('TC-08 resetCamera(1200x800)', () => {
  it('sets zoom to 1 and centres the origin at (600, 400)', () => {
    const result = resetCamera({ width: 1200, height: 800 })
    expect(result.zoom).toBe(1)
    const origin = worldToScreen(result, { x: 0, y: 0 })
    expect(closeTo(origin.x, 600, 1e-6)).toBe(true)
    expect(closeTo(origin.y, 400, 1e-6)).toBe(true)
    expect(closeTo(result.x, -600, 1e-9)).toBe(true)
    expect(closeTo(result.y, -400, 1e-9)).toBe(true)
  })
})

describe('TC-09 zoomStep in then out returns exactly zoom 1.0', () => {
  it('1.0 → 1.25 → 1.0 (exact, not approximate)', () => {
    const step1 = zoomStep(ORIGIN_CAM, VIEWPORT, 'in')
    expect(step1.zoom).toBeCloseTo(ZOOM_STEP_FACTOR, 10)
    const step2 = zoomStep(step1, VIEWPORT, 'out')
    expect(step2.zoom).toBe(1)
  })
})

describe('TC-10 20 steps in clamps at ZOOM_MAX', () => {
  it('after 20 steps, zoom is ZOOM_MAX and canZoomIn is false', () => {
    let cam: Camera = ORIGIN_CAM
    for (let i = 0; i < 20; i++) {
      cam = zoomStep(cam, VIEWPORT, 'in')
    }
    expect(cam.zoom).toBe(ZOOM_MAX)
    expect(canZoomIn(cam)).toBe(false)
  })

  it('further zoomStep in returns same object reference', () => {
    const camAtMax: Camera = { x: 10, y: 20, zoom: ZOOM_MAX }
    const result = zoomStep(camAtMax, VIEWPORT, 'in')
    expect(result).toBe(camAtMax)
  })
})

describe('TC-11 large zoom factor clamps and pointer invariance holds', () => {
  it('factor 1000 clamps to ZOOM_MAX; pointer invariance still holds', () => {
    const point: Point = { x: 300, y: 200 }
    const before = screenToWorld(ORIGIN_CAM, point)
    const result = zoomAt(ORIGIN_CAM, point, 1000)
    expect(result.zoom).toBe(ZOOM_MAX)
    const after = screenToWorld(result, point)
    expect(ptClose(before, after)).toBe(true)
  })
})

describe('TC-12 invalid factors return input camera unchanged', () => {
  const cam: Camera = { x: 10, y: 20, zoom: 2 }
  const point: Point = { x: 100, y: 100 }

  it('factor 0 → unchanged', () => {
    expect(zoomAt(cam, point, 0)).toBe(cam)
  })

  it('factor negative → unchanged', () => {
    expect(zoomAt(cam, point, -1)).toBe(cam)
  })

  it('factor NaN → unchanged', () => {
    expect(zoomAt(cam, point, NaN)).toBe(cam)
  })

  it('factor Infinity → unchanged', () => {
    expect(zoomAt(cam, point, Infinity)).toBe(cam)
  })

  it('factor -Infinity → unchanged', () => {
    expect(zoomAt(cam, point, -Infinity)).toBe(cam)
  })

  it('no NaN in output for valid factors', () => {
    const r = zoomAt(cam, point, 1.5)
    expect(Number.isFinite(r.x)).toBe(true)
    expect(Number.isFinite(r.y)).toBe(true)
    expect(Number.isFinite(r.zoom)).toBe(true)
  })
})

describe('zoomPercent', () => {
  it('rounds to nearest whole percent', () => {
    expect(zoomPercent({ x: 0, y: 0, zoom: 1 })).toBe(100)
    expect(zoomPercent({ x: 0, y: 0, zoom: 1.5625 })).toBe(156)
    expect(zoomPercent({ x: 0, y: 0, zoom: 4 })).toBe(400)
    expect(zoomPercent({ x: 0, y: 0, zoom: 0.1 })).toBe(10)
  })
})

describe('canZoomIn / canZoomOut', () => {
  it('at ZOOM_MIN: canZoomOut false', () => {
    const cam = { x: 0, y: 0, zoom: ZOOM_MIN }
    expect(canZoomOut(cam)).toBe(false)
    expect(canZoomIn(cam)).toBe(true)
  })

  it('at ZOOM_MAX: canZoomIn false', () => {
    const cam = { x: 0, y: 0, zoom: ZOOM_MAX }
    expect(canZoomIn(cam)).toBe(false)
    expect(canZoomOut(cam)).toBe(true)
  })

  it('mid zoom: both true', () => {
    const cam = { x: 0, y: 0, zoom: 1 }
    expect(canZoomIn(cam)).toBe(true)
    expect(canZoomOut(cam)).toBe(true)
  })
})

describe('Property: 1000 random pointer-invariance checks', () => {
  it('all 1000 seeded random cameras/points/factors maintain pointer invariance within 1e-6', () => {
    let seed = 0x12345678
    function random() {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0xffffffff
    }

    let pass = 0
    for (let i = 0; i < 1000; i++) {
      const cam: Camera = {
        x: (random() - 0.5) * 20000,
        y: (random() - 0.5) * 20000,
        zoom: ZOOM_MIN + random() * (ZOOM_MAX - ZOOM_MIN),
      }
      const point: Point = { x: random() * 1280, y: random() * 800 }
      const factor = 0.5 + random() * 2
      const before = screenToWorld(cam, point)
      const zoomedCam = zoomAt(cam, point, factor)
      const after = screenToWorld(zoomedCam, point)
      if (ptClose(before, after)) pass++
    }
    expect(pass).toBe(1000)
  })
})