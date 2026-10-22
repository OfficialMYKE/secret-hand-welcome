import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AsciiOrb, type AsciiOrbState } from "@/components/ascii-orb";
import { beep, speak, startHum, vibrate } from "@/lib/fx";
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

type Phase = "boot" | "idle" | "scanning" | "analyzing" | "denied" | "granted";

const LOGS = [
  "Inicializando matriz biométrica",
  "Mapeando crestas papilares",
  "Analizando patrón venoso",
  "Midiendo temperatura dérmica",
  "Cotejando base de datos central",
  "Verificando firma neuronal",
];
const BOOT = ["> Cargando núcleo cognitivo…", "> Calibrando sensores ópticos…", "> Estableciendo enlace seguro…", "> Sistema listo."];
const hex = () => Array.from({ length: 4 }, () => Math.floor(Math.random() * 65536).toString(16).padStart(4, "0").toUpperCase()).join(" ");

function Scanner() {
  const [cfg, setCfg] = useState<ScannerConfig>(defaultConfig);
  const [phase, setPhase] = useState<Phase>("boot");
  const [bootLines, setBootLines] = useState<string[]>([]);
  const [booting, setBooting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [who, setWho] = useState<Participant | null>(null);
  const [typed, setTyped] = useState("");
  const [orb, setOrb] = useState<AsciiOrbState>("idle");
  const [stream, setStream] = useState<string[]>([]);
  const [clock, setClock] = useState("");
  const raf = useRef<number>(0);
  const start = useRef(0);
  const lastTick = useRef(0);
  const touches = useRef(new Set<number>());
  const phaseRef = useRef<Phase>("boot");
  phaseRef.current = phase;

  useEffect(() => setCfg(loadConfig()), []);
  useEffect(() => {
    const t = setInterval(() => {
      setClock(new Date().toLocaleTimeString("es", { hour12: false }));
      setStream((s) => [hex(), ...s].slice(0, 14));
    }, phase === "scanning" ? 90 : 600);
    return () => clearInterval(t);
  }, [phase]);

  const fx = {
    beep: (...a: Parameters<typeof beep>) => cfg.sound && beep(...a),
    vib: (p: number | number[]) => cfg.haptics && vibrate(p),
  };

  const boot = async () => {
    if (booting) return;
    setBooting(true);
    try { await document.documentElement.requestFullscreen?.(); } catch {}
    if (cfg.sound) startHum();
    fx.vib(30);
    for (let i = 0; i < BOOT.length; i++) {
      await new Promise((r) => setTimeout(r, 550));
      setBootLines((l) => [...l, BOOT[i] ?? ""]);
      fx.beep(400 + i * 120, 0.05, "square", 0.03);
      fx.vib(12);
    }
    await new Promise((r) => setTimeout(r, 600));
    setPhase("idle");
    if (cfg.voice) speak(`Sistema ${cfg.systemName} activo. Coloque su mano en el escáner.`);
  };

  const tick = () => {
    const p = Math.min(1, (performance.now() - start.current) / (cfg.scanSeconds * 1000));
    setProgress(p);
    const step = Math.floor(p * 24);
    if (step !== lastTick.current) {
      lastTick.current = step;
      fx.vib(12 + step);
      fx.beep(420 + step * 28, 0.035, "square", 0.025);
    }
    if (p >= 1) return finishScan();
    raf.current = requestAnimationFrame(tick);
  };

  const beginScan = () => {
    if (phaseRef.current !== "idle") return;
    setPhase("scanning");
    setOrb("listening");
    start.current = performance.now();
    lastTick.current = 0;
    fx.vib([40, 30, 40]);
    fx.beep(660, 0.12);
    raf.current = requestAnimationFrame(tick);
  };

  const abortScan = () => {
    if (phaseRef.current !== "scanning") return;
    cancelAnimationFrame(raf.current);
    setPhase("denied");
    setOrb("idle");
    fx.vib([250, 80, 250]);
    fx.beep(160, 0.4, "sawtooth", 0.07);
    if (cfg.voice) speak("Lectura interrumpida. Mantenga la mano sobre el escáner.");
    setTimeout(() => { setPhase("idle"); setProgress(0); }, 2200);
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
      fx.vib([100, 50, 100, 50, 400]);
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => fx.beep(f, 0.2, "sine", 0.07), i * 110));
      const msg = fillTemplate(c.welcomeTemplate, p, c);
      let i = 0;
      const t = setInterval(() => {
        i++;
        setTyped(msg.slice(0, i));
        if (i >= msg.length) clearInterval(t);
      }, 35);
      if (c.voice) speak(msg, () => setOrb("idle"));
      else setTimeout(() => setOrb("idle"), 2500);
    }, 2600);
  };

  const reset = () => {
    window.speechSynthesis?.cancel();
    fx.vib(20);
    setPhase("idle");
    setOrb("idle");
    setProgress(0);
    setTyped("");
    setWho(null);
  };

  const onDown = (e: React.PointerEvent) => {
    touches.current.add(e.pointerId);
    beginScan();
  };
  const onUp = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size === 0) abortScan();
  };

  const logIdx = Math.min(LOGS.length - 1, Math.floor(progress * LOGS.length));
  const granted = phase === "granted";
  const denied = phase === "denied";
  const active = phase === "scanning" || phase === "analyzing";

  return (
    <main className="grid-bg relative flex h-[100dvh] w-full touch-none flex-col overflow-hidden bg-background text-foreground">
      {/* ambient overlays */}
      <div className="vignette pointer-events-none absolute inset-0 z-20" />
      <div className="scanlines-overlay pointer-events-none absolute inset-0 z-20 opacity-60" />
      {granted && <div className="flash pointer-events-none absolute inset-0 z-30 bg-success/40" />}
      {denied && <div className="flash pointer-events-none absolute inset-0 z-30 bg-destructive/40" />}
      <Corners />

      {phase === "boot" ? (
        <button onClick={boot} className="relative z-10 flex flex-1 flex-col items-center justify-center gap-8">
          <AsciiOrb state={booting ? "thinking" : "idle"} size="min(260px, 38vh)" fontSize={9} glow={0.8} color="oklch(0.82 0.14 195)" />
          <p className="font-display text-sm uppercase tracking-[0.5em] text-muted-foreground">{cfg.facility}</p>
          {!booting ? (
            <p className="flicker font-display text-2xl uppercase tracking-[0.35em] text-primary text-glow">Toque para iniciar</p>
          ) : (
            <div className="h-28 w-80 text-left text-sm text-primary">
              {bootLines.map((l) => <p key={l} className="rise">{l}</p>)}
            </div>
          )}
        </button>
      ) : (
        <>
          <header className="relative z-10 flex items-center justify-between px-10 pt-6 font-display text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
            <span>{cfg.facility} · Sector B</span>
            <span className={denied ? "text-destructive" : granted ? "text-success" : "flicker text-primary"}>
              ● {cfg.systemName} {denied ? "· Alerta" : granted ? "· Verificado" : "· En línea"}
            </span>
            <span className="flex items-center gap-4">
              {clock}
              <Link to="/configuracion" className="opacity-25" aria-label="Configuración">⚙</Link>
            </span>
          </header>

          {/* side data panels */}
          <aside className="pointer-events-none absolute left-8 top-1/2 z-10 hidden -translate-y-1/2 space-y-1 text-[10px] text-primary/40 lg:block">
            {stream.map((s, i) => <p key={i + s}>{s}</p>)}
          </aside>
          <aside className="pointer-events-none absolute right-8 top-1/2 z-10 hidden w-44 -translate-y-1/2 space-y-4 text-[10px] uppercase tracking-widest text-muted-foreground lg:block">
            <Meter label="Señal" v={active ? 0.6 + Math.random() * 0.4 : 0.3} />
            <Meter label="Temperatura" v={active ? progress * 0.9 : 0.1} />
            <Meter label="Coincidencia" v={granted ? 1 : progress * 0.97} />
            <p>Protocolo: Ω-7</p>
            <p>Cifrado: AES-512</p>
          </aside>

          <section className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4 px-6">
            {!granted ? (
              <>
                <div className="flex items-center gap-5">
                  <AsciiOrb state={orb} size="min(120px, 16vh)" fontSize={7} glow={0.8} color={denied ? "oklch(0.65 0.22 25)" : "oklch(0.82 0.14 195)"} />
                  <div className="max-w-md">
                    <p className="text-xs uppercase tracking-[0.4em] text-muted-foreground">{cfg.systemName} dice</p>
                    <h1 key={phase} className={`rise font-display text-2xl uppercase tracking-[0.15em] md:text-3xl ${denied ? "glitch text-destructive" : "text-glow"}`}>
                      {phase === "idle" && "Coloque su mano en el escáner"}
                      {phase === "scanning" && "No retire la mano…"}
                      {phase === "analyzing" && "Analizando identidad…"}
                      {denied && "Lectura interrumpida"}
                    </h1>
                  </div>
                </div>

                <div className="relative flex items-center justify-center">
                  {/* rotating rings */}
                  <svg viewBox="0 0 200 200" className="pointer-events-none absolute h-[min(76vw,62vh)] w-[min(76vw,62vh)]">
                    <g className="spin-slow" style={{ transformOrigin: "100px 100px" }}>
                      <circle cx="100" cy="100" r="96" fill="none" stroke="var(--primary)" strokeOpacity=".25" strokeWidth=".6" strokeDasharray="2 6" />
                    </g>
                    <g className="spin-rev" style={{ transformOrigin: "100px 100px" }}>
                      <circle cx="100" cy="100" r="90" fill="none" stroke="var(--primary)" strokeOpacity=".4" strokeWidth="1" strokeDasharray="40 20 4 20" />
                    </g>
                    <circle cx="100" cy="100" r="84" fill="none" stroke="var(--muted)" strokeWidth="2" />
                    <circle cx="100" cy="100" r="84" fill="none" stroke={denied ? "var(--destructive)" : "var(--primary)"} strokeWidth="2.5" strokeLinecap="round"
                      strokeDasharray={`${progress * 527.8} 527.8`} transform="rotate(-90 100 100)" style={{ filter: "drop-shadow(0 0 4px var(--primary))" }} />
                  </svg>

                  <div
                    onPointerDown={onDown}
                    onPointerUp={onUp}
                    onPointerCancel={onUp}
                    onPointerLeave={onUp}
                    onContextMenu={(e) => e.preventDefault()}
                    className={`relative aspect-[3/4] w-[min(42vw,38vh)] overflow-hidden rounded-[2rem] border-2 bg-card/50 backdrop-blur-sm transition-all duration-500 ${
                      denied ? "border-destructive shadow-[0_0_60px_oklch(0.65_0.22_25/0.5)]" : active ? "scale-[1.03] border-primary shadow-[0_0_90px_var(--glow)]" : "border-primary/50 shadow-[0_0_40px_var(--glow)]"
                    }`}
                  >
                    {phase === "idle" && <div className="pulse-ring pointer-events-none absolute inset-4 rounded-[1.6rem] border-2 border-primary" />}
                    <HandSvg active={active} progress={progress} />
                    {active && <div className="scanline" />}
                    {phase === "analyzing" && <div className="absolute inset-0 animate-pulse bg-primary/10" />}
                  </div>
                </div>

                <div className="w-[min(70vw,460px)] text-center">
                  <p className="text-sm text-muted-foreground">
                    {phase === "idle" ? "Esperando contacto…" : phase === "analyzing" ? "Consultando núcleo de IA…" : denied ? "Reintente el escaneo" : `${LOGS[logIdx] ?? ""}…`}
                    <span className="ml-3 font-display text-primary">{Math.round(progress * 100)}%</span>
                  </p>
                </div>
              </>
            ) : (
              <div className="flex w-full max-w-4xl items-center gap-10">
                <div className="rise hidden shrink-0 md:block">
                  <AsciiOrb state={orb} size="min(240px, 34vh)" fontSize={8} glow={0.9} color="oklch(0.82 0.2 150)" />
                </div>
                <div className="flex flex-1 flex-col gap-5">
                  <p className="rise font-display text-4xl font-bold uppercase tracking-[0.2em] text-success text-glow-success md:text-5xl">Acceso<br />concedido</p>
                  {who && (
                    <div className="rise relative rounded-xl border border-success/40 bg-card/70 p-6 backdrop-blur" style={{ animationDelay: ".25s" }}>
                      <span className="absolute right-4 top-4 rounded border border-success/50 px-2 py-0.5 text-[10px] uppercase tracking-widest text-success">Verificado</span>
                      <p className="font-display text-3xl">{who.name}</p>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        {who.role && <Info k="Cargo" v={who.role} />}
                        {who.clearance && <Info k="Nivel de acceso" v={who.clearance} />}
                        <Info k="Coincidencia" v="99.98%" />
                        <Info k="ID" v={`#${who.id.toUpperCase()}`} />
                      </div>
                      {who.note && <p className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground">{who.note}</p>}
                    </div>
                  )}
                  <p className="min-h-14 text-lg text-primary">{typed}<span className="flicker">▌</span></p>
                  <button onClick={reset} className="self-start rounded-full border border-primary/50 px-8 py-4 font-display text-sm uppercase tracking-[0.3em] text-primary transition active:scale-95 active:bg-primary/10">
                    Siguiente escaneo →
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function Corners() {
  return (
    <div className="pointer-events-none absolute inset-4 z-20">
      <span className="hud-corner left-0 top-0 border-l-2 border-t-2" />
      <span className="hud-corner right-0 top-0 border-r-2 border-t-2" />
      <span className="hud-corner bottom-0 left-0 border-b-2 border-l-2" />
      <span className="hud-corner bottom-0 right-0 border-b-2 border-r-2" />
    </div>
  );
}

function Meter({ label, v }: { label: string; v: number }) {
  return (
    <div>
      <p className="mb-1">{label}</p>
      <div className="h-1 bg-muted">
        <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${Math.min(1, v) * 100}%` }} />
      </div>
    </div>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{k}</p>
      <p className="text-success">{v}</p>
    </div>
  );
}

const TIPS = [
  [108, 120],
  [137, 80],
  [167, 90],
  [196, 125],
  [55, 228],
];

function HandSvg({ active, progress }: { active: boolean; progress: number }) {
  return (
    <svg viewBox="0 0 250 400" className={`pointer-events-none absolute inset-0 m-auto h-[82%] w-[82%] transition-all duration-500 ${active ? "text-primary" : "text-primary/60"}`} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M95 380 C70 330 55 290 40 240 C32 215 52 200 68 220 L95 260 L95 110 C95 92 122 92 122 110 L122 220 L122 70 C122 50 152 50 152 70 L152 215 L152 80 C152 60 182 60 182 80 L182 220 L182 115 C182 97 210 97 210 115 L210 270 C210 330 190 360 175 380 Z"
        strokeDasharray={active ? "0" : "8 8"} style={{ filter: active ? "drop-shadow(0 0 6px var(--primary))" : undefined }} />
      {active && [150, 190, 230, 270, 310, 350].map((y) => <line key={y} x1="100" x2="200" y1={y} y2={y} opacity=".2" />)}
      {TIPS.map(([x, y], i) => {
        const lit = progress > (i + 1) / (TIPS.length + 1);
        return <circle key={i} cx={x} cy={y} r={lit ? 7 : 4} fill={lit ? "var(--primary)" : "none"} opacity={lit ? 1 : 0.4} style={{ transition: "all .3s", filter: lit ? "drop-shadow(0 0 6px var(--primary))" : undefined }} />;
      })}
    </svg>
  );
}
