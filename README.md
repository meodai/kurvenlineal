# kurvenlineal

Fit a bezier easing to an existing size scale. Hand it the sizes you already
have — type scale, spacing scale, whatever — and it returns the curve that owns
them, as a quadratic (one control point) or cubic (two). Endpoints are fixed at
(0,0)→(1,1); control y is clamped so the scale stays monotone.

No dependencies. ESM.

```ts
import { fitScale } from "kurvenlineal";

const fit = fitScale([4, 5, 7, 10, 14.5, 20, 28, 40, 57, 96], 2);

fit.curve;         // [0.882, 0.071]           one control point (degree 2)
fit.css;           // "cubic-bezier(0.588, 0.048, 0.922, 0.381)"  (exact elevation)
fit.maxError;      // 0.46                      worst deviation, input units
fit.sizes(6);      // [4, 7, 12, 23, 42, 96]    resample onto the curve
fit.at(0.5);       // curve value at the midpoint, input units
fit.ease(0.5);     // same, normalized 0..1

const cubic = fitScale([4, 5, 7, 10, 14.5, 20, 28, 40, 57, 96]); // degree 3 default
cubic.curve;       // [x1, y1, x2, y2]
```

## carrying the mess along

The fit freezes each input value's deviation from the curve. `sizes(n, mode)`
can re-apply those deviations to any step count, linearly interpolated:

```ts
fit.sizes(12, "delta"); // curve + interpolated absolute offsets
fit.sizes(12, "ratio"); // curve × interpolated relative offsets
fit.sizes(12);          // pure curve ("off")
```

At `n === data.length`, `"delta"` reproduces the input exactly.

## low-level

`fitQuad(xs, ys)` / `fitCubic(xs, ys)` fit normalized points (both axes 0..1,
endpoints included). `ease(x, curve)` evaluates either degree. `elevate(quad)`
is the exact degree elevation `(⅔Q, ⅓ + ⅔Q)`; `toCSS(curve)` always emits a
valid `cubic-bezier()`.

## fitting notes

- **Degree 2**: `x(t)` is quadratic, so `t(x)` has a closed form and for any
  fixed `px` the optimal `py` is one division. The fit is a 1-D search over
  `px` on a shrinking grid — globally robust. (The obvious alternating solve
  has a degenerate fixed point at the identity `px = 0.5` and never moves.)
- **Degree 3**: alternating least squares with Newton reparametrization. Its
  identity fixed point confines it to polynomial `y(x)`, so the solve is also
  run seeded from the elevated quad fit and the best candidate wins — the
  cubic can never fit worse than the quad.

MIT
