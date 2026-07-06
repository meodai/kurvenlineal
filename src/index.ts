/**
 * kurvenlineal — fit an easing curve to an existing size scale.
 *
 * Takes a list of sizes (an existing, possibly messy design-system scale),
 * fits a bezier easing with fixed endpoints (0,0)→(1,1) — quadratic (one
 * control point) or cubic (two) — and hands back the curve plus tools to
 * evaluate and resample it. Per-point residuals are captured so a resampled
 * scale can carry the original deviations along (+delta or ×ratio).
 */

export type Quad = [px: number, py: number];
export type Cubic = [x1: number, y1: number, x2: number, y2: number];
export type Curve = Quad | Cubic;
export type Degree = 2 | 3;
export type OffsetMode = "delta" | "ratio" | "off";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** one axis of a quadratic bezier at t, endpoints fixed at 0 and 1 — pass the control's x for x(t), its y for y(t) */
export const bernstein2 = (t: number, a: number): number =>
  2 * t * (1 - t) * a + t * t;

/** one axis of a cubic bezier at t, endpoints fixed at 0 and 1 */
export const bernstein3 = (t: number, a1: number, a2: number): number =>
  3 * t * (1 - t) ** 2 * a1 + 3 * t * t * (1 - t) * a2 + t ** 3;

const dcb = (t: number, a1: number, a2: number) =>
  3 * (1 - t) ** 2 * a1 + 6 * t * (1 - t) * (a2 - a1) + 3 * t * t * (1 - a2);

/** invert x(t) = x for a quadratic — closed form */
export const solveT2 = (x: number, px: number): number => {
  const k = 1 - 2 * px;
  if (Math.abs(k) < 1e-9) return x;
  return clamp01((-px + Math.sqrt(px * px + k * x)) / k);
};

/** invert x(t) = x for a cubic — newton with bisection fallback (x(t) is monotone for x1,x2 ∈ [0,1]) */
export const solveT3 = (x: number, x1: number, x2: number): number => {
  let t = x;
  for (let i = 0; i < 12; i++) {
    const err = bernstein3(t, x1, x2) - x;
    if (Math.abs(err) < 1e-12) return t;
    const slope = dcb(t, x1, x2);
    if (Math.abs(slope) < 1e-9) break;
    t = clamp01(t - err / slope);
  }
  if (Math.abs(bernstein3(t, x1, x2) - x) < 1e-6) return t;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 32; i++) {
    t = (lo + hi) / 2;
    if (bernstein3(t, x1, x2) < x) lo = t;
    else hi = t;
  }
  return t;
};

/** evaluate the easing y(x) for x ∈ [0,1] */
export const ease = (x: number, curve: Curve): number =>
  curve.length === 2
    ? bernstein2(solveT2(clamp01(x), curve[0]), curve[1])
    : bernstein3(solveT3(clamp01(x), curve[0], curve[2]), curve[1], curve[3]);

/** exact degree elevation: quad Q → cubic (⅔Q, ⅓ + ⅔Q) */
export const elevate = ([px, py]: Quad): Cubic => [
  (2 * px) / 3,
  (2 * py) / 3,
  (1 + 2 * px) / 3,
  (1 + 2 * py) / 3,
];

/** css timing function — quads are elevated so the string is always valid css */
export const toCSS = (curve: Curve): string => {
  const c = curve.length === 2 ? elevate(curve) : curve;
  return `cubic-bezier(${c.map((v) => Math.round(v * 1000) / 1000).join(", ")})`;
};

/**
 * fit a quadratic easing to normalized points.
 * x(t) is quadratic, so t(x, px) is closed form and — for fixed px — the
 * optimal py is a single division. that collapses the fit to a 1-D search
 * over px, refined over a shrinking grid. (a joint alternating solve has a
 * degenerate fixed point at the identity px = 0.5 and never moves.)
 */
export function fitQuad(xs: readonly number[], ys: readonly number[]): Quad {
  const evalPx = (px: number) => {
    const ts = xs.map((x) => solveT2(x, px));
    let a = 0;
    let ry = 0;
    for (let i = 0; i < ts.length; i++) {
      const c = 2 * ts[i] * (1 - ts[i]);
      a += c * c;
      ry += c * (ys[i] - ts[i] * ts[i]);
    }
    const py = a > 1e-12 ? clamp01(ry / a) : 0.5;
    let sse = 0;
    for (let i = 0; i < ts.length; i++) sse += (bernstein2(ts[i], py) - ys[i]) ** 2;
    return { py, sse };
  };
  let lo = 0;
  let hi = 1;
  let best = { px: 0.5, ...evalPx(0.5) };
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i <= 20; i++) {
      const px = lo + ((hi - lo) * i) / 20;
      const r = evalPx(px);
      if (r.sse < best.sse) best = { px, ...r };
    }
    const w = (hi - lo) / 10;
    lo = Math.max(0, best.px - w);
    hi = Math.min(1, best.px + w);
  }
  return [best.px, best.py];
}

/**
 * fit a cubic easing to normalized points: alternating linear least squares
 * on the control points with newton reparametrization of t against x.
 * control coordinates are clamped to [0,1] — x for validity, y so the
 * resulting scale stays monotone.
 *
 * the alternating solve has a fixed point at the identity x-parametrization
 * (x-handles at thirds), which confines it to polynomial y(x). since every
 * quadratic is a cubic, we also run the solve seeded from the elevated quad
 * fit and keep whichever candidate has the lowest max error — so the cubic can
 * never fit worse than the quad.
 */
export function fitCubic(
  xs: readonly number[],
  ys: readonly number[],
  iterations = 10,
): Cubic {
  const solve = (t0: readonly number[]): Cubic => {
    const t = t0.slice();
    let p1: [number, number] = [1 / 3, 1 / 3];
    let p2: [number, number] = [2 / 3, 2 / 3];
    for (let iter = 0; iter < iterations; iter++) {
      let a11 = 0, a12 = 0, a22 = 0, rx1 = 0, rx2 = 0, ry1 = 0, ry2 = 0;
      for (let i = 0; i < t.length; i++) {
        const ti = t[i];
        const c1 = 3 * ti * (1 - ti) ** 2;
        const c2 = 3 * ti * ti * (1 - ti);
        const c3 = ti ** 3;
        a11 += c1 * c1;
        a12 += c1 * c2;
        a22 += c2 * c2;
        rx1 += c1 * (xs[i] - c3);
        rx2 += c2 * (xs[i] - c3);
        ry1 += c1 * (ys[i] - c3);
        ry2 += c2 * (ys[i] - c3);
      }
      const det = a11 * a22 - a12 * a12;
      if (Math.abs(det) < 1e-12) break;
      p1 = [clamp01((rx1 * a22 - rx2 * a12) / det), clamp01((ry1 * a22 - ry2 * a12) / det)];
      p2 = [clamp01((rx2 * a11 - rx1 * a12) / det), clamp01((ry2 * a11 - ry1 * a12) / det)];
      for (let i = 0; i < t.length; i++) {
        for (let k = 0; k < 4; k++) {
          const err = bernstein3(t[i], p1[0], p2[0]) - xs[i];
          const slope = dcb(t[i], p1[0], p2[0]);
          if (Math.abs(slope) < 1e-9) break;
          t[i] = clamp01(t[i] - err / slope);
        }
      }
    }
    return [p1[0], p1[1], p2[0], p2[1]];
  };

  // select by max error — the metric ScaleFit reports — so toggling to
  // degree 3 can never show a worse fit than degree 2
  const maxErr = (c: Cubic) =>
    xs.reduce((m, x, i) => Math.max(m, Math.abs(ease(x, c) - ys[i])), 0);

  const quad = fitQuad(xs, ys);
  const candidates: Cubic[] = [
    solve(xs),
    elevate(quad),
    solve(xs.map((x) => solveT2(x, quad[0]))),
  ];
  return candidates.reduce((a, b) => (maxErr(b) < maxErr(a) ? b : a));
}

export interface ScaleFit<C extends Curve = Curve> {
  /** fitted control point(s): [px, py] or [x1, y1, x2, y2] */
  curve: C;
  min: number;
  max: number;
  /** sorted input values */
  data: number[];
  /** data[i] minus the curve's value at that position, in input units */
  residuals: number[];
  /** max |residual| — how well the curve fits, in input units */
  maxError: number;
  /** normalized easing y(x), x ∈ [0,1] */
  ease: (x: number) => number;
  /** curve value in input units at x ∈ [0,1] */
  at: (x: number) => number;
  /** resample the scale to n steps; offsets carry the frozen residuals along */
  sizes: (n: number, offsets?: OffsetMode) => number[];
  /** css timing function (quads elevated to cubic) */
  css: string;
}

export function fitScale(values: readonly number[], degree: 2): ScaleFit<Quad>;
export function fitScale(values: readonly number[], degree?: 3): ScaleFit<Cubic>;
export function fitScale(values: readonly number[], degree: Degree = 3): ScaleFit {
  if (values.length < 3) throw new RangeError("fitScale needs at least 3 values");
  if (values.some((v) => !Number.isFinite(v)))
    throw new TypeError("fitScale needs finite numbers");

  const data = values.slice().sort((a, b) => a - b);
  const min = data[0];
  const max = data[data.length - 1];
  if (min === max) throw new RangeError("fitScale needs at least two distinct values");
  const span = max - min;

  const xs = data.map((_, i) => i / (data.length - 1));
  const ys = data.map((v) => (v - min) / span);
  const curve: Curve = degree === 2 ? fitQuad(xs, ys) : fitCubic(xs, ys);

  const easeAt = (x: number) => ease(x, curve);
  const at = (x: number) => min + easeAt(x) * span;

  const residuals = data.map((v, i) => v - at(xs[i]));
  const ratios = data.map((v, i) => {
    const base = at(xs[i]);
    return Math.abs(base) > 1e-9 ? v / base : 1;
  });
  const maxError = residuals.reduce((m, r) => Math.max(m, Math.abs(r)), 0);

  // linear interpolation of the frozen residuals, so any step count inherits them
  const lerpAt = (arr: readonly number[], x: number): number => {
    if (x <= xs[0]) return arr[0];
    for (let i = 1; i < xs.length; i++) {
      if (x <= xs[i]) {
        const t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
        return arr[i - 1] + t * (arr[i] - arr[i - 1]);
      }
    }
    return arr[arr.length - 1];
  };

  const sizes = (n: number, offsets: OffsetMode = "off"): number[] => {
    if (n < 2) throw new RangeError("sizes needs n >= 2");
    return Array.from({ length: n }, (_, i) => {
      const x = i / (n - 1);
      const base = at(x);
      if (offsets === "delta") return base + lerpAt(residuals, x);
      if (offsets === "ratio") return base * lerpAt(ratios, x);
      return base;
    });
  };

  return { curve, min, max, data, residuals, maxError, ease: easeAt, at, sizes, css: toCSS(curve) };
}
