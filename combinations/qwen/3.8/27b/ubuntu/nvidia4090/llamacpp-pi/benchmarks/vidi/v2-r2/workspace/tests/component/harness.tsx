import { type RenderResult } from '@testing-library/react';
import { render } from '@testing-library/react';
import * as Y from 'yjs';
import { Board } from '../../src/client/Board';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import {
  canZoomIn,
  canZoomOut,
  zoomPercent,
  type Size,
} from '../../src/client/canvas/camera';
import { CameraContext, useCamera } from '../../src/client/canvas/useCamera';

/** Fixed viewport size for component tests (default laptop, design fixture). */
export const TEST_VIEWPORT: Size = { width: 1280, height: 800 };

export interface BoardHarnessOptions {
  withHint?: boolean;
  withControls?: boolean;
  /** (Ignored by the real board: it always renders the badge.) */
  withStatusBadge?: boolean;
}

export interface BoardHarnessResult extends RenderResult {
  /** The camera the viewport currently renders (read after each act). */
  readCamera(): { x: number; y: number; zoom: number };
}

function readWorldCamera(utils: RenderResult): { x: number; y: number; zoom: number } {
  const worldLayer = utils.getByTestId('world-layer');
  const transform = worldLayer.style.transform;
  const match = transform.match(
    /scale\(([-\d.eE+]+)\) translate\(([-\d.eE+]+)px,\s*([-\d.eE+]+)px\)/,
  );
  if (!match) {
    throw new Error(`unexpected world layer transform: ${transform}`);
  }
  return {
    x: -Number(match[2]),
    y: -Number(match[3]),
    zoom: Number(match[1]),
  };
}

/**
 * Renders the board surface wired exactly like the app does (useCamera +
 * context + BoardViewport, plus the zoom controls and hint), with a fixed
 * viewport size, so component tests exercise the real input handlers and
 * rendering.
 */
export function renderBoard(options: BoardHarnessOptions = {}): BoardHarnessResult {
  function Harness() {
    const controller = useCamera(TEST_VIEWPORT);
    return (
      <CameraContext.Provider value={controller}>
        <BoardViewport />
        {options.withControls !== false && (
          <ZoomControls
            zoomPercent={zoomPercent(controller.camera)}
            canZoomIn={canZoomIn(controller.camera)}
            canZoomOut={canZoomOut(controller.camera)}
            onZoomIn={() => controller.zoomStep('in')}
            onZoomOut={() => controller.zoomStep('out')}
            onReset={controller.reset}
          />
        )}
        {options.withHint === true && <NavigationHint visible={!controller.hasNavigated} />}
      </CameraContext.Provider>
    );
  }

  const utils = render(<Harness />);

  return { ...utils, readCamera: () => readWorldCamera(utils) };
}

export interface StickyBoardHarnessResult extends RenderResult {
  /** The Y.Doc backing the rendered board (mutate inside act()). */
  doc: Y.Doc;
  /** The camera the viewport currently renders (read after each act). */
  readCamera(): { x: number; y: number; zoom: number };
}

/**
 * Renders the real <Board> (story 7 wiring: registry rendering, multi-
 * selection, transform gesture, marquee, keyboard commands) with the mocked
 * y-websocket provider (tests/component/setup.ts) and a fixed viewport size
 * (window.innerWidth/innerHeight are set to 1280x800 there).
 */
export function renderStickyBoard(_options: BoardHarnessOptions = {}): StickyBoardHarnessResult {
  let docInstance: Y.Doc | null = null;

  const utils = render(
    <Board
      boardId="harness-board"
      onDocReady={(doc) => {
        docInstance = doc;
      }}
    />,
  );

  if (docInstance === null) {
    throw new Error('sticky board harness did not render a document');
  }

  return { ...utils, doc: docInstance, readCamera: () => readWorldCamera(utils) };
}
