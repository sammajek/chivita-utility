/**
 * Prepares an HMI photo for OCR in place: greyscale, contrast stretched between the 2nd and 98th
 * brightness percentiles, and inverted when the screen is mostly dark (light text on a dark
 * background reads better as dark text on light).
 */
export function enhanceForOcr(d: Uint8ClampedArray): void {
  const n = d.length / 4;
  const grey = new Uint8ClampedArray(n);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    grey[j] = g;
    hist[g]++;
  }
  const pct = (p: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= n * p) return v;
    }
    return 255;
  };
  const lo = pct(0.02);
  const hi = Math.max(lo + 1, pct(0.98));
  const median = pct(0.5);
  const invert = median < (lo + hi) / 2;
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    let v = ((grey[j] - lo) * 255) / (hi - lo);
    v = Math.max(0, Math.min(255, v));
    if (invert) v = 255 - v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
}
