/**
 * The board's tool mode.
 *
 * Story 9 introduced this as two tools held in a hook of its own. Story 10 needed the tool to carry
 * more than a choice between two things - which shape, and when to go back to Select after making
 * one - so the state moved to `../tools/useActiveTool.ts`, which every consumer now reads. What is
 * left here is the name: `Tool` is what stories 2 to 9 called it, and the keyboard and the toolbar
 * still speak that name.
 */
export type { ToolId as Tool } from '../../shared/tools';
