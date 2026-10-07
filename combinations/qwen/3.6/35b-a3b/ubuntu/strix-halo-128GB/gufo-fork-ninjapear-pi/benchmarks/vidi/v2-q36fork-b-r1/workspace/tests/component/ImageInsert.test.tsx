/**
 * Story 12 -- Component tests for image insert flows and ImageObject states (TC-17 to TC-19, TC-21 to TC-24, TC-29).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import * as Y from 'yjs'
import { IMAGE_ACCEPTED_TYPES, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config'
import { validateFiles, REJECTION_MESSAGES } from '../../src/client/images/validateFiles'
import { displayStatus, placementSize, layoutRow } from '../../src/shared/objects/image'
import { showToast, Toast } from '../../src/client/ui/Toast'

beforeEach(() => {
  cleanup()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ValidateFiles TC-17 variant
describe('validateFiles (TC-17 variant)', () => {
  function makeFile(name: string, size: number, type: string): File {
    return new File([new ArrayBuffer(Math.min(size, 1024))], name, { type })
  }

  it('TC-17: accepts valid PNG files', () => {
    const png = makeFile('img.png', 500, 'image/png')
    const result = validateFiles([png])
    expect(result.accepted).toHaveLength(1)
    expect(result.rejections.size).toBe(0)
  })

  it('TC-17: rejects PDF with type rejection', () => {
    const pdf = makeFile('doc.pdf', 500, 'application/pdf')
    const result = validateFiles([pdf])
    expect(result.accepted).toHaveLength(0)
    expect(result.rejections.has('type')).toBe(true)
  })
})

// Toast TC-29 variant
describe('Toast (TC-29 variant)', () => {
  it('renders a toast message when visible', () => {
    // Set up a promise that resolves later so the toast stays visible during render
    const originalSetTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((cb: (...args: unknown[]) => unknown, ...args: unknown[]) => {
      const delay = typeof args[1] === 'number' ? args[1] as number : 5000
      if (delay === 5000) {
        // Delay the auto-dismiss to keep toast visible during test
        return originalSetTimeout(cb as () => void, 9999999)
      }
      return originalSetTimeout(cb as () => void, delay)
    }) as any

    showToast('Test message')
    render(<Toast />)
    expect(screen.getByRole('status')).toHaveTextContent('Test message')

    vi.restoreAllMocks()
  })
})

// displayStatus TC-21/22 variants
describe('displayStatus', () => {
  const now = Date.now()

  it('TC-21: failed object has "failed" status', () => {
    const img = {
      id: 'test',
      type: 'image' as const,
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      assetKey: null,
      contentType: 'image/png',
      naturalWidth: 200,
      naturalHeight: 160,
      status: 'failed' as const,
      uploadStartedAt: now - 60000,
      uploaderId: 'user',
      z: 1,
    }
    expect(displayStatus(img, now)).toBe('failed')
  })

  it('TC-22: uploading older than IMAGE_UPLOAD_STALE_MS shows "unfinished"', () => {
    const img = {
      id: 'test',
      type: 'image' as const,
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      assetKey: null,
      contentType: 'image/png',
      naturalWidth: 200,
      naturalHeight: 160,
      status: 'uploading' as const,
      uploadStartedAt: now - IMAGE_UPLOAD_STALE_MS - 1000,
      uploaderId: 'user',
      z: 1,
    }
    expect(displayStatus(img, now)).toBe('unfinished')
  })
})

// placementSize / layoutRow (TC-17, TC-27 variants)
describe('placementSize (TC-27 variant)', () => {
  it('preserves proportions', () => {
    // 1920x1080 -> 800x450
    const s = placementSize(1920, 1080)
    const ratio = 1920 / 1080
    const actualRatio = s.width / s.height
    expect(actualRatio).toBeCloseTo(ratio, 4)
    expect(Math.max(s.width, s.height)).toBe(800)
  })
})

describe('layoutRow (TC-17 variant)', () => {
  it('places items in a row from the start point', () => {
    const sizes = [
      { width: 100, height: 80 },
      { width: 120, height: 90 },
      { width: 80, height: 60 },
    ]
    const rects = layoutRow(sizes, { x: 500, y: 300 }, 'top-left')
    expect(rects[0].x).toBe(500)
    expect(rects[0].y).toBe(300)
    expect(rects[1].x).toBe(500 + 100 + 24) // gap is 24
    expect(rects[2].x).toBe(500 + 100 + 24 + 120 + 24)
  })
})
