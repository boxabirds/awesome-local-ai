// Screenshot pixel analysis: decode a page screenshot inside the browser and
// read real rendered pixels, so grid dots can be located where the browser
// actually drew them rather than where the CSS says they should be.

import type { Page } from '@playwright/test';

/** One sampled pixel, in CSS pixel coordinates. */
export interface PixelSample {
  x: number;
  y: number;
  luminance: number;
  /** Max minus max of the RGB channels: large for the red origin marker. */
  colourSpread: number;
}

interface RawPixels {
  lum: number[];
  spread: number[];
}

const PROBE_SOURCE = `
  globalThis.__vidiProbe = function readRect(x, y, w, h) {
    const data = globalThis.__vidiShot.getImageData(x, y, w, h).data;
    const lum = [];
    const spread = [];
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      lum.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
      spread.push(Math.max(r, g, b) - Math.min(r, g, b));
    }
    return { lum, spread };
  };
`;

export class Screenshot {
  private constructor(
    private readonly probe: Page,
    /** Device pixels per CSS pixel in the captured page. */
    readonly deviceScale: number,
    /** Captured size in CSS pixels. */
    readonly width: number,
    readonly height: number,
  ) {}

  static async capture(page: Page): Promise<Screenshot> {
    const shot = await page.screenshot();
    const deviceScale = await page.evaluate(() => window.devicePixelRatio);
    const probe = await page.context().newPage();
    await probe.setContent('<!doctype html><title>pixel probe</title>');
    const size = await probe.evaluate(
      async ({ b64, source }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx === null) throw new Error('the probe page has no canvas context');
        ctx.drawImage(img, 0, 0);
        Object.defineProperty(globalThis, '__vidiShot', { value: ctx });
        (globalThis as unknown as { eval(source: string): void }).eval(source);
        return { width: img.width, height: img.height };
      },
      { b64: shot.toString('base64'), source: PROBE_SOURCE },
    );
    return new Screenshot(probe, deviceScale, size.width / deviceScale, size.height / deviceScale);
  }

  async close(): Promise<void> {
    await this.probe.close();
  }

  /** Sample a one-pixel-tall strip of the image. */
  async strip(cssY: number, cssX0: number, cssX1: number): Promise<PixelSample[]> {
    const d = this.deviceScale;
    const y = Math.round(cssY * d);
    const x0 = Math.round(cssX0 * d);
    const width = Math.max(1, Math.round((cssX1 - cssX0) * d));
    const raw = await this.readRect(x0, y, width, 1);
    return raw.lum.map((luminance, index) => ({
      x: (x0 + index) / d,
      y,
      luminance,
      colourSpread: raw.spread[index],
    }));
  }

  /**
   * CSS x positions of the dot centres along a row: runs of pixels darker than
   * the board background, with the red origin marker filtered out.
   */
  async dotCentresAlongRow(cssY: number, cssX0: number, cssX1: number): Promise<number[]> {
    const samples = (await this.strip(cssY, cssX0, cssX1)).filter((s) => s.colourSpread < 40);
    if (samples.length === 0) throw new Error(`nothing sampled along row ${cssY}`);
    const background = Math.max(...samples.map((s) => s.luminance));
    const threshold = background - 10;
    const centres: number[] = [];
    let darkest: { x: number; luminance: number } | null = null;
    for (const sample of samples) {
      if (sample.luminance < threshold) {
        if (darkest === null || sample.luminance < darkest.luminance) {
          darkest = { x: sample.x, luminance: sample.luminance };
        }
      } else if (darkest !== null) {
        centres.push(darkest.x);
        darkest = null;
      }
    }
    if (darkest !== null) centres.push(darkest.x);
    return centres;
  }

  /** The darkest neutral pixel near a point (used to track one dot). */
  async darkestNeutralNear(
    cssX: number,
    cssY: number,
    radiusCss = 4,
  ): Promise<{ x: number; y: number; luminance: number }> {
    const d = this.deviceScale;
    const radius = Math.max(1, Math.round(radiusCss * d));
    const x = Math.round(cssX * d) - radius;
    const y = Math.round(cssY * d) - radius;
    const size = radius * 2 + 1;
    const raw = await this.readRect(x, y, size, size);
    let best = { index: -1, luminance: Number.POSITIVE_INFINITY };
    raw.lum.forEach((luminance, index) => {
      if (raw.spread[index] > 40) return; // the origin marker is red
      if (luminance < best.luminance) best = { index, luminance };
    });
    if (best.index < 0) throw new Error(`no neutral pixel near (${cssX}, ${cssY})`);
    return {
      x: (x + (best.index % size)) / d,
      y: (y + Math.floor(best.index / size)) / d,
      luminance: best.luminance,
    };
  }

  private async readRect(x: number, y: number, w: number, h: number): Promise<RawPixels> {
    return this.probe.evaluate(
      ([xx, yy, ww, hh]) =>
        (globalThis as unknown as { __vidiProbe: (x: number, y: number, w: number, h: number) => RawPixels })
          .__vidiProbe(xx, yy, ww, hh),
      [x, y, w, h],
    );
  }
}
