/**
 * The board's tools, named in one place (story 10).
 *
 * A tool is per-screen state - never written to the document - so two people on the same board can
 * be in different tools at the same time. The ids are shared between the toolbar, the keyboard and
 * the surface so that "which tool is active" is one string compared in three files, and a tool this
 * build does not have can still be named by a later one without inventing a second vocabulary.
 */
import type { ShapeKind } from './objects/shape';

export type ToolId =
  | 'select'
  | 'text'
  | 'sticky'
  | 'shape-rect'
  | 'shape-ellipse'
  | 'shape-diamond'
  | 'connector'
  | 'image';

/** Every tool the vocabulary knows, in toolbar order. */
export const TOOL_IDS: readonly ToolId[] = [
  'select',
  'sticky',
  'text',
  'shape-rect',
  'shape-ellipse',
  'shape-diamond',
  'connector',
  'image',
];

/**
 * The tools this build actually offers. `sticky` is an action rather than a mode (the button and N
 * drop a note in the middle of the view), and `image` is story 12's; listing them here keeps the
 * toolbar, the keyboard and the surface agreeing on what a key press may switch to.
 */
export const BUILT_TOOLS: readonly ToolId[] = [
  'select',
  'text',
  'shape-rect',
  'shape-ellipse',
  'shape-diamond',
  'connector',
];

/** The three shape tools, in the order the shape bar shows them. */
export const SHAPE_TOOLS: readonly Extract<ToolId, `shape-${ShapeKind}`>[] = [
  'shape-rect',
  'shape-ellipse',
  'shape-diamond',
];

/** The tool the shape bar shows for a kind. */
export function shapeToolId(kind: ShapeKind): ToolId {
  return `shape-${kind}`;
}

/** True for the three shape tools, which behave alike apart from the outline they draw. */
export function isShapeTool(tool: ToolId): tool is 'shape-rect' | 'shape-ellipse' | 'shape-diamond' {
  return tool === 'shape-rect' || tool === 'shape-ellipse' || tool === 'shape-diamond';
}

/** The kind a shape tool draws; undefined for every other tool. */
export function shapeKindOf(tool: ToolId): ShapeKind | undefined {
  return isShapeTool(tool) ? (tool.slice('shape-'.length) as ShapeKind) : undefined;
}

/**
 * Keys that switch tools, unmodified. `n` is missing on purpose: it makes a note rather than
 * selecting a tool, and stays with the note code that places it.
 */
export const TOOL_KEYS: Readonly<Record<string, ToolId>> = Object.freeze({
  v: 'select',
  t: 'text',
  s: 'shape-rect',
  l: 'connector',
});

export function isToolId(value: unknown): value is ToolId {
  return typeof value === 'string' && TOOL_IDS.includes(value as ToolId);
}

/** True when this build has the tool, so a key press or a toolbar click may select it. */
export function isBuiltTool(tool: ToolId): boolean {
  return BUILT_TOOLS.includes(tool);
}
