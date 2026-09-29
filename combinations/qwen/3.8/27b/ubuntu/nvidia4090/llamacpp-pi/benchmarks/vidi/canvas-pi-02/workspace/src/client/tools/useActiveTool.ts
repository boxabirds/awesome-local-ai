/**
 * Active tool hook (story 10).
 *
 * Extends the story 9 ToolState with shape/connector tool state:
 *  - `shapeKind`: the shape kind selected in the Shape menu
 *  - `setShapeKind`: change the shape kind
 *
 * This re-exports useTool with the extended Tool type.
 */

import type { ShapeKind } from '../../shared/config';
import { useTool, type Tool, type ToolState } from '../board/useTool';

export type { Tool, ToolState };

/**
 * Returns the active tool state. The tool state includes:
 *  - `tool`: the active tool ('select' | 'text' | 'shape' | 'connector' | 'pen')
 *  - `setTool`: change the active tool (no-op when not allowed)
 *  - `shapeKind`: the shape kind for the Shape tool ('rect' | 'ellipse' | 'diamond')
 *  - `setShapeKind`: change the shape kind
 */
export function useActiveTool(canEdit: boolean): ToolState {
  return useTool(canEdit);
}
