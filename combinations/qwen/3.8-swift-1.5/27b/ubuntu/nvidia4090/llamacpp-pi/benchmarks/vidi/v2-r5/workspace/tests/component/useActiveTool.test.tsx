// @vitest-environment jsdom
// tests/component/useActiveTool.test.tsx
// TC-22: S then create, L then create → Select active; S then Escape, L then Escape → Select active and nothing created

import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup, act, fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import { useActiveTool } from '../../src/client/tools/useActiveTool';

beforeEach(() => {
  cleanup();
});

function ToolHarness() {
  const { tool, shapeKind, toolCreated } = useActiveTool();
  const [createdCount, setCreatedCount] = useState(0);

  return (
    <div>
      <div data-testid="current-tool">{tool}</div>
      <div data-testid="shape-kind">{shapeKind}</div>
      <div data-testid="created-count">{createdCount}</div>
      <button
        data-testid="btn-create"
        onClick={() => {
          toolCreated('new-id');
          setCreatedCount(c => c + 1);
        }}
      >
        create
      </button>
    </div>
  );
}

describe('TC-22: Active tool shortcuts and return-to-select', () => {
  it('S key activates shape tool', () => {
    render(<ToolHarness />);
    expect(screen.getByTestId('current-tool').textContent).toBe('select');

    act(() => {
      fireEvent.keyDown(window, { key: 's' });
    });

    expect(screen.getByTestId('current-tool').textContent).toBe('shape');
  });

  it('L key activates connector tool', () => {
    render(<ToolHarness />);

    act(() => {
      fireEvent.keyDown(window, { key: 'l' });
    });

    expect(screen.getByTestId('current-tool').textContent).toBe('connector');
  });

  it('after creating with shape tool, returns to select', () => {
    render(<ToolHarness />);

    // Activate shape tool
    act(() => {
      fireEvent.keyDown(window, { key: 's' });
    });
    expect(screen.getByTestId('current-tool').textContent).toBe('shape');

    // Create something
    act(() => {
      fireEvent.click(screen.getByTestId('btn-create'));
    });

    // Should be back to select
    expect(screen.getByTestId('current-tool').textContent).toBe('select');
    expect(screen.getByTestId('created-count').textContent).toBe('1');
  });

  it('after creating with connector tool, returns to select', () => {
    render(<ToolHarness />);

    // Activate connector tool
    act(() => {
      fireEvent.keyDown(window, { key: 'l' });
    });
    expect(screen.getByTestId('current-tool').textContent).toBe('connector');

    // Create something
    act(() => {
      fireEvent.click(screen.getByTestId('btn-create'));
    });

    // Should be back to select
    expect(screen.getByTestId('current-tool').textContent).toBe('select');
    expect(screen.getByTestId('created-count').textContent).toBe('1');
  });

  it('Escape from shape tool → select, nothing created', () => {
    render(<ToolHarness />);

    // Activate shape tool
    act(() => {
      fireEvent.keyDown(window, { key: 's' });
    });
    expect(screen.getByTestId('current-tool').textContent).toBe('shape');

    // Press Escape
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    expect(screen.getByTestId('current-tool').textContent).toBe('select');
    expect(screen.getByTestId('created-count').textContent).toBe('0');
  });

  it('Escape from connector tool → select, nothing created', () => {
    render(<ToolHarness />);

    // Activate connector tool
    act(() => {
      fireEvent.keyDown(window, { key: 'l' });
    });
    expect(screen.getByTestId('current-tool').textContent).toBe('connector');

    // Press Escape
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    expect(screen.getByTestId('current-tool').textContent).toBe('select');
    expect(screen.getByTestId('created-count').textContent).toBe('0');
  });

  it('V key activates select tool', () => {
    render(<ToolHarness />);

    // Activate shape tool first
    act(() => {
      fireEvent.keyDown(window, { key: 's' });
    });

    // Press V
    act(() => {
      fireEvent.keyDown(window, { key: 'v' });
    });

    expect(screen.getByTestId('current-tool').textContent).toBe('select');
  });
});
