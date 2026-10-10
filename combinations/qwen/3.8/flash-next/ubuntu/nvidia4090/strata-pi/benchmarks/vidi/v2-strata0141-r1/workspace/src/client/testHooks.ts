import type { Camera } from './canvas/camera';
import type {
  ShapeFillColor,
  ShapeKind,
  ShapeStrokeColor,
  StickyColor,
  TextSize,
  PenColor,
  PenThickness,
} from '../shared/config';
import type { StickySnapshot } from '../shared/board-model';
import type { TextSnapshot } from '../shared/objects/text';
import type { ShapeSnapshot } from '../shared/objects/shape';
import type { ConnectorSnapshot, EndpointInput } from '../shared/objects/connector';
import type { StrokeSnap } from '../shared/objects/stroke';
import type { ImageSnap } from '../shared/objects/image';

/** Test-only note creation arguments, mirroring `createSticky`. */
export interface TestStickyParams {
  at: { x: number; y: number };
  color?: StickyColor;
  /** Typed-in text, written straight into the note's `Y.Text`. */
  text?: string;
}

/** Test-only text object creation arguments, mirroring `createText`. */
export interface TestTextParams {
  at: { x: number; y: number };
  text?: string;
  size?: TextSize;
}

/** Test-only shape creation arguments, mirroring `createShape` plus its style. */
export interface TestShapeParams {
  at: { x: number; y: number };
  /** The dragged rectangle's size, with `at` as the corner it grew from; left out
   * is the click case, which takes the default box centred on `at`. */
  size?: { width: number; height: number };
  square?: boolean;
  kind?: ShapeKind;
  fill?: ShapeFillColor;
  stroke?: ShapeStrokeColor;
  /** Typed-in label, written straight into the shape's `Y.Text`. */
  label?: string;
}

/** Test-only connector creation arguments, mirroring `createConnector`. */
export interface TestConnectorParams {
  from: EndpointInput;
  to: EndpointInput;
}

/** Test-only stroke creation arguments, mirroring `createStroke`. */
export interface TestStrokeParams {
  /** World-space points, in the order they were recorded. */
  points: { x: number; y: number }[];
  color?: PenColor;
  thickness?: PenThickness;
}

/** Test-only bulk seeding: `count` notes spread over a rectangle. */
export interface TestSeedParams {
  count: number;
  area: { x: number; y: number; width: number; height: number };
}

export interface Vidi6TestHooks {
  /** Jump the camera anywhere on the board (used by e2e "far travel" tests). */
  setCamera(camera: Camera): void;
  /** Read the current camera. */
  getCamera(): Camera | null;
  /** The live document, topmost last (story 2 e2e). */
  notes(): StickySnapshot[];
  /** Put a note on the board through the model, for test setup. */
  createNote(params: TestStickyParams): string;
  /** Every text object on the board, topmost last (story 9 e2e). */
  texts(): TextSnapshot[];
  /** Put a text object on the board through the model, for test setup. */
  createText(params: TestTextParams): string;
  /** Every shape on the board, topmost last (story 10 e2e). */
  shapes(): ShapeSnapshot[];
  /** Put a shape on the board through the model, for test setup. */
  createShape(params: TestShapeParams): string;
  /** Every arrow on the board, topmost last (story 10 e2e). */
  connectors(): ConnectorSnapshot[];
  /** Put an arrow on the board through the model, for test setup. */
  createConnector(params: TestConnectorParams): string;
  /** Every stroke on the board, topmost last (story 11 e2e). */
  strokes(): StrokeSnap[];
  /** Put a stroke on the board through the model, for test setup (story 11). */
  createStroke(params: TestStrokeParams): string;
  /** Every image on the board, topmost last (story 12 e2e). */
  images(): ImageSnap[];
  /** Seed many notes in one transaction, for test setup (large-board tests). */
  createNotes(params: TestSeedParams): number;
  /** The connection state the status badge is rendering (story 3). */
  connectionState(): string;
}

declare global {
  interface Window {
    __vidi6?: Vidi6TestHooks;
  }
}

type CameraApi = {
  set: (camera: Camera) => void;
  get: () => Camera;
};

export interface SeedApi {
  seed: (params: TestSeedParams) => number;
}

let cameraApi: CameraApi | null = null;
let seedApi: SeedApi | null = null;

/** Called by useCamera while mounted; pass null on unmount. */
export function registerCameraApi(api: CameraApi | null): void {
  cameraApi = api;
}

/** Called by App while mounted; pass null on unmount. */
export function registerSeedApi(api: SeedApi | null): void {
  seedApi = api;
}

export interface BoardApi {
  notes: () => StickySnapshot[];
  createNote: (params: TestStickyParams) => string;
  texts: () => TextSnapshot[];
  createText: (params: TestTextParams) => string;
  shapes: () => ShapeSnapshot[];
  createShape: (params: TestShapeParams) => string;
  connectors: () => ConnectorSnapshot[];
  createConnector: (params: TestConnectorParams) => string;
  strokes: () => StrokeSnap[];
  createStroke: (params: TestStrokeParams) => string;
  images: () => ImageSnap[];
  connectionState: () => string;
}

let boardApi: BoardApi | null = null;

/** Called by App while mounted; pass null on unmount. */
export function registerBoardApi(api: BoardApi | null): void {
  boardApi = api;
}

/** Installs `window.__vidi6` only in the test build (never in production). */
export function installTestHooks(): void {
  if (import.meta.env.MODE !== 'test') {
    return;
  }
  window.__vidi6 = {
    setCamera: (camera) => cameraApi?.set(camera),
    getCamera: () => cameraApi?.get() ?? null,
    notes: () => boardApi?.notes() ?? [],
    createNote: (params) => boardApi?.createNote(params) ?? '',
    texts: () => boardApi?.texts() ?? [],
    createText: (params) => boardApi?.createText(params) ?? '',
    shapes: () => boardApi?.shapes() ?? [],
    createShape: (params) => boardApi?.createShape(params) ?? '',
    connectors: () => boardApi?.connectors() ?? [],
    createConnector: (params) => boardApi?.createConnector(params) ?? '',
    strokes: () => boardApi?.strokes() ?? [],
    createStroke: (params) => boardApi?.createStroke(params) ?? '',
    images: () => boardApi?.images() ?? [],
    createNotes: (params) => seedApi?.seed(params) ?? 0,
    connectionState: () => boardApi?.connectionState() ?? 'connecting',
  };
}
