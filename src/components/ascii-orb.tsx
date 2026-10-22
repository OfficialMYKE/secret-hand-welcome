
import * as React from "react";

export type AsciiOrbState = "idle" | "listening" | "thinking" | "speaking";
export type AsciiOrbCharset = "classic" | "dense" | "binary";

export interface AsciiOrbProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "color"> {
  /** What the assistant is doing right now. */
  state?: AsciiOrbState;
  /**
   * Voice level, 0–1. Pass a number, or a function that returns the current level
   * (read every frame, no re-renders). Smoothed internally. Used while listening and speaking.
   */
  level?: number | (() => number);
  /** Character color. Use a light tint on dark backgrounds and a deep one on light backgrounds. */
  color?: string;
  /** Character ramp from dark to bright: a preset name or your own string, first char = empty. */
  charset?: AsciiOrbCharset | string;
  /** Character size in px. Smaller = denser, more detailed sphere. */
  fontSize?: number;
  /** Box size: px number or any CSS length, e.g. "min(360px, 80vw)". */
  size?: number | string;
  /** Animation speed multiplier, 1 = default. */
  speed?: number;
  /** Soft glow around the characters, 0–1. Defaults to 0.5 under `.dark` and 0 otherwise. */
  glow?: number;
  /** Monospace font stack for the characters. */
  fontFamily?: string;
}

const CHARSETS: Record<AsciiOrbCharset, string> = {
  classic: " .:-=+*#%@",
  dense: " .'`^,:;Il!i~+_-?][}{1)(|tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  binary: " ..::0101",
};

//                 breath gain  in   out  scan spin
const TARGETS: Record<AsciiOrbState, number[]> = {
  idle: [1.0, 0.0, 0.0, 0.0, 0.0, 0.1],
  listening: [0.5, 1.0, 1.0, 0.0, 0.0, 0.1],
  thinking: [0.6, 0.0, 0.0, 0.0, 1.0, 0.3],
  speaking: [0.4, 1.0, 0.0, 1.0, 0.0, 0.16],
};

const LABELS: Record<AsciiOrbState, string> = {
  idle: "Voice assistant: idle",
  listening: "Voice assistant: listening",
  thinking: "Voice assistant: thinking",
  speaking: "Voice assistant: speaking",
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (cur: number, tgt: number, k: number) => cur + (tgt - cur) * k;
function hash(i: number, j: number, k: number) {
  let x = (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * Turns a mic stream or a playing <audio>/<video> element into a 0–1 level getter
 * you can pass straight to `level`. Call `stop()` when done.
 */
export function createAudioLevel(source: MediaStream | HTMLMediaElement, ctx?: AudioContext) {
  const ac = ctx ?? new AudioContext();
  const analyser = ac.createAnalyser();
  analyser.fftSize = 1024;
  const buf = new Float32Array(analyser.fftSize);
  const node =
    source instanceof MediaStream ? ac.createMediaStreamSource(source) : ac.createMediaElementSource(source);
  node.connect(analyser);
  if (!(source instanceof MediaStream)) analyser.connect(ac.destination);
  if (ac.state === "suspended") void ac.resume();
  return {
    get: () => {
      analyser.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      return clamp01((Math.sqrt(s / buf.length) - 0.008) * 7);
    },
    stop: () => {
      try {
        node.disconnect();
        analyser.disconnect();
      } catch {}
      if (!ctx) void ac.close();
    },
  };
}

export const AsciiOrb = React.forwardRef<HTMLDivElement, AsciiOrbProps>(function AsciiOrb(
  {
    state = "idle",
    level = 0,
    color = "#a3d6ff",
    charset = "classic",
    fontSize = 11,
    size = 360,
    speed = 1,
    glow,
    fontFamily = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    className,
    style,
    ...rest
  },
  ref,
) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  React.useImperativeHandle(ref, () => rootRef.current as HTMLDivElement);

  // Latest props, read inside the animation loop without restarting it.
  const props = React.useRef({ state, level, color, charset, fontSize, speed, glow, fontFamily });
  props.current = { state, level, color, charset, fontSize, speed, glow, fontFamily };

  React.useEffect(() => {
    const root = rootRef.current;
    const cv = canvasRef.current;
    if (!root || !cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const off = document.createElement("canvas");
    const octx = off.getContext("2d");
    if (!octx) return;

    let blurOK = false;
    try {
      ctx.filter = "blur(2px)";
      blurOK = ctx.filter === "blur(2px)";
      ctx.filter = "none";
    } catch {}

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const W = TARGETS[props.current.state].slice();
    let w = 1, h = 1, dpr = 1, cw = 6, ch = 12, fontKey = "";
    let isDark = false;
    let lvl = 0;
    let phIn = 0, phOut = 0, spin = 0, breath = 0, wob = 0, scan = 0, light = 0, clock = 0;
    let last = 0, raf = 0, visible = true, checkDark = 0;

    const font = () => `${props.current.fontSize * dpr}px ${props.current.fontFamily}`;
    const measure = () => {
      octx.font = font();
      cw = octx.measureText("M").width / dpr || props.current.fontSize * 0.6;
      ch = props.current.fontSize * 1.12;
      fontKey = props.current.fontSize + props.current.fontFamily;
    };
    const resize = () => {
      const r = root.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, Math.round(r.width));
      h = Math.max(1, Math.round(r.height));
      for (const c of [cv, off]) {
        c.width = w * dpr;
        c.height = h * dpr;
      }
      measure();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(root);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    });
    io.observe(root);
    resize();
    if (document.fonts?.ready) void document.fonts.ready.then(measure);

    function frame(now: number) {
      raf = 0;
      if (!visible) return;
      const p = props.current;
      const ts = (reduce.matches ? 0.35 : 1) * Math.max(0.05, p.speed);
      let dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      dt *= ts;
      clock += dt;
      if (fontKey !== p.fontSize + p.fontFamily) measure();
      if ((checkDark -= dt) <= 0) {
        isDark = !!root!.closest(".dark");
        checkDark = 1;
      }

      // blend state weights so every switch is a smooth morph
      const T = TARGETS[p.state] ?? TARGETS.idle;
      const k = 1 - Math.exp(-(dt * 3.2) / ts);
      for (let i = 0; i < W.length; i++) W[i] = ease(W[i], T[i], k);
      const [bW, gW, inW, outW, scW, spW] = W;

      const raw = clamp01(typeof p.level === "function" ? p.level() : p.level || 0);
      lvl = ease(lvl, raw, raw > lvl ? 1 - Math.exp(-dt * 22) : 1 - Math.exp(-dt * 6));
      const L = lvl * gW;

      // integrated phases: speed changes never cause jumps
      spin += dt * spW;
      breath += dt * 1.35;
      wob += dt * (1.2 + L * 2.5);
      phOut += dt * (2.6 + L * 5);
      phIn += dt * (2.2 + L * 4);
      scan += dt * 0.55 * scW;
      light += dt * 0.12;

      const chars = (CHARSETS as Record<string, string>)[p.charset] ?? (p.charset.length > 1 ? p.charset : CHARSETS.classic);
      const nC = chars.length - 1;
      const scale = (1 + 0.032 * bW * Math.sin(breath)) * (1 + 0.075 * L);
      const R = Math.min(w, h) * 0.4 * scale;

      let lx = Math.cos(light) * 0.45 - 0.2, ly = -0.5 + Math.sin(light) * 0.12, lz = 0.78;
      const ll = Math.hypot(lx, ly, lz);
      lx /= ll; ly /= ll; lz /= ll;
      const cs = Math.cos(spin * 2.2), sn = Math.sin(spin * 2.2);
      const scanY = -1.25 + (scan % 2.5);
      const tick = Math.floor(clock * 12);

      octx!.setTransform(1, 0, 0, 1, 0, 0);
      octx!.clearRect(0, 0, off.width, off.height);
      octx!.font = font();
      octx!.textAlign = "center";
      octx!.textBaseline = "middle";
      octx!.fillStyle = p.color;

      const cols = Math.floor(w / cw), rows = Math.floor(h / ch);
      const ox = (w - cols * cw) / 2, oy = (h - rows * ch) / 2;
      const maxR = R * 1.06;

      for (let j = 0; j < rows; j++) {
        const py = oy + (j + 0.5) * ch - h / 2;
        if (Math.abs(py) > maxR) continue;
        for (let i = 0; i < cols; i++) {
          const px = ox + (i + 0.5) * cw - w / 2;
          let x = px / R, y = py / R;
          const d = Math.hypot(x, y);
          if (d > 1.06) continue;
          const a = Math.atan2(y, x);
          const edge = 1 + L * (0.026 * Math.sin(3 * a + wob) + 0.016 * Math.sin(5 * a - wob * 1.3));
          if (d >= edge) continue;
          x /= edge; y /= edge;
          const nz = Math.sqrt(Math.max(0, 1 - x * x - y * y));

          // diffuse light
          let b = 0.06 + 0.86 * Math.max(0, x * lx + y * ly + nz * lz);
          // slow surface texture that reads as rotation
          const rx = x * cs + nz * sn, rz = -x * sn + nz * cs;
          const lon = Math.atan2(rx, rz), lat = Math.asin(Math.max(-1, Math.min(1, y)));
          b += 0.06 * Math.sin(lon * 2 + Math.sin(lat * 2) * 1.2) * Math.cos(lat);
          // voice ripples: inward while listening, outward while speaking
          const dd = Math.acos(Math.min(1, nz));
          b += outW * (0.08 + 0.32 * L) * Math.sin(dd * 9 - phOut) * nz;
          b += inW * (0.06 + 0.26 * L) * Math.sin(dd * 9 + phIn) * nz;
          // thinking: a soft scan line decodes characters as it passes
          let scr = false;
          if (scW > 0.02) {
            const near = Math.exp(-Math.pow((y - scanY) / 0.13, 2)) * scW;
            b += near * 0.38;
            scr = near > 0.32;
          }
          b = clamp01(b) * Math.min(1, nz * 2.2 + 0.15); // fade toward the limb, clean edge
          const idx = Math.round(b * nC);
          if (idx <= 0) continue;
          let chr = chars[idx];
          if (scr && hash(i, j, tick) % 100 < 55) chr = chars[1 + (hash(j, i, tick) % nC)];
          octx!.globalAlpha = 0.28 + 0.72 * b;
          octx!.fillText(chr, (px + w / 2) * dpr, (py + h / 2) * dpr);
        }
      }
      octx!.globalAlpha = 1;

      const g = p.glow !== undefined ? clamp01(p.glow) : isDark ? 0.5 : 0;
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.clearRect(0, 0, cv!.width, cv!.height);
      if (g > 0 && blurOK) {
        ctx!.filter = `blur(${7 * dpr}px)`;
        ctx!.globalAlpha = Math.min(1, g * (1 + 0.6 * L));
        ctx!.drawImage(off, 0, 0);
        ctx!.filter = "none";
        ctx!.globalAlpha = 1;
      }
      ctx!.drawImage(off, 0, 0);
      raf = requestAnimationFrame(frame);
    }

    last = performance.now();
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return (
    <div
      ref={rootRef}
      role="status"
      aria-label={LABELS[state]}
      data-state={state}
      className={className}
      style={{
        position: "relative",
        flex: "none",
        width: typeof size === "number" ? `${size}px` : size,
        aspectRatio: "1",
        maxWidth: "100%",
        ...style,
      }}
      {...rest}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      />
    </div>
  );
});

export default AsciiOrb;

demo.tsx
"use client";

import * as React from "react";
import { AsciiOrb, type AsciiOrbState, type AsciiOrbCharset } from "@/components/ui/ascii-voice-orb";

// Each preset has a light tint for dark backgrounds and a deep tone for light ones.
const COLORS: Record<string, { dark: string; light: string }> = {
  Ice: { dark: "#a3d6ff", light: "#195b91" },
  Amber: { dark: "#ffc775", light: "#975700" },
  Mint: { dark: "#93f0ca", light: "#0b7652" },
  Lilac: { dark: "#c9b6ff", light: "#5a3dc2" },
  Graphite: { dark: "#eceff3", light: "#1a1d23" },
};

const SEG_BTN =
  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: React.ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <Row label={label}>
      <div role="group" aria-label={label} className="flex flex-wrap gap-0.5 rounded-lg bg-muted p-0.5">
        {options.map((o) => (
          <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)} className={SEG_BTN}>
            {o.label}
          </button>
        ))}
      </div>
    </Row>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v) => v.toFixed(2),
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="w-20 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-32 max-w-[180px] flex-1 accent-primary"
      />
      <span className="w-10 font-mono tabular-nums">{format(value)}</span>
    </label>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2.5">
      <h3 className="mb-0.5 border-b border-border pb-1.5 font-mono text-[11px] font-semibold uppercase tracking-[.12em] text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export default function AsciiOrbDemo() {
  const [state, setState] = React.useState<AsciiOrbState>("speaking");
  const [theme, setTheme] = React.useState<"dark" | "light">("dark");
  const [preset, setPreset] = React.useState("Ice");
  const [charset, setCharset] = React.useState<AsciiOrbCharset>("classic");
  const [fontSize, setFontSize] = React.useState(11);
  const [speed, setSpeed] = React.useState(1);
  const [level, setLevel] = React.useState(0);
  const [simulate, setSimulate] = React.useState(true);
  const [open, setOpen] = React.useState(true);

  // Fake voice envelope: phrases made of syllables. In a real app, feed `level` from an AnalyserNode.
  const active = state === "listening" || state === "speaking";
  React.useEffect(() => {
    if (!simulate || !active) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      const phrase = (Math.sin(t * 0.7) + 1) / 2;
      const syl = Math.max(0, Math.sin(t * 6.2)) * 0.7 + Math.max(0, Math.sin(t * 9.1 + 1)) * 0.3;
      setLevel(Math.round(phrase * syl * 100) / 100);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [simulate, active]);

  const dark = theme === "dark";
  const color = dark ? COLORS[preset].dark : COLORS[preset].light;

  return (
    <div className="flex h-full min-h-[600px] w-full flex-col overflow-hidden bg-background text-foreground">
      {/* Stage */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6 transition-colors duration-300"
        style={{ background: dark ? "#0b0d11" : "#ffffff" }}
      >
        <AsciiOrb
          state={state}
          level={level}
          color={color}
          charset={charset}
          fontSize={fontSize}
          speed={speed}
          size="min(380px, 70vw, 46vh)"
          glow={dark ? 0.5 : 0}
        />
      </div>

      {/* Controls */}
      <div className="max-h-[60vh] shrink-0 overflow-y-auto border-t border-border px-4 pb-3 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-bold">
            ASCII Voice Orb <span className="ml-2 font-mono text-[11px] font-normal text-muted-foreground">demo controls</span>
          </div>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs font-semibold transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {open ? "Hide controls" : "Show controls"}
          </button>
        </div>

        {open && (
          <div className="grid grid-cols-1 gap-x-7 gap-y-4 md:grid-cols-3">
            <Group title="Preview">
              <Segmented
                label="State"
                value={state}
                onChange={setState}
                options={[
                  { value: "idle", label: "Idle" },
                  { value: "listening", label: "Listening" },
                  { value: "thinking", label: "Thinking" },
                  { value: "speaking", label: "Speaking" },
                ]}
              />
              <Slider
                label="Voice level"
                value={level}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => {
                  setSimulate(false);
                  setLevel(v);
                }}
              />
              <label className="flex items-center gap-1.5 pl-[5.5rem] text-xs text-muted-foreground">
                <input type="checkbox" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} className="accent-primary" />
                Simulate speech
              </label>
              <Segmented
                label="Theme"
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "dark", label: <><span className="size-3 rounded-full border border-border" style={{ background: "#0b0d11" }} />Dark</> },
                  { value: "light", label: <><span className="size-3 rounded-full border border-border" style={{ background: "#ffffff" }} />Light</> },
                ]}
              />
            </Group>

            <Group title="Appearance">
              <Segmented
                label="Color"
                value={preset}
                onChange={setPreset}
                options={Object.entries(COLORS).map(([name, c]) => ({
                  value: name,
                  label: (
                    <span
                      role="img"
                      aria-label={name}
                      title={name}
                      className="block size-3.5 rounded-full border border-border"
                      style={{ background: dark ? c.dark : c.light }}
                    />
                  ),
                }))}
              />
              <Segmented
                label="Chars"
                value={charset}
                onChange={setCharset}
                options={[
                  { value: "classic", label: "Classic" },
                  { value: "dense", label: "Dense" },
                  { value: "binary", label: "Binary" },
                ]}
              />
              <Slider label="Char size" value={fontSize} min={7} max={14} step={1} onChange={setFontSize} format={(v) => `${v}px`} />
            </Group>

            <Group title="Motion">
              <Slider label="Speed" value={speed} min={0.3} max={2} step={0.1} onChange={setSpeed} format={(v) => v.toFixed(1) + "×"} />
            </Group>
          </div>
        )}
      </div>
    </div>
  );
}
```
