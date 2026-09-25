/**
 * Fixture files embedded as bytes for tests that run without a file system (integration tests
 * in workerd). Same content as tests/fixtures/images/shot-c.png, document-renamed.png and
 * script.svg.
 */

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** A real 400x300 PNG (shot-c.png). */
export const PNG_400x300 = fromBase64(
  'iVBORw0KGgoAAAANSUhEUgAAAZAAAAEsCAIAAABi1XKVAAAFlElEQVR42u3dsWpaURjA8S+lSyB0qLQYp0DqQxRcXX20+hYd6uZYV18jkCkRJZJH6HC2gLelnntzr9/vtzb1A+H8OVf0nKsf334FwBB88BYAggUgWIBgAQgWgGABggUgWACCBQgWgGABCBYgWACCBSBYgGABCBaAYAGCBSBYAIIFCBaAYAEIFiBYAIIFIFiAYAEIFiBYAIIFIFiAYAEIFoBgAYIFIFgAggUIFoBgAQgWIFgAggUgWIBgAQgWgGABggUgWACCBQgWgGABCBYgWACCBVBc7Q6v3gX65uf3394EBIth+HRz7U3AIyEgWACCBSBYgGABCBaAYAGCBSBYgGABCBaAYAGCBSBYAIIFCBaAYAEIFiBYAIIFIFiAYAG8p4/n/Of94egd5JSvXz57E7DDAgQLQLAABAsQLADBAhAsQLAABAsgOv6mOwzd0+7l1D9NxiNzBQt6lKr7u9tTf/Dw+NzGMs42t66r3eE1/JaQ6NdvCT/dXLddq4al+2YZV1zD2eaGz7Cgs9VbtiQNj1HmChb0pVYV13C2uYIFhK81gO1Vu5uObHMFC0CwAMECECxAsADCT3NgUJbTVfXXXGxmqebaYQEIFpDkkdBNmYAdFoBgAYIFIFgAgkVKk/GoHATcsfV8m2quYAEIFjZZNlmCBZqlWYIF1ZrV/TIu7cgzN3p1zRe0pO1rvsJFqsO8SFWwSB0sPBICCBYgWABx8cfL7A9H7yDh9CHssAAECxAsAMECECxAsAAECxAsAMECECxAsAAEC0CwAMECiEs7XgaGzpnuwzrTXbBInar7u9tTf1DumKm+jLPNjf5cQuEAP6KdA/zavoTiaffSsHTfLOOKazjb3PAZFnS2esuWpOExylzBgr7UquIazjZXsIDwtQawvWp305FtrmABCBYgWADRqy+OuikTsMMC8NMc+JvldFX9NRebWaq5dlgAggUIFoBgAYIFIFgAggUIFlyuyXhUDgLu2Hq+TTVXsAAEC5ssmyzBAs3SLMGCas3qfhmXduSZG675IlzzFS40DRepQsatlrkeCQEECxAsAMECECxAsAAEC0CwAMECECwAwQIEC0CwAAQLECwAwQIQLECwAMIRydAxZ7o70x0Gk6r7u9tTf1DumKm+jLPNDbfmEG7NOXv1NizdN8u44hrONjd8hgWdrd6yJWl4jDJXsKAvtaq4hrPNjR5+hnXOnh/ADgtqbjeqbDqyzRUsAMECBAtAsADBAgg/zYFBWU5X1V9zsZmlmmuHBSBYgGABCBYgWACCBSBYQPgeVjhxlHjvE0dbMhmPHh6f/+8Ag3Os59vFZpZnrh0WgGCRTNlkdT93Pd+mmitYoFnZmyVY5G1W98u4tCPP3HDNF+Gar3ChabhIFTJutcz1SAggWIBgAQgWgGABggUgWACCBQgWgGABCBYgWACCBSBYgGABCBaAYAGCBRCDOyK5hzdlQjhbPZzpDpeYqoZbkcsdM9WXcba50Z9bc6Albd+a87R7+ccL3B8enyuu4Wxzw2dY0NnqLVuShscocwUL+lKrims421zBAsLXGsD2qt1NR7a5ggUgWIBgAQgWIFgA4ac5MCjL6ar6ay42s1Rz7bAABAtI8ki4Pxy9g4TTh7DDAhAsQLAABAtAsEhnMh6Vg4A7tp5vU80VLADBwibLJkuwQLM0S7CgWrO6X8alHXnmRq+u+fJNd6Kdb7q3fc1XuEjVRaowxK2WuR4JAQQLECwAwQIQLECwAAQLQLAAwQIQLADBAgQLQLAAorvTGtyUCdhhAQgWIFgAggUgWIBgAQgWgGABggUgWIBgAQgWgGABggUQl3i8zP5w9A4STh/CDgtAsADBAhAsAMECBAtAsADBAhAsAMECBAtAsAAECxAsAMECECxAsAAEC0CwgAv2B1E183cSCmtDAAAAAElFTkSuQmCC',
);

/** A PDF document saved with a .png name (document-renamed.png). */
export const RENAMED_PDF = fromBase64('JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMjAwIDIwMF0+PmVuZG9iagp0cmFpbGVyPDwvUm9vdCAxIDAgUj4+CiUlRU9GCg==');

/** An SVG image carrying a script tag (script.svg). */
export const SCRIPT_SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>alert(document.domain)</script><rect width="100" height="100" fill="red"/></svg>',
);
