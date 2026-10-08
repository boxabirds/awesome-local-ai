/* eslint-disable @typescript-eslint/no-explicit-any */
// Polyfill PointerEvent for jsdom (not natively supported)
class PointerEventPolyfill extends MouseEvent {
  readonly pointerId: number
  readonly pointerType: string
  readonly isPrimary: boolean
  readonly width: number
  readonly height: number
  readonly pressure: number
  readonly tiltX: number
  readonly tiltY: number
  readonly twist: number

  constructor(type: string, init: Record<string, unknown> = {}) {
    super(type, { bubbles: true, cancelable: true, ...init })
    this.pointerId = (init.pointerId as number) ?? 1
    this.pointerType = (init.pointerType as string) ?? 'mouse'
    this.isPrimary = (init.isPrimary as boolean) ?? true
    this.width = 0
    this.height = 0
    this.pressure = 0
    this.tiltX = 0
    this.tiltY = 0
    this.twist = 0
  }
}

const _win = globalThis as Record<string, unknown>

if (typeof _win['PointerEvent'] === 'undefined') {
  _win['PointerEvent'] = PointerEventPolyfill
}

// Polyfill ResizeObserver
if (typeof _win['ResizeObserver'] === 'undefined') {
  class ResizeObserverMock {
    private cb: ResizeObserverCallback
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb
    }
    observe(_el: Element) {
      const entry = {
        target: _el,
        contentRect: { width: 1280, height: 800 } as DOMRectReadOnly,
        borderBoxSize: [{ blockSize: 800, inlineSize: 1280 }] as ResizeObserverSize[],
        contentBoxSize: [{ blockSize: 800, inlineSize: 1280 }] as ResizeObserverSize[],
        devicePixelContentBoxSize: [] as ResizeObserverSize[],
      }
      queueMicrotask(() => this.cb([entry], this as unknown as ResizeObserver))
    }
    unobserve(_el: Element) {}
    disconnect() {}
  }
  _win['ResizeObserver'] = ResizeObserverMock
}

// Override requestAnimationFrame: jsdom provides an async one; tests need synchronous.
_win['requestAnimationFrame'] = (cb: FrameRequestCallback) => {
  cb(performance.now())
  return 0
}
_win['cancelAnimationFrame'] = (_id: number) => {}

// Polyfill setPointerCapture / releasePointerCapture / hasPointerCapture
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = function (_id: number) {}
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = function (_id: number) {}
}
if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = function (_id: number) {
    return false
  }
}
