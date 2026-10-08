import { useCallback, useRef } from 'react'
import * as Y from 'yjs'
import { LOCAL_ORIGIN } from '../../shared/board-model'
import { setTextBox, getTextContent } from '../../shared/objects/text'
import { TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_SIZES } from '../../shared/config'
import type { TextSize } from '../../shared/config'
import { layoutText } from './textLayout'
import type { Measurer } from './textLayout'

export interface TextBoxSyncResult {
  remeasureAfterLocalChange(): void
}

/**
 * Hook that remeasures the text box after local edits.
 *
 * Only writes after a LOCAL change (LOCAL_ORIGIN transaction).
 * Remote changes never trigger writes – remote clients use the stored box.
 *
 * Call `remeasureAfterLocalChange()` from:
 * - TextEditor `onInput` (after typing, before the event bubbles)
 * - TextToolbar size change handler
 * - Fixed-width handle gesture end
 */
export function useTextBoxSync(
  doc: Y.Doc,
  id: string,
  measure: Measurer,
): TextBoxSyncResult {
  // Keep id and measure in refs so the callback is stable.
  const idRef = useRef(id)
  idRef.current = id
  const measureRef = useRef(measure)
  measureRef.current = measure

  const remeasureAfterLocalChange = useCallback(() => {
    const objId = idRef.current
    const objectsMap = doc.getMap('objects') as Y.Map<Y.Map<unknown>>
    const ymap = objectsMap.get(objId)
    if (!ymap || ymap.get('type') !== 'text') return

    const ytext = ymap.get('text')
    if (!(ytext instanceof Y.Text)) return

    const text = ytext.toString()
    const size = (ymap.get('size') as TextSize) ?? 'M'
    const widthMode = (ymap.get('widthMode') as 'auto' | 'fixed') ?? 'auto'
    const fixedW = widthMode === 'fixed' ? (ymap.get('width') as number) : null

    const { width, height } = layoutText(text, size, widthMode, fixedW, measureRef.current)

    // Only write if the box has changed (avoid redundant transactions).
    const curW = ymap.get('width') as number
    const curH = ymap.get('height') as number
    if (curW !== width || curH !== height) {
      doc.transact(() => {
        ymap.set('width', width)
        ymap.set('height', height)
      }, LOCAL_ORIGIN)
    }
  }, [doc]) // stable: doc never changes for a given TextObject

  return { remeasureAfterLocalChange }
}