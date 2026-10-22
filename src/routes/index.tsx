import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AsciiOrb, type AsciiOrbState } from "@/components/ascii-orb";
import { beep, speak, vibrate } from "@/lib/fx";
import { fillTemplate, loadConfig, saveConfig, type Participant, type ScannerConfig, defaultConfig } from "@/lib/scanner-config";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Escáner Biométrico — Acceso" },
      { name: "description", content: "Escáner de mano con IA para escape room." },
      { property: "og:title", content: "Escáner Biométrico — Acceso" },
      { property: "og:description", content: "Coloca tu mano para verificar tu identidad." },
    ],
  }),
  component: Scanner,
});

type Phase = "idle" | "scanning" | "analyzing" | "granted";

const LOGS = [
  "Inicializando matriz biométrica…",
  "Mapeando crestas papilares…",
  "Analizando patrón venoso…",
  "Midiendo temperatura dérmica…",
  "Cotejando con base de datos central…",
  "Verificando firma neuronal…",
];

function Scanner() {
  const [cfg, setCfg] = useState<ScannerConfig>(defaultConfig);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [touching, setTouching] = useState(false);
  const [who, setWho] = useState<Participant | null>(null);
  const [typed, setTyped] = useState("");
  const [orb, setOrb] = useState<AsciiOrbState>("idle");
  const raf = useRef<number>(0);
  const start = useRef(0);
  const lastTick = useRef(0);
  const touches = useRef(new Set<number>());

  useEffect(() => setCfg(loadConfig()), []);

  const fx = {
    beep: (...a: Parameters<typeof beep>) => cfg.sound && beep(...a),
    vib: (p: number | number[]) => cfg.haptics && vibrate(p),
  };

  const tick = () => {
    const total = cfg.scanSeconds * 1000;
    const p = Math.min(1, (performance.now() - start.current) / total);
    setProgress(p);
    const step = Math.floor(p * 20);
    if (step !== lastTick.current) {
      lastTick.current = step;
      fx.vib(15);
      fx.beep(500 + step * 30, 0.04, "square", 0.03);
    }
    if (p >= 1) return finishScan();
    raf.current = requestAnimationFrame(tick);
  };

  const beginScan = () => {
    if (phase !== "idle") return;
    setPhase("scanning");
    setOrb("listening");
    start.current = performance.now();
    lastTick.current = 0;
    fx.vib([40, 30, 40]);
    fx.beep(660, 0.12);
    raf.current = requestAnimationFrame(tick);
  };

  const abortScan = () => {
    if (phase !== "scanning") return;
    cancelAnimationFrame(raf.current);
    setPhase("idle");
    setOrb("idle");
    setProgress(0);
    fx.vib([200]);
    fx.beep(180, 0.3, "sawtooth", 0.06);
  };

  const finishScan = () => {
    cancelAnimationFrame(raf.current);
    setPhase("analyzing");
    setOrb("thinking");
    fx.vib([60, 60, 60]);
    const c = loadConfig();
    const list = c.participants;
    const p = (list.length ? list[c.nextIndex % list.length] : null) ?? null;
    setWho(p);
    saveConfig({ ...c, nextIndex: list.length ? (c.nextIndex + 1) % list.length : 0 });
    setTimeout(() => {
      setPhase("granted");
      setOrb("speaking");
      fx.vib([100, 50, 100, 50, 300]);
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => fx.beep(f, 0.18, "sine", 0.07), i * 110));
      const msg = fillTemplate(c.welcomeTemplate, p, c);
      let i = 0;
      const t = setInterval(() => {
        i++;
        setTyped(msg.slice(0, i));
        if (i >= msg.length) clearInterval(t);
      }, 35);
      if (c.voice) speak(msg, () => setOrb("idle"));
      else setTimeout(() => setOrb("idle"), 2500);
    }, 2200);
  };

  const reset = () => {
    window.speechSynthesis?.cancel();
    setPhase("idle");
    setOrb("idle");
    setProgress(0);
    setTyped("");
    setWho(null);
  };

  const onDown = (e: React.PointerEvent) => {
    touches.current.add(e.pointerId);
    setTouching(true);
    beginScan();
  };
  const onUp = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size === 0) {
      setTouching(false);
      abortScan();
    }
  };

  const logIdx = Math.min(LOGS.length - 1, Math.floor(progress * LOGS.length));
  const granted = phase === "granted";

  return (
    <main className="grid-bg relative flex h-[100dvh] w-full touch-none flex-col overflow-hidden bg-background text-foreground">
      <header className="flex items-center justify-between px-8 pt-6 font-display text-xs uppercase tracking-[0.3em] text-muted-foreground">
        <span>{cfg.facility}</span>
        <span className="flicker text-primary">● Sistema {cfg.systemName} en línea</span>
        <Link to="/configuracion" className="opacity-30 hover:opacity-100" aria-label="Configuración">⚙</Link>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <div className="relative">
          <AsciiOrb state={orb} size="min(220px, 30vh)" fontSize={9} glow={0.8} color={granted ? "oklch(0.82 0.2 150)" : "oklch(0.82 0.14 195)"} />
        </div>

        {!granted && (
          <>
            <h1 className="text-center font-display text-3xl uppercase tracking-[0.2em] text-glow md:text-4xl">
              {phase === "idle" && "Coloque su mano en el escáner"}
              {phase === "scanning" && "Escaneando… no retire la mano"}
              {phase === "analyzing" && "Analizando identidad…"}
            </h1>

            <div
              onPointerDown={onDown}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onPointerLeave={onUp}
              onContextMenu={(e) => e.preventDefault()}
              className="relative aspect-[3/4] w-[min(62vw,46vh)] overflow-hidden rounded-3xl border-2 border-primary/50 bg-card/40 shadow-[0_0_60px_var(--glow)]"
            >
              {phase === "idle" && <div className="pulse-ring pointer-events-none absolute inset-6 rounded-3xl border-2 border-primary" />}
              <HandSvg active={touching || phase !== "idle"} />
              {phase !== "idle" && <div className="scanline" />}
              {phase === "analyzing" && <div className="absolute inset-0 animate-pulse bg-primary/10" />}
            </div>

            <div className="w-[min(70vw,520px)]">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary shadow-[0_0_16px_var(--glow)] transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-sm text-muted-foreground">
                <span>{phase === "idle" ? "Esperando contacto…" : phase === "analyzing" ? "Consultando IA…" : LOGS[logIdx] ?? ""}</span>
                <span className="text-primary">{Math.round(progress * 100)}%</span>
              </div>
            </div>
          </>
        )}

        {granted && (
          <div className="flex max-w-3xl animate-in fade-in zoom-in-95 flex-col items-center gap-6 text-center duration-700">
            <p className="font-display text-5xl font-bold uppercase tracking-[0.25em] text-success text-glow-success md:text-6xl">Acceso concedido</p>
            {who && (
              <div className="w-full rounded-xl border border-success/40 bg-card/60 p-6 text-left">
                <p className="font-display text-4xl text-foreground">{who.name}</p>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  {who.role && <Info k="Cargo" v={who.role} />}
                  {who.clearance && <Info k="Nivel de acceso" v={who.clearance} />}
                  <Info k="Coincidencia biométrica" v="99.98%" />
                  <Info k="ID" v={`#${who.id.toUpperCase()}`} />
                </div>
                {who.note && <p className="mt-4 border-t border-border pt-3 text-muted-foreground">{who.note}</p>}
              </div>
            )}
            <p className="min-h-16 text-xl text-primary">{typed}<span className="flicker">▌</span></p>
            <button onClick={reset} className="rounded-full border border-primary/50 px-10 py-4 font-display uppercase tracking-[0.3em] text-primary active:scale-95">
              Siguiente escaneo
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-muted-foreground">{k}</p>
      <p className="text-success">{v}</p>
    </div>
  );
}

function HandSvg({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 300 400" className={`pointer-events-none absolute inset-0 m-auto h-[85%] w-[85%] transition-all duration-500 ${active ? "text-primary opacity-100" : "text-primary/50 opacity-70"}`} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M95 380 C70 330 55 290 40 240 C32 215 52 200 68 220 L95 260 L95 110 C95 92 122 92 122 110 L122 220 L122 70 C122 50 152 50 152 70 L152 215 L152 80 C152 60 182 60 182 80 L182 220 L182 115 C182 97 210 97 210 115 L210 270 C210 330 190 360 175 380 Z" strokeDasharray={active ? "0" : "8 8"} />
      {active && [150, 190, 230, 270, 310].map((y) => <line key={y} x1="100" x2="200" y1={y} y2={y} opacity=".25" />)}
    </svg>
  );
}
