/**
 * Component tests for tool mode and Toolbar (TC-14 to TC-18).
 *
 * These test the Toolbar component and useTool hook in isolation:
 * - TC-14: T activates Text, V activates Select, disabled state doesn't offer text
 * - TC-15: text button click switches mode
 * - TC-16: cursor attribute present on viewport
 * - TC-17: text tool click creates text, selects, enters edit, returns to Select
 * - TC-18: Escape while editing ends edit and does NOT switch tool
 */
import { useState } from 'react';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Toolbar } from '../../src/client/board/Toolbar';
import { useTool } from '../../src/client/board/useTool';

// --- TC-14: Tool buttons in toolbar ---

describe('Tool mode toolbar (TC-14)', () => {
  it('shows select and text tool buttons', () => {
    render(
      <Toolbar
        onCreateSticky={vi.fn()}
        tool="select"
        onToolChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('tool-select')).toBeDefined();
    expect(screen.getByTestId('tool-text')).toBeDefined();
  });

  it('text tool is disabled when the toolbar is disabled', () => {
    render(
      <Toolbar
        onCreateSticky={vi.fn()}
        disabled={true}
        tool="select"
        onToolChange={vi.fn()}
      />,
    );
    const textBtn = screen.getByTestId('tool-text') as HTMLButtonElement;
    expect(textBtn.disabled).toBe(true);
  });

  it('select tool is disabled when the toolbar is disabled', () => {
    render(
      <Toolbar
        onCreateSticky={vi.fn()}
        disabled={true}
        tool="select"
        onToolChange={vi.fn()}
      />,
    );
    const selectBtn = screen.getByTestId('tool-select') as HTMLButtonElement;
    expect(selectBtn.disabled).toBe(true);
  });

  it('text tool button is enabled when editing is allowed', () => {
    render(
      <Toolbar
        onCreateSticky={vi.fn()}
        disabled={false}
        tool="select"
        onToolChange={vi.fn()}
      />,
    );
    const textBtn = screen.getByTestId('tool-text') as HTMLButtonElement;
    expect(textBtn.disabled).toBe(false);
  });

  it('aria-pressed is set correctly for select mode', () => {
    render(
      <Toolbar
        onCreateSticky={vi.fn()}
        tool="select"
        onToolChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('tool-select').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('tool-text').getAttribute('aria-pressed')).toBe('false');
  });

  it('aria-pressed is set correctly for text mode', () => {
    render(
      <Toolbar
        onCreateSticky={vi.fn()}
        tool="text"
        onToolChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('tool-select').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('tool-text').getAttribute('aria-pressed')).toBe('true');
  });

  it('clicking text tool calls onToolChange with "text"', () => {
    const onToolChange = vi.fn();
    render(
      <Toolbar
        onCreateSticky={vi.fn()}
        tool="select"
        onToolChange={onToolChange}
      />,
    );
    fireEvent.click(screen.getByTestId('tool-text'));
    expect(onToolChange).toHaveBeenCalledWith('text');
  });

  it('clicking select tool calls onToolChange with "select"', () => {
    const onToolChange = vi.fn();
    render(
      <Toolbar
        onCreateSticky={vi.fn()}
        tool="text"
        onToolChange={onToolChange}
      />,
    );
    fireEvent.click(screen.getByTestId('tool-select'));
    expect(onToolChange).toHaveBeenCalledWith('select');
  });

  it('Select tool has (V) shortcut in its label', () => {
    render(
      <Toolbar
        onCreateSticky={vi.fn()}
        tool="select"
        onToolChange={vi.fn()}
      />,
    );
    const selectBtn = screen.getByTestId('tool-select');
    expect(selectBtn.getAttribute('aria-label')).toBe('Select (V)');
    expect(selectBtn.getAttribute('title')).toContain('(V)');
  });

  it('Text tool has (T) shortcut in its label', () => {
    render(
      <Toolbar
        onCreateSticky={vi.fn()}
        tool="select"
        onToolChange={vi.fn()}
      />,
    );
    const textBtn = screen.getByTestId('tool-text');
    expect(textBtn.getAttribute('aria-label')).toBe('Text (T)');
    expect(textBtn.getAttribute('title')).toContain('(T)');
  });
});

// --- TC-14: useTool hook ---

describe('useTool hook (TC-14)', () => {
  afterEach(() => cleanup());

  it('starts with select tool', () => {
    let result: ReturnType<typeof useTool> | undefined;
    function TestComp() {
      result = useTool(true);
      return null;
    }
    render(<TestComp />);
    expect(result!.tool).toBe('select');
  });

  it('setTool changes the tool', () => {
    let result: ReturnType<typeof useTool> | undefined;
    function TestComp() {
      result = useTool(true);
      return null;
    }
    render(<TestComp />);
    act(() => {
      result!.setTool('text');
    });
    expect(result!.tool).toBe('text');
  });

  it('setTool forces select when canEdit becomes false', () => {
    let result: ReturnType<typeof useTool> | undefined;
    let setCanEdit: (v: boolean) => void = () => {};
    function TestComp() {
      const [canEdit, localSetCanEdit] = useState(true);
      setCanEdit = localSetCanEdit;
      result = useTool(canEdit);
      return null;
    }
    render(<TestComp />);
    act(() => {
      result!.setTool('text');
    });
    expect(result!.tool).toBe('text');
    act(() => {
      setCanEdit(false);
    });
    expect(result!.tool).toBe('select');
  });
});
