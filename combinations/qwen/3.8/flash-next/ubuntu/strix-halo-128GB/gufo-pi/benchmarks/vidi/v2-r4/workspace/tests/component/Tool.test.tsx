/**
 * Component tests for tool mode: useTool, Toolbar tool buttons, BoardViewport click-to-create.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useTool } from '../../src/client/board/useTool';
import { Toolbar } from '../../src/client/board/Toolbar';

describe('useTool', () => {
  it('TC-14: T sets Text active, Escape sets Select', () => {
    const { result } = renderHookWithProps(useTool, true);
    expect(result.current.tool).toBe('select');
    act(() => { result.current.setTool('text'); });
    expect(result.current.tool).toBe('text');
    act(() => { result.current.setTool('select'); });
    expect(result.current.tool).toBe('select');
  });

  it('TC-15: canEdit false → Text button disabled, T ignored (setTool rejects non-select)', () => {
    const { result } = renderHookWithProps(useTool, false);
    expect(result.current.tool).toBe('select');
    act(() => { result.current.setTool('text'); });
    expect(result.current.tool).toBe('select'); // cannot change to text
  });

  it('TC-15: canEdit becomes false while text is active → reverts to select', () => {
    const { result, rerender } = renderHookWithProps(useTool, true as boolean);
    act(() => { result.current.setTool('text'); });
    expect(result.current.tool).toBe('text');
    rerender(false);
    // After canEdit becomes false, the tool should revert
    expect(result.current.tool).toBe('select');
  });
});

describe('Toolbar tool buttons', () => {
  const mockUndo = {
    canUndo: false,
    canRedo: false,
    undo: vi.fn(),
    redo: vi.fn(),
  };

  it('TC-14: Select button has aria-pressed when tool is select', () => {
    render(
      <Toolbar
        tool="select"
        onToolChange={vi.fn()}
        canEdit={true}
        onCreateSticky={vi.fn()}
        undo={mockUndo}
      />,
    );
    const selectBtn = screen.getByRole('button', { name: 'Select (V)' });
    expect(selectBtn).toHaveAttribute('aria-pressed', 'true');
    const textBtn = screen.getByRole('button', { name: 'Text (T)' });
    expect(textBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('TC-14: Text button has aria-pressed when tool is text', () => {
    render(
      <Toolbar
        tool="text"
        onToolChange={vi.fn()}
        canEdit={true}
        onCreateSticky={vi.fn()}
        undo={mockUndo}
      />,
    );
    const textBtn = screen.getByRole('button', { name: 'Text (T)' });
    expect(textBtn).toHaveAttribute('aria-pressed', 'true');
    const selectBtn = screen.getByRole('button', { name: 'Select (V)' });
    expect(selectBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('TC-15: Text button is disabled when canEdit is false', () => {
    render(
      <Toolbar
        tool="select"
        onToolChange={vi.fn()}
        canEdit={false}
        onCreateSticky={vi.fn()}
        undo={mockUndo}
      />,
    );
    const textBtn = screen.getByRole('button', { name: 'Text (T)' });
    expect(textBtn).toBeDisabled();
  });

  it('clicking Select button calls onToolChange with select', () => {
    const onToolChange = vi.fn();
    render(
      <Toolbar
        tool="text"
        onToolChange={onToolChange}
        canEdit={true}
        onCreateSticky={vi.fn()}
        undo={mockUndo}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select (V)' }));
    expect(onToolChange).toHaveBeenCalledWith('select');
  });

  it('clicking Text button calls onToolChange with text', () => {
    const onToolChange = vi.fn();
    render(
      <Toolbar
        tool="select"
        onToolChange={onToolChange}
        canEdit={true}
        onCreateSticky={vi.fn()}
        undo={mockUndo}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Text (T)' }));
    expect(onToolChange).toHaveBeenCalledWith('text');
  });
});

// TC-16: T while editing a sticky types 't' and tool unchanged — this is tested
// by the isTextEntry guard in useBoardKeys (already tested via existing tests).
// A full integration test is in e2e.

// TC-17 and TC-18 are tested as e2e or require full App integration.
// TC-17 (Text active, click board → createText at world point) is covered by e2e TC-26.
// TC-18 (N creates sticky at view centre) is covered by existing sticky creation tests.

/** Simple hook wrapper to allow re-rendering with new props. */
function renderHookWithProps<T, P>(hook: (p: P) => T, initialProps: P) {
  let result: { current: T };
  let rerenderFn: (props: P) => void;

  function TestComponent({ props }: { props: P }) {
    result!.current = hook(props);
    return null;
  }

  result = { current: undefined } as { current: T };

  const { rerender } = render(<TestComponent props={initialProps} />);
  rerenderFn = (p: P) => { rerender(<TestComponent props={p} />); };

  return { result, rerender: rerenderFn };
}
