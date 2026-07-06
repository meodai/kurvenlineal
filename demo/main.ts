import {
  fitQuad,
  fitCubic,
  ease,
  elevate,
  toCSS,
  type Curve,
  type Quad,
} from "../src/index.ts";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// ---------- state ----------
interface Residual {
  x: number;
  delta: number;
  ratio: number;
}

const state = {
  data: [] as number[],       // sorted raw sizes (the "existing design system")
  degree: 3 as 2 | 3,         // 2 = quad (one handle) | 3 = cubic
  params: [1 / 3, 1 / 3, 2 / 3, 2 / 3] as number[],
  residuals: [] as Residual[], // per-point deviation from the curve, captured at refit
  offsetMode: "delta" as "delta" | "ratio" | "off",
  min: 4,
  max: 96,
  steps: 12,
};

// state.params is a mutable number[] (handles are dragged in place); the
// library takes the readonly tuple view of it
const curve = (): Curve => state.params as unknown as Curve;

function randomSizes(): void {
  const n = 8 + Math.floor(Math.random() * 7);
  const { min, max } = state;
  // random exponent + jitter → plausible messy scale
  const exp = 1.2 + Math.random() * 2.2;
  const sizes = Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const jitter = 1 + (Math.random() - 0.5) * 0.35;
    return min + (max - min) * Math.pow(t, exp) * jitter;
  });
  sizes[0] = min;
  sizes[n - 1] = max;
  state.data = sizes.sort((a, b) => a - b).map((v) => Math.round(v * 2) / 2);
  state.steps = n; // 1:1 with the data until the user resamples on purpose
  syncSteps(n);
}

// keep the range input, its readout, and the ruler marker in agreement
function syncSteps(n: number): void {
  const input = $<HTMLInputElement>("steps");
  input.value = String(n);
  $("stepsOut").textContent = String(n);
  const progress = (n - Number(input.min)) / (Number(input.max) - Number(input.min));
  (document.querySelector(".range-marker") as HTMLElement).style.setProperty(
    "--progress",
    String(progress),
  );
}

function refit(): void {
  const { data, min, max } = state;
  const xs = data.map((_, i) => i / (data.length - 1));
  const ys = data.map((v) => (v - min) / (max - min));
  state.params = state.degree === 2 ? [...fitQuad(xs, ys)] : [...fitCubic(xs, ys)];
  // freeze each point's deviation from the curve — it rides along from now on
  state.residuals = data.map((v, i) => {
    const base = min + ease(xs[i], curve()) * (max - min);
    return { x: xs[i], delta: v - base, ratio: base > 1e-6 ? v / base : 1 };
  });
}

// linear interpolation of the frozen residuals, so any step count inherits them
function residualAt(x: number): { delta: number; ratio: number } {
  const r = state.residuals;
  if (!r.length || state.offsetMode === "off") return { delta: 0, ratio: 1 };
  if (x <= r[0].x) return r[0];
  for (let i = 1; i < r.length; i++) {
    if (x <= r[i].x) {
      const t = (x - r[i - 1].x) / (r[i].x - r[i - 1].x);
      return {
        delta: r[i - 1].delta + t * (r[i].delta - r[i - 1].delta),
        ratio: r[i - 1].ratio + t * (r[i].ratio - r[i - 1].ratio),
      };
    }
  }
  return r[r.length - 1];
}

function curveSizes(n: number, raw = false): number[] {
  const { min, max, offsetMode } = state;
  return Array.from({ length: n }, (_, i) => {
    const x = i / (n - 1);
    const base = min + ease(x, curve()) * (max - min);
    if (raw) return base;
    const r = residualAt(x);
    return offsetMode === "ratio" ? base * r.ratio : base + r.delta;
  });
}

// ---------- render ----------
const ns = "http://www.w3.org/2000/svg";
const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;
const el = (
  tag: string,
  attrs: Record<string, string | number>,
  parent: Element,
): SVGElement => {
  const e = document.createElementNS(ns, tag) as SVGElement;
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  parent.appendChild(e);
  return e;
};
const fmt = (v: number): string => (Math.round(v * 100) / 100).toString();

function renderCurve(): void {
  const svg = document.getElementById("curve") as unknown as SVGSVGElement;
  svg.textContent = "";
  const X = (v: number) => v * 100;
  const Y = (v: number) => 100 - v * 100;

  el("rect", {
    x: 0, y: 0, width: 100, height: 100, fill: "none", stroke: "var(--line)",
    "stroke-width": 1, "vector-effect": "non-scaling-stroke",
  }, svg);
  for (const q of [25, 50, 75]) {
    el("line", {
      x1: q, y1: 0, x2: q, y2: 100, stroke: "var(--line)",
      "stroke-width": 1, "vector-effect": "non-scaling-stroke",
    }, svg);
    el("line", {
      x1: 0, y1: q, x2: 100, y2: q, stroke: "var(--line)",
      "stroke-width": 1, "vector-effect": "non-scaling-stroke",
    }, svg);
  }
  // data points (frozen, gold) and where they live now (ink, riding the curve)
  const { data, min, max } = state;
  const span = max - min;
  const now = curveSizes(data.length);
  data.forEach((v, i) => {
    const x = X(i / (data.length - 1));
    const y0 = Y((v - min) / span);
    const y1p = Y((now[i] - min) / span);
    if (Math.abs(y1p - y0) > 0.75)
      el("line", {
        x1: x, y1: y0, x2: x, y2: y1p,
        stroke: "var(--soft)", "stroke-width": 1, "stroke-dasharray": "1.5 1.5",
        "vector-effect": "non-scaling-stroke",
      }, svg);
  });
  data.forEach((v, i) =>
    el("circle", {
      cx: X(i / (data.length - 1)),
      cy: Y((v - min) / span),
      r: 1.6, fill: "var(--text)",
    }, svg),
  );
  now.forEach((v, i) =>
    el("circle", {
      cx: X(i / (data.length - 1)),
      cy: Y((v - min) / span),
      r: 1, fill: "var(--acryl)",
    }, svg),
  );
  // curve + arms + handles
  if (state.params.length === 2) {
    const [px, py] = state.params;
    // the acrylic ruler: a translucent band with a sharp drawn edge
    el("path", {
      d: `M0,100 Q${X(px)},${Y(py)} 100,0`,
      fill: "none", stroke: "var(--acryl-soft)", "stroke-width": 7,
      "vector-effect": "non-scaling-stroke",
    }, svg);
    el("path", {
      d: `M0,100 Q${X(px)},${Y(py)} 100,0`,
      fill: "none", stroke: "var(--acryl)", "stroke-width": 1.5,
      "vector-effect": "non-scaling-stroke",
    }, svg);
    el("line", {
      x1: 0, y1: 100, x2: X(px), y2: Y(py), stroke: "var(--soft)",
      "stroke-width": 1, "vector-effect": "non-scaling-stroke",
    }, svg);
    el("line", {
      x1: 100, y1: 0, x2: X(px), y2: Y(py), stroke: "var(--soft)",
      "stroke-width": 1, "vector-effect": "non-scaling-stroke",
    }, svg);
    el("circle", {
      cx: X(px), cy: Y(py), r: 3.4, fill: "var(--bg)", stroke: "var(--text)",
      "stroke-width": 1.5, "vector-effect": "non-scaling-stroke",
      "data-handle": 0, style: "cursor:grab",
    }, svg);
    $("curveInfo").innerHTML =
      `Q(<b>${state.params.map(fmt).join(", ")}</b>) &middot; ` +
      `&equiv; cubic-bezier(${elevate(curve() as Quad).map(fmt).join(", ")})`;
  } else {
    const [x1, y1, x2, y2] = state.params;
    // the acrylic ruler: a translucent band with a sharp drawn edge
    el("path", {
      d: `M0,100 C${X(x1)},${Y(y1)} ${X(x2)},${Y(y2)} 100,0`,
      fill: "none", stroke: "var(--acryl-soft)", "stroke-width": 7,
      "vector-effect": "non-scaling-stroke",
    }, svg);
    el("path", {
      d: `M0,100 C${X(x1)},${Y(y1)} ${X(x2)},${Y(y2)} 100,0`,
      fill: "none", stroke: "var(--acryl)", "stroke-width": 1.5,
      "vector-effect": "non-scaling-stroke",
    }, svg);
    el("line", {
      x1: 0, y1: 100, x2: X(x1), y2: Y(y1), stroke: "var(--soft)",
      "stroke-width": 1, "vector-effect": "non-scaling-stroke",
    }, svg);
    el("line", {
      x1: 100, y1: 0, x2: X(x2), y2: Y(y2), stroke: "var(--soft)",
      "stroke-width": 1, "vector-effect": "non-scaling-stroke",
    }, svg);
    ([[x1, y1, 0], [x2, y2, 1]] as const).forEach(([hx, hy, idx]) => {
      el("circle", {
        cx: X(hx), cy: Y(hy), r: 3.4, fill: "var(--bg)", stroke: "var(--text)",
        "stroke-width": 1.5, "vector-effect": "non-scaling-stroke",
        "data-handle": idx, style: "cursor:grab",
      }, svg);
    });
    $("curveInfo").innerHTML = `cubic-bezier(<b>${state.params.map(fmt).join(", ")}</b>)`;
  }
}

function renderBars(): void {
  const svg = document.getElementById("bars") as unknown as SVGSVGElement;
  svg.textContent = "";
  const { data, min, max, steps } = state;
  const H = 46;

  // actual output (curve ⊕ residual), gold
  const fitted = curveSizes(steps);
  const onCurve = curveSizes(steps, true);
  const wf = 100 / steps;
  fitted.forEach((v, i) => {
    const h = (v / max) * (H - 2);
    el("rect", {
      x: i * wf + 0.5, y: H - h, width: wf - 1, height: h,
      fill: "var(--acryl-soft)", stroke: "var(--acryl)", "stroke-width": 0.5,
      "vector-effect": "non-scaling-stroke",
    }, svg);
  });
  // where each step would land if it sat exactly on the bezier, ink outline
  onCurve.forEach((v, i) => {
    const h = (v / max) * (H - 2);
    el("rect", {
      x: i * wf + 0.5, y: H - h, width: wf - 1, height: h,
      fill: "none", stroke: "var(--text)", "stroke-width": 0.5,
      "vector-effect": "non-scaling-stroke",
    }, svg);
  });

  // one label per bar: fitted value, original struck through when counts match
  $("barLabels").innerHTML = fitted
    .map((v, i) => {
      const orig = steps === data.length ? ` <s>${fmt(data[i])}</s>` : "";
      return `<span>${Math.round(v)}${orig}</span>`;
    })
    .join("");

  // fit error only meaningful against the data points
  const xs = data.map((_, i) => i / (data.length - 1));
  let maxErr = 0;
  xs.forEach((x, i) => {
    const fit = min + ease(x, curve()) * (max - min);
    maxErr = Math.max(maxErr, Math.abs(fit - data[i]));
  });
  const monotone = fitted.every((v, i) => i === 0 || v >= fitted[i - 1]);
  $("fitInfo").innerHTML =
    `data n=<b>${data.length}</b> &middot; max fit error <b>${fmt(maxErr)}</b>` +
    (steps !== data.length ? ` &middot; resampled to <b>${steps}</b> steps` : "") +
    (state.offsetMode !== "off"
      ? ` &middot; offsets <b>${state.offsetMode === "ratio" ? "&times;ratio" : "+delta"}</b>`
      : "") +
    (monotone ? "" : ` &middot; <b style="color:var(--acryl)">non-monotone</b>`);

  const degreeArg = state.degree === 2 ? ", 2" : "";
  const offsetArg = state.offsetMode === "off" ? "" : `, "${state.offsetMode}"`;
  $("code").textContent = `import { fitScale } from "kurvenlineal";

const fit = fitScale([${data.join(", ")}]${degreeArg});

fit.css;      // "${toCSS(curve())}"
fit.sizes(${steps}${offsetArg}); // [${fitted.map((v) => Math.round(v)).join(", ")}]`;
}

function render(): void {
  renderCurve();
  renderBars();
}

// ---------- interaction ----------
$("curve").addEventListener("pointerdown", (e) => {
  const target = e.target as Element;
  const idxAttr = target.getAttribute("data-handle");
  if (idxAttr === null) return;
  const idx = Number(idxAttr);
  const svg = $("curve");
  svg.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    const r = svg.getBoundingClientRect();
    const x = clamp01((ev.clientX - r.left) / r.width);
    const y = clamp01(1 - (ev.clientY - r.top) / r.height); // y clamped → monotone scale
    state.params[idx * 2] = x;
    state.params[idx * 2 + 1] = y;
    render();
  };
  const up = () => {
    svg.removeEventListener("pointermove", move);
    svg.removeEventListener("pointerup", up);
  };
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerup", up);
});

$("randomize").addEventListener("click", () => {
  randomSizes();
  refit();
  render();
});
$("refit").addEventListener("click", () => {
  refit();
  render();
});
$<HTMLInputElement>("steps").addEventListener("input", (e) => {
  state.steps = +(e.target as HTMLInputElement).value;
  syncSteps(state.steps);
  renderBars();
});
document.querySelectorAll<HTMLInputElement>('input[name="degree"]').forEach((radio) =>
  radio.addEventListener("change", () => {
    state.degree = +radio.value as 2 | 3;
    refit();
    render();
  }),
);
document.querySelectorAll<HTMLInputElement>('input[name="offsetMode"]').forEach((radio) =>
  radio.addEventListener("change", () => {
    state.offsetMode = radio.value as "delta" | "ratio" | "off";
    render();
  }),
);
(["min", "max"] as const).forEach((id) =>
  $<HTMLInputElement>(id).addEventListener("change", () => {
    state.min = +$<HTMLInputElement>("min").value;
    state.max = +$<HTMLInputElement>("max").value;
    if (state.min >= state.max) state.min = state.max - 1;
    $<HTMLInputElement>("min").value = String(state.min);
    $<HTMLInputElement>("max").value = String(state.max);
    randomSizes();
    refit();
    render();
  }),
);
$("copy").addEventListener("click", () =>
  navigator.clipboard.writeText($("code").textContent ?? ""),
);

// go
randomSizes();
refit();
render();
