/**
 * Shared harness for the component tests: mounts the real App wiring (camera
 * provider, viewport, zoom controls, hint) in jsdom and hands the tests a
 * handle on the live camera navigation plus the elements they measure.
 */
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { CameraProvider, useCameraContext } from '../../src/client/canvas/CameraContext';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent, type Camera } from '../../src/client/canvas/camera';
import type { CameraNav } from '../../src/client/canvas/useCamera';

/** The camera reset to, i.e. the view a full-window board opens with. */
export const HOME_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

interface NavProbeProps {
  onNav(nav: CameraNav): void;
}

function NavProbe({ onNav }: NavProbeProps) {
  onNav(useCameraContext());
  return null;
}

function Chrome() {
  const nav = useCameraContext();
  return (
    <>
      <ZoomControls
        zoomPercent={zoomPercent(nav.camera)}
        canZoomIn={canZoomIn(nav.camera)}
        canZoomOut={canZoomOut(nav.camera)}
        onZoomIn={() => {
          nav.zoomStep('in');
        }}
        onZoomOut={() => {
          nav.zoomStep('out');
        }}
        onReset={nav.reset}
      />
      <NavigationHint visible={!nav.hasNavigated} />
    </>
  );
}

export interface BoardHandle {
  nav(): CameraNav;
  camera(): Camera;
  viewport(): HTMLElement;
  worldLayer(): HTMLElement;
  zoomLabel(): HTMLElement;
}

const FRAME_MS = 25;

async function advanceFrames(frames = 2): Promise<void> {
  for (let i = 0; i < frames; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, FRAME_MS));
    });
  }
}

/** Mount the board and put the camera somewhere known. */
export async function renderBoard(initial: Camera = HOME_CAMERA, children?: ReactNode): Promise<BoardHandle> {
  let navRef: CameraNav | null = null;
  const capture = (nav: CameraNav) => {
    navRef = nav;
  };

  render(
    <CameraProvider>
      <NavProbe onNav={capture} />
      <div className="app">
        <BoardViewport>{children}</BoardViewport>
        <Chrome />
      </div>
    </CameraProvider>,
  );

  const nav = () => {
    if (!navRef) throw new Error('camera navigation was not captured');
    return navRef;
  };

  act(() => {
    nav().setCamera(initial);
  });
  await advanceFrames();

  return {
    nav,
    camera: () => nav().camera,
    viewport: () => screen.getByTestId('board-viewport'),
    worldLayer: () => screen.getByTestId('world-layer'),
    zoomLabel: () => screen.getByTestId('zoom-level'),
  };
}

export { advanceFrames };

/** Read the camera back the way the DOM renders it, for cross-checking. */
export function cameraFromDom(element: HTMLElement): Camera {
  const { cameraX, cameraY, cameraZoom } = element.dataset;
  return { x: Number(cameraX), y: Number(cameraY), zoom: Number(cameraZoom) };
}
