import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MIN_TEXT_CONTRAST, contrastRatio } from '@todoodle/shared/contrast';
import { CHIP_TONES, TOKENS, type Theme } from '@todoodle/shared/tokens';
import { describe, expect, it } from 'vitest';

// Story 8, TC-110: the chip colours that ship (parsed from tokens.css, not from the TS source) reach WCAG AA text
// contrast against the row backgrounds in light and dark: the page background and the muted surface of a hovered
// or selected row.

const css = readFileSync(path.resolve(import.meta.dirname, '../../../src/styles/tokens.css'), 'utf8');

/** The custom properties of one theme block of tokens.css: light = :root, dark = the prefers-color-scheme block. */
function themeVars(theme: Theme): Map<string, string> {
  const [light, dark] = css.split('@media (prefers-color-scheme: dark)');
  const block = theme === 'light' ? light! : dark!;
  return new Map([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{3,6});/g)].map((m) => [m[1]!, m[2]!]));
}

describe('TC-110 date chip tokens: contrast in light and dark', () => {
  it.each(['light', 'dark'] as const)('%s: every chip token is at least 4.5:1 on the row backgrounds', (theme) => {
    const vars = themeVars(theme);
    for (const tone of CHIP_TONES) {
      const colour = vars.get(`chip-${tone}`);
      expect(colour, `--chip-${tone} in ${theme}`).toBeDefined();
      for (const surface of ['background', 'muted'] as const) {
        const background = vars.get(surface)!;
        expect(background).toBe(TOKENS[theme][surface]);
        const ratio = contrastRatio(colour!, background);
        expect(ratio, `${theme} --chip-${tone} on ${surface} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      }
    }
  });

  it('defines all four tones in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(CHIP_TONES.map((tone) => themeVars(theme).has(`chip-${tone}`))).toEqual([true, true, true, true]);
    }
  });
});
