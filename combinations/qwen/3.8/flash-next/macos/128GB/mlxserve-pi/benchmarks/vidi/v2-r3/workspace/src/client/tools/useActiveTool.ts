// The board's one active tool, under the names story 10's design uses for it.
//
// Story 9 already grew the tool state — `useTool` in `board/`, with the keys that
// select a tool and the rule that a tool cannot be entered on a board that cannot
// be written — and story 10's design says to extend that rather than start a
// second one next to it: two hook pairs each holding a `tool` would be two answers
// to "which tool is the board in", and only one of them could be right.
//
// So the shape of story 10's `useActiveTool` is this module: the same state, the
// same keys, named the way the design's component list names it. The tools a later
// story adds ('p' pen, 'i' image, 'c' comment) belong in TOOL_SHORTCUTS in
// `board/useTool.ts` with their `BoardTool` member beside them.
import type { BoardTool } from '../board/useTool';

/** The id of a tool the board can be in: 'select' | 'text' | 'shape' | 'connector'. */
export type ToolId = BoardTool;

export { TOOL_SHORTCUTS, toolKey } from '../board/useTool';
export type { BoardTool, ToolKey, UseToolResult } from '../board/useTool';

/**
 * The active tool, the kind the Shape menu last chose, and the keys that change
 * them. See `useTool` for what each of those means and why leaving a tool is one
 * assignment.
 */
export { useTool as useActiveTool, useToolKeys as useActiveToolKeys } from '../board/useTool';
