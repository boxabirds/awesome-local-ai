// jsdom does not implement requestAnimationFrame, but the camera hook
// coalesces updates with rAF. Provide a setTimeout(16ms)-based polyfill so
// fake timers can advance frames deterministically in tests.
if (typeof window !== 'undefined' && typeof window.requestAnimationFrame !== 'function') {
  window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16)) as unknown as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) =>
    clearTimeout(id)) as typeof window.cancelAnimationFrame;
}
