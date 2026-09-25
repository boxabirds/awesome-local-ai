import { describe, expect, it, vi } from 'vitest';

import { CameraStore } from '../../src/client/canvas/useCamera';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../src/shared/config';

const VIEWPORT = { width: 1200, height: 800 };

const nextFrame = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 40);
  });

async function storeWith(store: CameraStore) {
  store.setViewport(VIEWPORT);
  await nextFrame();
  return store;
}

describe('CameraStore', () => {
  it('starts at the board start, 100%, not yet navigated', async () => {
    const store = await storeWith(new CameraStore());
    expect(store.getSnapshot()).toEqual({
      camera: { x: 0, y: 0, zoom: 1 },
      hasNavigated: false,
      panning: false,
    });
  });

  it('pans between beginPan/panMove/endPan and reports the panning flag', async () => {
    const store = await storeWith(new CameraStore());

    store.beginPan({ x: 100, y: 100 });
    expect(store.getSnapshot().panning).toBe(true);

    store.panMove({ x: 300, y: 200 });
    await nextFrame();
    expect(store.getSnapshot().camera).toEqual({ x: -200, y: -100, zoom: 1 });

    store.endPan();
    expect(store.getSnapshot().panning).toBe(false);
    expect(store.getSnapshot().hasNavigated).toBe(true);
  });

  it('leaves hasNavigated false for gestures that change nothing (TC-29)', async () => {
    const store = await storeWith(new CameraStore());

    store.beginPan({ x: 10, y: 10 });
    store.panMove({ x: 10, y: 10 }); // zero-length movement
    store.endPan();
    store.wheel({ deltaX: 0, deltaY: 0, ctrlOrMeta: false, point: { x: 0, y: 0 } });
    await nextFrame();

    expect(store.getSnapshot().camera).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(store.getSnapshot().hasNavigated).toBe(false);
  });

  it('does not notify at all when a zoom step is already at the limit', async () => {
    const store = await storeWith(new CameraStore());
    for (let i = 0; i < 30; i += 1) store.zoomStep('out');
    await nextFrame();
    expect(store.getSnapshot().camera.zoom).toBe(ZOOM_MIN);

    const notificationsBefore = store.getSnapshot();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    store.zoomStep('out'); // already at the minimum: a no-op
    await nextFrame();

    expect(notifications).toBe(0);
    expect(store.getSnapshot()).toBe(notificationsBefore);
  });

  it('coalesces several updates in the same frame into one notification', async () => {
    const store = await storeWith(new CameraStore());
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    store.wheel({ deltaX: 10, deltaY: 0, ctrlOrMeta: false, point: { x: 0, y: 0 } });
    store.wheel({ deltaX: 10, deltaY: 0, ctrlOrMeta: false, point: { x: 0, y: 0 } });
    store.wheel({ deltaX: 10, deltaY: 0, ctrlOrMeta: false, point: { x: 0, y: 0 } });
    expect(notifications).toBe(0); // still queued

    await nextFrame();
    expect(notifications).toBe(1);
    expect(store.getSnapshot().camera.x).toBeCloseTo(30, 6);
  });

  it('zooms around the viewport centre with zoomStep and resets with reset', async () => {
    const store = await storeWith(new CameraStore());

    store.zoomStep('in');
    await nextFrame();
    expect(store.getSnapshot().camera.zoom).toBe(ZOOM_STEP_FACTOR);

    store.reset();
    await nextFrame();
    expect(store.getSnapshot().camera).toEqual({
      x: -VIEWPORT.width / 2,
      y: -VIEWPORT.height / 2,
      zoom: 1,
    });
  });

  it('keeps a resize from changing the camera (TC-07)', async () => {
    const store = await storeWith(new CameraStore());
    store.zoomStep('in');
    await nextFrame();
    const camera = store.getSnapshot().camera;

    store.setViewport({ width: 1920, height: 1080 });
    expect(store.getSnapshot().camera).toBe(camera);
  });

  it('jumps to an exact camera with setCamera and marks it navigated', async () => {
    const store = await storeWith(new CameraStore());
    store.setCamera({ x: 1_000_000, y: -1_000_000, zoom: ZOOM_MAX });

    expect(store.getSnapshot().camera).toEqual({ x: 1_000_000, y: -1_000_000, zoom: ZOOM_MAX });
    expect(store.getSnapshot().hasNavigated).toBe(true);
    expect(ZOOM_MAX).toBeGreaterThan(1);
  });

  it('ignores gestures after dispose', async () => {
    const store = await storeWith(new CameraStore());
    const listener = vi.fn();
    store.subscribe(listener);
    store.dispose();

    store.zoomStep('in');
    await nextFrame();
    expect(listener).not.toHaveBeenCalled();
  });
});
