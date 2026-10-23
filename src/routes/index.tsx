import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import handScan from "@/assets/hand-scan.png";
import { AsciiOrb, type AsciiOrbState } from "@/components/ascii-orb";
import { beep, keepAwake, speak, startHum, stopHum, sweep, vibrate } from "@/lib/fx";
import {
  defaultConfig,
  fillTemplate,
  loadConfig,
  saveConfig,
  type Participant,
  type ScannerConfig,
} from "@/lib/scanner-config";

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
const ANALYZE = [
  "Cotejando base de datos central",
  "Verificando firma neuronal",
  "Núcleo de IA: identidad confirmada",
];
const ANALYZE_MS = 2400;
const BOOT = [
  "> Cargando núcleo cognitivo…",
  "> Calibrando sensores ópticos…",
  "> Estableciendo enlace seguro…",
  "> Sistema listo.",
];
const hex = () =>
  Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 65536)
      .toString(16)
      .padStart(4, "0")
      .toUpperCase(),
  ).join(" ");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const prefersReduced = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const GLYPHS = "#@$%&*0123456789ABCDEFXZ";

function Decode({ text, speed = 26, per = 3 }: { text: string; speed?: number; per?: number }) {
  const [out, setOut] = useState("");
  useEffect(() => {
    if (prefersReduced()) {
      setOut(text);
      return;
    }
    let done = 0;
    setOut("");
    const id = window.setInterval(() => {
      done = Math.min(text.length, done + per);
      let s = text.slice(0, done);
      if (done < text.length) {
        let noise = "";
        for (let i = done; i < text.length; i++) {
          noise +=
            text[i] === " " ? " " : (GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? "");
        }
        s += noise;
      }
      setOut(s);
      if (done >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed, per]);
  return <span>{out}</span>;
}

function KineticText({ text, step = 24 }: { text: string; step?: number }) {
  let n = 0;
  return (
    <>
      {text.split(" ").map((word, w) => (
        <span key={`${w}-${word}`} className="inline-block whitespace-nowrap">
          {word.split("").map((ch, i) => (
            <span key={`${i}-${ch}`} className="kt" style={{ animationDelay: `${n++ * step}ms` }}>
              {ch}
            </span>
          ))}
          {"\u00A0"}
        </span>
      ))}
    </>
  );
}

function GearLink({ haptics, sound }: { haptics: boolean; sound: boolean }) {
  const navigate = useNavigate();
  const timer = useRef<number | null>(null);
  const [holding, setHolding] = useState(false);
  const cancel = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setHolding(false);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const begin = () => {
    if (timer.current) return;
    if (haptics) vibrate(12);
    if (sound) beep(720, 0.05, "square", 0.03);
    setHolding(true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setHolding(false);
      if (haptics) vibrate([20, 40, 20]);
      if (sound) beep(980, 0.1, "sine", 0.05);
      navigate({ to: "/configuracion" });
    }, 1200);
  };
  return (
    <button
      type="button"
      aria-label="Configuración del operador: mantén pulsado 1,2 segundos"
      onPointerDown={begin}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if (e.key === "Enter") begin();
      }}
      onKeyUp={(e) => {
        if (e.key === "Enter") cancel();
      }}
      onContextMenu={(e) => e.preventDefault()}
      className="relative h-10 w-10 select-none opacity-30 transition-opacity hover:opacity-80 active:opacity-100"
    >
      {holding && <span aria-hidden="true" className="hold-fill" />}
      <span
        aria-hidden="true"
        className="relative flex h-full w-full items-center justify-center text-lg"
      >
        ⚙
      </span>
    </button>
  );
}

function Scanner() {
  const [cfg, setCfg] = useState<ScannerConfig>(defaultConfig);
  const [phase, setPhase] = useState<Phase>("boot");
  const [bootLines, setBootLines] = useState<string[]>([]);
  const [bootTyping, setBootTyping] = useState("");
  const [booting, setBooting] = useState(false);
  const [wake, setWake] = useState(false);
  const [progress, setProgress] = useState(0);
  const [analysis, setAnalysis] = useState(0);
  const [who, setWho] = useState<Participant | null>(null);
  const [typed, setTyped] = useState("");
  const [orb, setOrb] = useState<AsciiOrbState>("idle");
  const [stream, setStream] = useState<string[]>([]);
  const [clock, setClock] = useState("");
  const [losing, setLosing] = useState(false);
  const [stage, setStage] = useState(0);
  const [scanId, setScanId] = useState(0);
  const [autoLeft, setAutoLeft] = useState(0);
  const raf = useRef(0);
  const start = useRef(0);
  const lastTick = useRef(0);
  const lastFrame = useRef(0);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const tipsRef = useRef<boolean[]>([false, false, false, false, false]);
  const phaseRef = useRef<Phase>("boot");
  const cfgRef = useRef<ScannerConfig>(defaultConfig);
  const loseTimer = useRef<number | null>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const coordRef = useRef<HTMLSpanElement>(null);
  const [tips, setTips] = useState<boolean[]>([false, false, false, false, false]);
  phaseRef.current = phase;
  cfgRef.current = cfg;

  useEffect(() => setCfg(loadConfig()), []);
  useEffect(() => {
    const t = setInterval(
      () => {
        setClock(new Date().toLocaleTimeString("es", { hour12: false }));
        setStream((s) => [hex(), ...s].slice(0, 14));
      },
      phase === "scanning" ? 90 : 600,
    );
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    if (!cfg.sound) stopHum();
    else if (phase !== "boot") startHum();
  }, [cfg.sound, phase]);

  useEffect(
    () => () => {
      stopHum();
      if (loseTimer.current) clearTimeout(loseTimer.current);
    },
    [],
  );

  const fx = {
    beep: (...a: Parameters<typeof beep>) => cfg.sound && beep(...a),
    vib: (p: number | number[]) => cfg.haptics && vibrate(p),
  };

  const reset = useCallback(() => {
    window.speechSynthesis?.cancel();
    if (cfg.haptics) vibrate(20);
    setPhase("idle");
    setOrb("idle");
    setProgress(0);
    setAnalysis(0);
    setTyped("");
    setWho(null);
    setStage(0);
    setAutoLeft(0);
  }, [cfg.haptics]);

  useEffect(() => {
    if (phase !== "granted" || cfg.autoResetSeconds <= 0) {
      setAutoLeft(0);
      return;
    }
    setAutoLeft(cfg.autoResetSeconds);
    const iv = window.setInterval(() => setAutoLeft((s) => Math.max(0, s - 1)), 1000);
    const t = window.setTimeout(reset, cfg.autoResetSeconds * 1000);
    return () => {
      clearInterval(iv);
      clearTimeout(t);
    };
  }, [phase, cfg.autoResetSeconds, reset]);

  const boot = async () => {
    if (booting) return;
    setBooting(true);
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      // fullscreen unsupported (e.g. iOS Safari)
    }
    keepAwake();
    if (cfg.sound) startHum();
    fx.vib(30);
    await sleep(450);
    for (let i = 0; i < BOOT.length; i++) {
      const line = BOOT[i] ?? "";
      if (prefersReduced()) {
        setBootLines((l) => [...l, line]);
      } else {
        for (let j = 1; j <= line.length; j++) {
          setBootTyping(line.slice(0, j));
          await sleep(16);
        }
        setBootTyping("");
        setBootLines((l) => [...l, line]);
      }
      fx.beep(400 + i * 120, 0.05, "square", 0.03);
      fx.vib(12);
      await sleep(160);
    }
    await sleep(500);
    setWake(true);
    setTimeout(() => setWake(false), 900);
    setPhase("idle");
    if (cfg.voice) speak(`Sistema ${cfg.systemName} activo. Coloque su mano en el escáner.`);
  };

  const clearLose = () => {
    if (loseTimer.current) {
      clearTimeout(loseTimer.current);
      loseTimer.current = null;
    }
    setLosing(false);
  };

  const finishScan = () => {
    cancelAnimationFrame(raf.current);
    clearLose();
    setPhase("analyzing");
    setOrb("thinking");
    fx.vib([60, 60, 60]);
    if (cfg.sound) sweep(1.2, 200, 4000, 0.05);
    const c = loadConfig();
    const list = c.participants;
    const p = (list.length ? list[c.nextIndex % list.length] : null) ?? null;
    setWho(p);
    const nextCfg = { ...c, nextIndex: list.length ? (c.nextIndex + 1) % list.length : 0 };
    saveConfig(nextCfg);
    setCfg(nextCfg);
    setStage(0);
    setAnalysis(0);
    const t0 = performance.now();
    const iv = window.setInterval(() => {
      const q = Math.min(1, (performance.now() - t0) / ANALYZE_MS);
      setAnalysis(q);
      if (q >= 1) clearInterval(iv);
    }, 60);
    setTimeout(() => setStage(1), 850);
    setTimeout(() => setStage(2), 1700);
    setTimeout(() => setStage(3), 2350);
    setTimeout(() => {
      setPhase("granted");
      setOrb("speaking");
      fx.vib([100, 50, 100, 50, 400]);
      [523, 659, 784, 1047].forEach((f, i) =>
        setTimeout(() => fx.beep(f, 0.2, "sine", 0.07), i * 110),
      );
      const msg = fillTemplate(c.welcomeTemplate, p, c);
      let i = 0;
      const t = setInterval(
        () => {
          i = Math.min(msg.length, i + 1);
          setTyped(msg.slice(0, i));
          if (i >= msg.length) clearInterval(t);
        },
        c.voice ? 85 : 35,
      );
      if (c.voice) {
        speak(
          msg,
          () => {
            clearInterval(t);
            setTyped(msg);
            setOrb("idle");
          },
          (n) => {
            if (n > i) {
              i = n;
              setTyped(msg.slice(0, i));
            }
          },
        );
      } else {
        setTimeout(() => setOrb("idle"), 2500);
      }
    }, 2600);
  };

  const tick = () => {
    const now = performance.now();
    const dt = now - (lastFrame.current || now);
    lastFrame.current = now;
    const c = cfgRef.current;
    if (c.requireFullHand && !tipsRef.current.every(Boolean)) {
      start.current += dt;
    }
    const p = Math.min(1, (now - start.current) / (c.scanSeconds * 1000));
    setProgress(p);
    const step = Math.floor(p * 24);
    if (step !== lastTick.current) {
      lastTick.current = step;
      if (step % 6 === 0 && c.sound) sweep(0.5, 300 + step * 40, 2400 + step * 60, 0.03);
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
    setScanId((n) => n + 1);
    start.current = performance.now();
    lastFrame.current = 0;
    lastTick.current = 0;
    fx.vib([40, 30, 40]);
    fx.beep(660, 0.12);
    raf.current = requestAnimationFrame(tick);
  };

  const abortScan = () => {
    if (phaseRef.current !== "scanning") return;
    cancelAnimationFrame(raf.current);
    clearLose();
    setPhase("denied");
    setOrb("idle");
    fx.vib([250, 80, 250]);
    fx.beep(160, 0.4, "sawtooth", 0.07);
    if (cfg.voice) speak("Lectura interrumpida. Mantenga la mano sobre el escáner.");
    setTimeout(() => {
      setPhase("idle");
      setProgress(0);
    }, 2200);
  };

  const setContact = (e: React.PointerEvent) => {
    const el = padRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    touches.current.set(e.pointerId, { x, y });
    el.style.setProperty("--mx", `${x}px`);
    el.style.setProperty("--my", `${y}px`);
    const scale = Math.min((r.width * 0.82) / 250, (r.height * 0.82) / 400);
    if (scale > 0 && coordRef.current) {
      const vx = Math.round((x - (r.width - 250 * scale) / 2) / scale);
      const vy = Math.round((y - (r.height - 400 * scale) / 2) / scale);
      coordRef.current.textContent = `X${String(Math.max(0, Math.min(250, vx))).padStart(3, "0")} Y${String(Math.max(0, Math.min(400, vy))).padStart(3, "0")}`;
    }
  };

  const updateTips = () => {
    const el = padRef.current;
    const next = [false, false, false, false, false];
    if (el) {
      const r = el.getBoundingClientRect();
      const scale = Math.min((r.width * 0.82) / 250, (r.height * 0.82) / 400);
      if (scale > 0) {
        const ox = (r.width - 250 * scale) / 2;
        const oy = (r.height - 400 * scale) / 2;
        for (let i = 0; i < FINGERS.length; i++) {
          const f = FINGERS[i];
          if (!f) continue;
          for (const p of touches.current.values()) {
            const vx = (p.x - ox) / scale;
            const vy = (p.y - oy) / scale;
            if ((vx - f.x) ** 2 + (vy - f.y) ** 2 <= HIT_R * HIT_R) {
              next[i] = true;
              break;
            }
          }
        }
      }
    }
    const prev = tipsRef.current;
    let changed = false;
    for (let i = 0; i < next.length; i++) {
      if (prev[i] !== next[i]) {
        changed = true;
        if (next[i]) {
          if (cfgRef.current.sound) beep(FINGER_TONES[i] ?? 600, 0.05, "square", 0.03);
          if (cfgRef.current.haptics) vibrate(8);
        }
      }
    }
    if (!prev.every(Boolean) && next.every(Boolean)) {
      if (cfgRef.current.haptics) vibrate([15, 30, 15, 30, 70]);
      if (cfgRef.current.sound) {
        [784, 988, 1175].forEach((f, k) => setTimeout(() => beep(f, 0.12, "sine", 0.05), k * 90));
      }
    }
    tipsRef.current = next;
    if (changed) setTips(next);
  };

  const onDown = (e: React.PointerEvent) => {
    setContact(e);
    if (loseTimer.current) {
      clearTimeout(loseTimer.current);
      loseTimer.current = null;
    }
    if (phaseRef.current === "scanning" && losing) {
      setLosing(false);
      fx.vib(10);
      fx.beep(560, 0.05, "square", 0.03);
    }
    beginScan();
    updateTips();
  };

  const onUp = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId);
    updateTips();
    if (touches.current.size !== 0 || phaseRef.current !== "scanning") return;
    setLosing(true);
    fx.vib(14);
    fx.beep(300, 0.09, "triangle", 0.05);
    if (loseTimer.current) clearTimeout(loseTimer.current);
    loseTimer.current = window.setTimeout(() => {
      loseTimer.current = null;
      setLosing(false);
      abortScan();
    }, 450);
  };

  const logIdx = Math.min(LOGS.length - 1, Math.floor(progress * LOGS.length));
  const granted = phase === "granted";
  const denied = phase === "denied";
  const scanning = phase === "scanning";
  const analyzing = phase === "analyzing";
  const idle = phase === "idle";
  const active = scanning || analyzing;
  const weak = losing && scanning;
  const total = cfg.participants.length;
  const subjectNo = total ? (cfg.nextIndex % total) + 1 : 0;
  const tipCount = tips.filter(Boolean).length;
  const handShort = scanning && cfg.requireFullHand && tipCount < 5;
  const statusLive = denied
    ? "Acceso denegado"
    : scanning
      ? handShort
        ? `Coloque los 5 dedos, faltan ${5 - tipCount}`
        : weak
          ? "Señal débil, vuelva a apoyar la mano"
          : "Escaneando en curso"
      : analyzing
        ? "Analizando identidad"
        : idle
          ? "Esperando contacto"
          : "";
  const titleText = idle
    ? "Coloque su mano en el escáner"
    : scanning
      ? handShort
        ? "Coloque los 5 dedos…"
        : weak
          ? "Vuelva a apoyar la mano…"
          : "No retire la mano…"
      : denied
        ? "Acceso denegado"
        : "";

  return (
    <main className="grid-bg relative flex h-[100dvh] w-full touch-none flex-col overflow-hidden bg-background text-foreground">
      {/* ambient layers */}
      <div aria-hidden="true" className="ambient pointer-events-none absolute inset-0 z-0" />
      <div aria-hidden="true" className="vignette pointer-events-none absolute inset-0 z-20" />
      <div
        aria-hidden="true"
        className="scanlines-overlay pointer-events-none absolute inset-0 z-20 opacity-60"
      />
      <div aria-hidden="true" className="grain pointer-events-none absolute inset-[-2%] z-20" />
      {denied && (
        <div
          aria-hidden="true"
          className="alert-edge pointer-events-none absolute inset-0 z-[25]"
        />
      )}
      {wake && <div className="flash pointer-events-none absolute inset-0 z-30 bg-primary/30" />}
      {granted && (
        <>
          <div className="flash pointer-events-none absolute inset-0 z-30 bg-success/40" />
          <div aria-hidden="true" className="wipe pointer-events-none absolute inset-0 z-30" />
        </>
      )}
      {denied && (
        <div className="flash pointer-events-none absolute inset-0 z-30 bg-destructive/40" />
      )}
      <Corners />
      <span className="sr-only" aria-live="polite">
        {statusLive}
      </span>

      {phase === "boot" ? (
        <div className="relative z-10 flex flex-1 flex-col">
          <button
            type="button"
            onClick={boot}
            className="flex flex-1 flex-col items-center justify-center gap-8"
          >
            <AsciiOrb
              state={booting ? "thinking" : "idle"}
              size="min(260px, 38vh)"
              fontSize={9}
              glow={0.8}
              color="oklch(0.82 0.14 195)"
            />
            <p className="font-display text-sm uppercase tracking-[0.5em] text-muted-foreground">
              {cfg.facility}
            </p>
            {!booting ? (
              <p className="flicker font-display text-2xl uppercase tracking-[0.35em] text-primary text-glow">
                Toque para iniciar
              </p>
            ) : (
              <div className="h-32 w-80 text-left text-sm text-primary">
                {bootLines.map((l) => (
                  <p key={l} className="rise">
                    <span className="mr-2 text-success">[OK]</span>
                    {l}
                  </p>
                ))}
                {bootTyping && (
                  <p>
                    {bootTyping}
                    <span className="flicker">▌</span>
                  </p>
                )}
              </div>
            )}
          </button>
          <div className="absolute bottom-6 right-8">
            <GearLink haptics={cfg.haptics} sound={cfg.sound} />
          </div>
        </div>
      ) : (
        <>
          <header className="relative z-10 flex items-center justify-between px-10 pt-6 font-display text-xs uppercase tracking-[0.3em] text-muted-foreground">
            <span>{cfg.facility} · Sector B</span>
            <span
              className={
                denied || weak
                  ? "text-destructive"
                  : granted
                    ? "text-success"
                    : "flicker text-primary"
              }
            >
              ● {cfg.systemName}{" "}
              {denied
                ? "· Alerta"
                : granted
                  ? "· Verificado"
                  : weak
                    ? "· Interferencia"
                    : analyzing
                      ? "· Procesando"
                      : "· En línea"}
            </span>
            <span className="flex items-center gap-4">
              {total > 0 && (
                <span className="text-primary">
                  Sujeto {String(subjectNo).padStart(2, "0")}/{String(total).padStart(2, "0")}
                </span>
              )}
              {clock}
              <GearLink haptics={cfg.haptics} sound={cfg.sound} />
            </span>
          </header>

          {/* side data panels */}
          <aside
            aria-hidden="true"
            className="pointer-events-none absolute left-8 top-1/2 z-10 hidden -translate-y-1/2 space-y-1 font-mono text-[11px] text-primary/60 lg:block"
          >
            {stream.map((s, i) => (
              <p key={i + s}>{s}</p>
            ))}
          </aside>
          <aside
            aria-hidden="true"
            className="pointer-events-none absolute right-8 top-1/2 z-10 hidden w-44 -translate-y-1/2 space-y-4 text-[11px] uppercase tracking-widest text-muted-foreground lg:block"
          >
            <Meter label="Señal" v={active ? 0.6 + Math.random() * 0.4 : 0.3} />
            <Meter label="Temperatura" v={active ? progress * 0.9 : 0.1} />
            <Meter label="Coincidencia" v={granted ? 1 : progress * 0.97} />
            <p>Protocolo: Ω-7</p>
            <p>Cifrado: AES-512</p>
          </aside>

          <section className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4 px-6">
            {!granted ? (
              analyzing ? (
                <AnalysisView
                  analysis={analysis}
                  stage={stage}
                  systemName={cfg.systemName}
                  target={who}
                />
              ) : (
                <>
                  <div className="flex flex-col items-center gap-2 text-center">
                    <AsciiOrb
                      state={orb}
                      size="min(70px, 9vh)"
                      fontSize={5}
                      glow={0.8}
                      color={denied || weak ? "oklch(0.65 0.22 25)" : "oklch(0.82 0.14 195)"}
                    />
                    <div className="max-w-md">
                      <p className="text-xs uppercase tracking-[0.4em] text-muted-foreground">
                        {cfg.systemName} dice
                      </p>
                      <h1
                        key={`${phase}-${weak}`}
                        aria-label={titleText}
                        className={`font-display text-2xl uppercase tracking-[0.15em] md:text-2xl ${
                          denied || weak ? "text-destructive" : "text-glow"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`inline-block ${denied ? "rise-glitch" : "rise"}`}
                        >
                          <KineticText text={titleText} />
                        </span>
                      </h1>
                    </div>
                  </div>

                  <div className="relative flex items-center justify-center">
                    {/* rotating rings */}
                    <svg
                      viewBox="0 0 200 200"
                      role="progressbar"
                      aria-label="Progreso del escaneo"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(progress * 100)}
                      className="pointer-events-none absolute h-[min(76vw,54vh)] w-[min(76vw,54vh)]"
                    >
                      {idle && (
                        <g className="spin-fast" style={{ transformOrigin: "100px 100px" }}>
                          <path
                            d="M100 100 L100 8 A92 92 0 0 1 161 31 Z"
                            fill="var(--primary)"
                            opacity=".1"
                          />
                        </g>
                      )}
                      <g className="spin-slow" style={{ transformOrigin: "100px 100px" }}>
                        <circle
                          cx="100"
                          cy="100"
                          r="96"
                          fill="none"
                          stroke="var(--primary)"
                          strokeOpacity=".25"
                          strokeWidth=".6"
                          strokeDasharray="2 6"
                        />
                      </g>
                      <g className="spin-rev" style={{ transformOrigin: "100px 100px" }}>
                        <circle
                          cx="100"
                          cy="100"
                          r="90"
                          fill="none"
                          stroke="var(--primary)"
                          strokeOpacity=".4"
                          strokeWidth="1"
                          strokeDasharray="40 20 4 20"
                        />
                      </g>
                      <circle
                        cx="100"
                        cy="100"
                        r="84"
                        fill="none"
                        stroke="var(--muted)"
                        strokeWidth="2"
                      />
                      <circle
                        cx="100"
                        cy="100"
                        r="84"
                        fill="none"
                        stroke={denied || weak ? "var(--destructive)" : "var(--primary)"}
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeDasharray={`${progress * 527.8} 527.8`}
                        transform="rotate(-90 100 100)"
                        style={{ filter: "drop-shadow(0 0 4px var(--primary))" }}
                      />
                    </svg>

                    <div className="flex flex-col items-center gap-2">
                      <div
                        ref={padRef}
                        onPointerDown={onDown}
                        onPointerUp={onUp}
                        onPointerCancel={onUp}
                        onPointerLeave={onUp}
                        onPointerMove={(e) => {
                          if (e.buttons > 0 || e.pointerType === "touch") {
                            setContact(e);
                            updateTips();
                          }
                        }}
                        onContextMenu={(e) => e.preventDefault()}
                        className={`relative aspect-[250/400] w-[min(46vw,34vh)] select-none overflow-hidden rounded-[2rem] border-2 bg-card/50 backdrop-blur-sm transition-all duration-500 ${
                          denied
                            ? `shake border-destructive shadow-[0_0_60px_oklch(0.65_0.22_25/0.5)]`
                            : weak
                              ? "border-destructive shadow-[0_0_70px_oklch(0.65_0.22_25/0.45)]"
                              : active
                                ? "scale-[1.03] border-primary shadow-[0_0_90px_var(--glow)]"
                                : "border-primary/50 shadow-[0_0_40px_var(--glow)]"
                        }`}
                      >
                        {idle && (
                          <div className="pulse-ring pointer-events-none absolute inset-4 rounded-[1.6rem] border-2 border-primary" />
                        )}
                        <div aria-hidden="true" className={`contact-glow ${active ? "on" : ""}`} />
                        {active && scanId > 0 && (
                          <span key={scanId} aria-hidden="true" className="ripple" />
                        )}
                        <HandSvg active={active} progress={progress} touched={tips} />
                        {weak && (
                          <div className="absolute inset-0 animate-pulse bg-destructive/10" />
                        )}

                        {/* targeting HUD */}
                        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                          <span className="absolute left-1/2 top-0 h-full w-px bg-primary/10" />
                          <span className="absolute left-0 top-1/2 h-px w-full bg-primary/10" />
                          <span className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-primary/25" />
                          <span className="absolute left-2 top-2 h-4 w-4 border-l border-t border-primary/50" />
                          <span className="absolute right-2 top-2 h-4 w-4 border-r border-t border-primary/50" />
                          <span className="absolute bottom-2 left-2 h-4 w-4 border-b border-l border-primary/50" />
                          <span className="absolute bottom-2 right-2 h-4 w-4 border-b border-r border-primary/50" />
                          <span className="absolute left-3 top-2.5 font-mono text-[9px] tracking-widest text-primary/50">
                            TGT-05
                          </span>
                          <span className="absolute right-3 top-2.5 font-mono text-[9px] tracking-widest text-primary/50">
                            IR ●ON
                          </span>
                          <span className="absolute bottom-3 left-3 font-mono text-[9px] tracking-widest text-primary/50">
                            BIO/RST
                          </span>
                          <span
                            ref={coordRef}
                            className="absolute bottom-3 right-3 font-mono text-[9px] tracking-widest text-primary/50"
                          >
                            X--- Y---
                          </span>
                          <span className="hazard absolute inset-x-0 bottom-0 h-1.5 opacity-60" />
                        </div>
                      </div>

                      {/* fingertip chips */}
                      <div aria-hidden="true" className="pointer-events-none flex gap-1.5">
                        {FINGERS.map((f, i) => (
                          <span
                            key={f.key}
                            className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest transition-all duration-200 ${
                              tips[i]
                                ? "border-primary bg-primary/15 text-primary shadow-[0_0_10px_var(--glow)]"
                                : "border-border text-muted-foreground/40"
                            }`}
                          >
                            {f.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="w-[min(70vw,460px)] text-center">
                    <p className="text-sm text-muted-foreground">
                      <span aria-hidden="true">
                        {idle && "Esperando contacto…"}
                        {weak && "Señal débil — vuelva a apoyar la mano"}
                        {scanning && !weak && <Decode text={`${LOGS[logIdx] ?? ""}…`} />}
                        {denied && "Reintente el escaneo"}
                      </span>
                      <span aria-hidden="true" className="ml-3 font-display text-primary">
                        {Math.round(progress * 100)}%
                      </span>
                    </p>
                    {idle && (
                      <p className="mt-3 text-xs uppercase tracking-[0.35em] text-primary/70">
                        {cfg.requireFullHand
                          ? "Coloque los 5 dedos y mantenga presionado"
                          : "Mantén la mano presionada"}
                      </p>
                    )}
                    {handShort && (
                      <p className="mt-3 animate-pulse text-xs uppercase tracking-[0.35em] text-primary/70">
                        Coloque los 5 dedos — faltan {5 - tipCount}
                      </p>
                    )}
                  </div>
                </>
              )
            ) : (
              <div className="relative flex w-full max-w-4xl items-center gap-10 overflow-hidden">
                <span aria-hidden="true" className="sweep" />
                <div className="rise hidden shrink-0 lg:block">
                  <AsciiOrb
                    state={orb}
                    size="min(240px, 34vh)"
                    fontSize={8}
                    glow={0.9}
                    color="oklch(0.82 0.2 150)"
                  />
                </div>
                <div className="flex flex-1 flex-col gap-5">
                  <p
                    role="status"
                    className="font-display text-4xl font-bold uppercase tracking-[0.2em] text-success text-glow-success md:text-5xl"
                  >
                    <span className="rise block">Acceso</span>
                    <span className="rise block" style={{ animationDelay: ".14s" }}>
                      concedido
                    </span>
                  </p>
                  {who && (
                    <div
                      className="rise relative rounded-xl border border-success/40 bg-card/70 p-6 backdrop-blur"
                      style={{ animationDelay: ".3s" }}
                    >
                      <span className="absolute right-4 top-4 rounded border border-success/50 px-2 py-0.5 text-[10px] uppercase tracking-widest text-success">
                        Verificado
                      </span>
                      <p className="font-display text-3xl">{who.name}</p>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        {who.role && <Info k="Cargo" v={who.role} />}
                        {who.clearance && <Info k="Nivel de acceso" v={who.clearance} />}
                        <Info k="Coincidencia" v="99.98%" />
                        <Info k="ID" v={`#${who.id.toUpperCase()}`} />
                      </div>
                      {who.note && (
                        <p className="mt-4 border-t border-border pt-3 text-sm text-muted-foreground">
                          {who.note}
                        </p>
                      )}
                    </div>
                  )}
                  <p
                    className="rise min-h-14 font-display text-lg text-primary"
                    style={{ animationDelay: ".5s" }}
                  >
                    {typed}
                    <span className="flicker">▌</span>
                  </p>
                  <div className="rise flex items-center gap-5" style={{ animationDelay: ".65s" }}>
                    <button
                      type="button"
                      onClick={reset}
                      className="self-start rounded-full border border-primary/50 px-8 py-4 font-display text-sm uppercase tracking-[0.3em] text-primary transition active:scale-95 active:bg-primary/10"
                    >
                      Siguiente escaneo →
                    </button>
                    {autoLeft > 0 && (
                      <span className="font-display text-xs uppercase tracking-widest text-muted-foreground">
                        Reinicio en {autoLeft}s
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function AnalysisView({
  analysis,
  stage,
  systemName,
  target,
}: {
  analysis: number;
  stage: number;
  systemName: string;
  target: Participant | null;
}) {
  const pct = Math.round(analysis * 100);
  const [cand, setCand] = useState({ id: "", name: "", score: 0 });
  const locked = stage >= 2;
  useEffect(() => {
    if (locked) return;
    const id = window.setInterval(() => {
      setCand({
        id: `#${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        name: DECOYS[Math.floor(Math.random() * DECOYS.length)] ?? "",
        score: 40 + Math.random() * 50,
      });
    }, 70);
    return () => clearInterval(id);
  }, [locked]);
  const shown = locked
    ? {
        id: `#${(target?.id || "0000").toUpperCase()}`,
        name: target?.name || "Agente",
        score: 99.98,
      }
    : cand;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-background/85 px-6 backdrop-blur-[3px]">
      <p className="rise font-display text-xs uppercase tracking-[0.5em] text-muted-foreground">
        {systemName} · Análisis de identidad
      </p>
      <div className="rise" style={{ animationDelay: ".1s" }}>
        <AsciiOrb
          state="thinking"
          size="min(240px, 34vh)"
          fontSize={9}
          glow={0.9}
          color="oklch(0.82 0.14 195)"
        />
      </div>
      <div
        className={`w-[min(88vw,560px)] rounded-xl border bg-card/80 px-5 py-3 font-mono text-sm backdrop-blur transition-colors ${
          locked ? "border-success/60 text-success" : "border-primary/30 text-muted-foreground"
        }`}
      >
        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.3em]">
          <span>{locked ? "Coincidencia encontrada" : "Buscando en 48.213 registros"}</span>
          <span>{shown.score.toFixed(2)}%</span>
        </div>
        <div className="mt-1 flex items-center justify-between font-display text-lg">
          <span className={locked ? "text-glow-success" : ""}>{shown.name}</span>
          <span className="text-xs">{shown.id}</span>
        </div>
      </div>
      <div className="w-[min(88vw,560px)] space-y-2 rounded-xl border border-primary/30 bg-card/80 p-5 font-mono text-sm backdrop-blur">
        {ANALYZE.map((t, i) => {
          const done = stage > i;
          const current = stage === i;
          return (
            <p
              key={t}
              className={
                done ? "text-success" : current ? "text-primary" : "text-muted-foreground/40"
              }
            >
              <span className="mr-2">{done ? "[✓]" : current ? "[…]" : "[ ]"}</span>
              {current ? <Decode text={t} /> : t}
            </p>
          );
        })}
        {stage >= ANALYZE.length && (
          <p className="text-success">
            <span className="mr-2">[✓]</span>Verificación completa
          </p>
        )}
      </div>
      <div className="flex items-baseline gap-3">
        <span className="font-display text-5xl font-bold text-primary text-glow md:text-6xl">
          {pct}%
        </span>
        <span className="text-xs uppercase tracking-[0.4em] text-muted-foreground">procesado</span>
      </div>
      <div
        role="progressbar"
        aria-label="Progreso del análisis"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1 w-[min(88vw,560px)] bg-muted"
      >
        <div
          className="h-full bg-primary transition-[width] duration-150"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
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
        <div
          className="h-full bg-primary transition-[width] duration-300"
          style={{ width: `${Math.min(1, v) * 100}%` }}
        />
      </div>
    </div>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{k}</p>
      <p className="text-success">{v}</p>
    </div>
  );
}

const DECOYS = [
  "R. Valdés",
  "M. Ortega",
  "S. Ibarra",
  "L. Ferrer",
  "A. Navarro",
  "C. Duarte",
  "J. Robles",
  "E. Salinas",
  "P. Herrera",
  "D. Molina",
  "V. Cárdenas",
  "N. Paredes",
];

const FINGERS = [
  { key: "pul", label: "Pul", x: 219, y: 164 },
  { key: "ind", label: "Índ", x: 160, y: 45 },
  { key: "med", label: "Med", x: 113, y: 24 },
  { key: "anu", label: "Anu", x: 73, y: 43 },
  { key: "men", label: "Meñ", x: 29, y: 88 },
] as const;
const FINGER_TONES = [523, 587, 659, 740, 831];
const HIT_R = 34;

function HandSvg({
  active,
  progress,
  touched,
}: {
  active: boolean;
  progress: number;
  touched: boolean[];
}) {
  const reveal = 400 * (1 - progress);
  return (
    <svg
      viewBox="0 0 250 400"
      className="pointer-events-none absolute inset-0 m-auto h-[82%] w-[82%]"
      aria-hidden="true"
    >
      <defs>
        <clipPath id="hand-reveal">
          <rect x="0" y={reveal} width="250" height={400 - reveal} />
        </clipPath>
        <linearGradient id="hand-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.75" stopColor="#fff" />
          <stop offset="1" stopColor="#000" />
        </linearGradient>
        <mask id="hand-mask">
          <rect width="250" height="400" fill="url(#hand-fade)" />
        </mask>
      </defs>
      <g mask="url(#hand-mask)">
        <image
          href={handScan}
          width="250"
          height="400"
          className={`hand-base ${active ? "on" : ""}`}
          preserveAspectRatio="xMidYMid slice"
        />
        {active && (
          <image
            href={handScan}
            width="250"
            height="400"
            clipPath="url(#hand-reveal)"
            className="hand-lit"
            preserveAspectRatio="xMidYMid slice"
          />
        )}
      </g>
      {active && progress < 1 && (
        <line
          x1="0"
          x2="250"
          y1={reveal}
          y2={reveal}
          stroke="var(--primary)"
          strokeWidth="1.5"
          style={{ filter: "drop-shadow(0 0 6px var(--primary))" }}
        />
      )}
      {FINGERS.map((f, i) => {
        const on = touched[i] === true;
        return (
          <g key={f.key} style={{ transition: "opacity .3s" }} opacity={on ? 1 : 0.35}>
            <circle
              cx={f.x}
              cy={f.y}
              r={on ? 16 : 13}
              fill="none"
              stroke={on ? "var(--success)" : "var(--primary)"}
              strokeWidth="1"
              strokeDasharray={on ? "0" : "3 3"}
              style={{
                transition: "all .3s",
                filter: on ? "drop-shadow(0 0 5px var(--success))" : undefined,
              }}
            />
            <circle cx={f.x} cy={f.y} r="1.6" fill={on ? "var(--success)" : "var(--primary)"} />
          </g>
        );
      })}
    </svg>
  );
}
