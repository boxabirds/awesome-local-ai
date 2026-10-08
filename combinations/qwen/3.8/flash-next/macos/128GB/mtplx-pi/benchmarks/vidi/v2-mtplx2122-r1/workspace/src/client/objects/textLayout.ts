import { TEXT_LINE_HEIGHT, TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_SIZES } from '../../shared/config'
import type { TextSize } from '../../shared/config'

/** Measures text width in world units at a given font size. */
export type Measurer = (text: string, fontPx: number) => number

/**
 * Create a Measurer that uses a canvas 2D context.
 * Falls back to a character-count estimate when canvas is unavailable (jsdom).
 */
export function createCanvasMeasurer(
  fontFamily?: string,
): Measurer {
  let canvas: HTMLCanvasElement | null = null
  try {
    canvas = document.createElement('canvas')
  } catch { /* jsdom */ }

  const ctx = canvas?.getContext?.('2d') ?? null

  if (!ctx) {
    // Fallback: rough estimate (average glyph ≈ 0.55 px at 1px size).
    const ESTIMATE_FACTOR = 0.55
    return (text: string, fontPx: number) => text.length * fontPx * ESTIMATE_FACTOR
  }

  const family = fontFamily ?? 'Inter, system-ui, sans-serif'

  return (text: string, fontPx: number) => {
    ctx.font = `${fontPx}px ${family}`
    return ctx.measureText(text).width
  }
}

/**
 * Pure text-layout function.
 *
 * Returns `{ width, height, lines }` where `lines` are the wrapped display
 * lines after applying the layout rules.
 *
 * - auto mode: box width = min(longest UNWRAPPED line measured width, TEXT_MAX_AUTO_WIDTH_WORLD);
 *   any line wider than that is greedy word-wrapped within that width.
 * - fixed mode: width = fixedWidth; lines wrap at that width.
 * - Height = number of wrapped lines × TEXT_SIZES[size] × TEXT_LINE_HEIGHT.
 *
 * Explicit newlines ("\n") are always respected.
 */
export function layoutText(
  text: string,
  size: TextSize,
  mode: 'auto' | 'fixed',
  fixedWidth: number | null,
  measure: Measurer,
): { width: number; height: number; lines: string[] } {
  const fontPx = TEXT_SIZES[size]

  // Split by explicit newlines first.
  const rawLines = text.length === 0 ? [''] : text.split('\n')

  const maxW = mode === 'fixed' && fixedWidth !== null
    ? Math.max(0, fixedWidth)
    : TEXT_MAX_AUTO_WIDTH_WORLD

  // For height, measure longest UNWRAPPED raw line width first (for auto mode).
  let longestRaw = 0
  for (const raw of rawLines) {
    const w = measure(raw, fontPx)
    if (w > longestRaw) longestRaw = w
  }

  // Word-wrap each raw line to maxW.
  const wrappedLines: string[] = []
  for (const raw of rawLines) {
    if (raw.length === 0) {
      wrappedLines.push('')
      continue
    }
    const lineW = measure(raw, fontPx)
    if (lineW <= maxW) {
      wrappedLines.push(raw)
    } else {
      // Greedy word-wrap: break at spaces.
      const words = raw.split(' ')
      let current = ''
      for (const word of words) {
        if (current.length === 0) {
          current = word
        } else {
          const trial = current + ' ' + word
          if (measure(trial, fontPx) <= maxW) {
            current = trial
          } else {
            if (current.length > 0) wrappedLines.push(current)
            current = word
          }
        }
      }
      if (current.length > 0) wrappedLines.push(current)
    }
  }

  // Width: auto mode caps the longest raw line width at TEXT_MAX_AUTO_WIDTH_WORLD.
  // Fixed mode uses the given fixedWidth.
  let width: number
  if (mode === 'fixed' && fixedWidth !== null) {
    width = fixedWidth
  } else {
    width = Math.min(longestRaw, TEXT_MAX_AUTO_WIDTH_WORLD)
    // Minimum 1 px for visibility even with empty content.
    width = Math.max(width, 1)
  }

  const height = wrappedLines.length * fontPx * TEXT_LINE_HEIGHT

  return { width, height, lines: wrappedLines }
}