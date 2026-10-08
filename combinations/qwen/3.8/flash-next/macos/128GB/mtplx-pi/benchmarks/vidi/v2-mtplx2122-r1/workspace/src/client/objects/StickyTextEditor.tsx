import React, { useCallback, useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config'
import { clampToLimit, applyTextDiff, counterVisible, fitFontSize } from './StickyText'

export interface StickyTextEditorProps {
  ytext: Y.Text
  fontPx: number
  box: number
  onEnd(next: 'selected' | 'unselected'): void
}

/**
 * Uncontrolled textarea.  The initial value is set once on mount.  Each
 * `input` event (skipped during IME composition; handled on `compositionEnd`)
 * clamps the value, writes to Y.Text with a minimal diff, and re-runs font
 * sizing.  Escape ends editing as 'selected'; blur ends editing as
 * 'unselected' (flushing any pending value first).
 *
 * The component does NOT subscribe to ytext changes from outside (story 3
 * will add that).  Local typing always overwrites via the diff.
 */
export function StickyTextEditor({ ytext, fontPx, box, onEnd }: StickyTextEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const measRef = useRef<HTMLDivElement>(null)
  const [font, setFont] = useState(fontPx)
  const [overflow, setOverflow] = useState(false)
  const composingRef = useRef(false)

  // Counter display – tracks the current char count so React re-renders
  // when the counter appears/disappears.
  const [displayLen, setDisplayLen] = useState(0)

  // Keep onEnd in a ref so the stable callbacks below never become stale.
  const onEndRef = useRef(onEnd)
  onEndRef.current = onEnd

  // ── helpers ────────────────────────────────────────────────────────────────

  const updateFont = useCallback((text: string) => {
    const meas = measRef.current
    if (!meas) return
    meas.textContent = text || '\u00A0'
    const { fontPx: fp, overflow: of } = fitFontSize(meas, box)
    setFont(prev => prev === fp ? prev : fp)
    setOverflow(prev => prev === of ? prev : of)
  }, [box])

  const applyValue = useCallback(() => {
    const ta = taRef.current
    if (!ta) return

    const raw = ta.value
    const next = clampToLimit(raw)
    if (next !== raw) {
      ta.value = next
      ta.setSelectionRange(next.length, next.length)
    }

    // Apply to Y.Text with minimal diff.
    applyTextDiff(ytext, next, null)

    // Update counter + font.
    setDisplayLen(next.length)
    updateFont(next)
  }, [ytext, updateFont])

  // ── mount ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    const initial = ytext.toString()
    ta.value = initial
    setDisplayLen(initial.length)
    ta.focus()
    ta.setSelectionRange(initial.length, initial.length)
    updateFont(initial)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── event handlers ─────────────────────────────────────────────────────────

  const handleInput = useCallback(() => {
    if (composingRef.current) return
    applyValue()
  }, [applyValue])

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false
    applyValue()
  }, [applyValue])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      applyValue()
      onEndRef.current('selected')
    }
    // Enter inside textarea inserts a newline; no special handling.
  }, [applyValue])

  const handleBlur = useCallback((e: React.FocusEvent<HTMLTextAreaElement>) => {
    // Skip blur when focus moves within the same note (e.g. NoteToolbar
    // buttons, which are hidden while editing so normally N/A).
    const related = e.relatedTarget as HTMLElement | null
    if (related) {
      const note = taRef.current?.closest('[data-testid="sticky-note"]')
      if (note && note.contains(related)) return
    }
    applyValue()
    onEndRef.current('unselected')
  }, [applyValue])

  // ── render ─────────────────────────────────────────────────────────────────

  const showCounter = counterVisible(displayLen)

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/*
        Hidden measurement div.  Height is set large (1000px) so scrollHeight
        reflects the true content height.  fitFontSize mutates fontSize and
        reads scrollHeight; this div mirrors the textarea content exactly.
      */}
      <div
        ref={measRef}
        aria-hidden="true"
        data-testid="text-measurement"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '1000px',
          overflow: 'hidden',
          visibility: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: font + 'px',
          lineHeight: 1.25,
          pointerEvents: 'none',
        }}
      />
      <textarea
        ref={taRef}
        data-testid="sticky-textarea"
        aria-label="Sticky note text"
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
          padding: 0,
          margin: 0,
          fontSize: font + 'px',
          lineHeight: 1.25,
          overflow: overflow ? 'hidden' : 'auto',
          fontFamily: 'inherit',
        }}
        onInput={handleInput}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onPointerDown={e => { e.stopPropagation() }}
      />
      {showCounter && (
        <div
          data-testid="char-counter"
          aria-label="Character count"
          style={{
            position: 'absolute',
            bottom: 2,
            right: 4,
            fontSize: 10,
            opacity: 0.7,
            pointerEvents: 'none',
          }}
        >
          {displayLen}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </div>
  )
}
