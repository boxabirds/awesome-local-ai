import { MOBILE_BREAKPOINT_PX } from '@todoodle/shared/limits';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NARROW_QUERY } from '@/features/workspace/useIsNarrow';
import { renderConstantsCss } from '../../../scripts/build-tokens.ts';

describe('shared constants in CSS', () => {
  it('the committed constants.css matches limits.ts (run `bun run tokens` after changing a constant)', () => {
    const committed = readFileSync(path.join(import.meta.dirname, '../../../src/styles/constants.css'), 'utf8');
    expect(committed).toBe(renderConstantsCss());
  });

  it('the phone layout query sits just under MOBILE_BREAKPOINT_PX, which is Tailwind md (48rem)', () => {
    expect(NARROW_QUERY).toBe('(max-width: 767.98px)');
    expect(MOBILE_BREAKPOINT_PX).toBe(48 * 16);
  });
});
