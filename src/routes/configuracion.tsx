import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Download, Plus, Trash2, Upload } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Toaster } from "@/components/ui/sonner";
import { beep, vibrate } from "@/lib/fx";
import {
  defaultConfig,
  exportConfig,
  loadConfig,
  newId,
  openOperatorSession,
  operatorSessionOk,
  parseConfig,
  saveConfig,
  type Participant,
  type ScannerConfig,
} from "@/lib/scanner-config";

export const Route = createFileRoute("/configuracion")({
  head: () => ({
    meta: [
      { title: "Configuración del Escáner" },
      { name: "description", content: "Configura participantes y mensajes del escáner." },
      { property: "og:title", content: "Configuración del Escáner" },
      { property: "og:description", content: "Panel del operador del escape room." },
    ],
  }),
  component: Config,
});

const field =
  "w-full rounded-md border border-input bg-background px-3 py-3 text-base text-foreground outline-none focus:border-primary";

function Config() {
  const [c, setC] = useState<ScannerConfig>(defaultConfig);
  const [status, setStatus] = useState<"loading" | "gate" | "ok">("loading");
  const [saved, setSaved] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const latest = useRef<ScannerConfig>(defaultConfig);

  useEffect(() => {
    const loaded = loadConfig();
    latest.current = loaded;
    setC(loaded);
    setStatus(!loaded.operatorPin || operatorSessionOk() ? "ok" : "gate");
  }, []);

  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveConfig(latest.current);
      }
    },
    [],
  );

  const up = (patch: Partial<ScannerConfig>) => {
    const n = { ...c, ...patch };
    latest.current = n;
    setC(n);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      saveConfig(n);
      setSaved(true);
      setTimeout(() => setSaved(false), 1400);
    }, 300);
  };
  const upP = (id: string, patch: Partial<Participant>) =>
    up({ participants: c.participants.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  const add = () =>
    up({
      participants: [
        ...c.participants,
        { id: newId(), name: "", role: "", clearance: "Nivel 5", note: "" },
      ],
    });

  const move = (i: number, dir: -1 | 1) => {
    const arr = [...c.participants];
    const j = i + dir;
    const a = arr[i];
    const b = arr[j];
    if (!a || !b) return;
    arr[i] = b;
    arr[j] = a;
    const len = c.participants.length;
    const nextId = len ? c.participants[c.nextIndex % len]?.id : undefined;
    const ni = nextId ? arr.findIndex((p) => p.id === nextId) : -1;
    if (c.haptics) vibrate(8);
    if (c.sound) beep(520, 0.04, "square", 0.03);
    up({ participants: arr, nextIndex: ni >= 0 ? ni : 0 });
  };

  const remove = (id: string) => {
    const arr = c.participants.filter((x) => x.id !== id);
    const len = c.participants.length;
    const nextId = len ? c.participants[c.nextIndex % len]?.id : undefined;
    let ni = nextId ? arr.findIndex((p) => p.id === nextId) : -1;
    if (ni < 0) ni = 0;
    if (c.haptics) vibrate([15, 30, 15]);
    up({ participants: arr, nextIndex: arr.length ? ni : 0 });
  };

  const onImport = async (file: File) => {
    try {
      const parsed = parseConfig(await file.text());
      latest.current = parsed;
      setC(parsed);
      saveConfig(parsed);
      if (c.sound) beep(880, 0.1, "sine", 0.05);
      toast.success("Configuración importada correctamente");
    } catch {
      if (c.sound) beep(180, 0.3, "sawtooth", 0.06);
      toast.error("No se pudo importar: el archivo no es válido");
    }
  };

  if (status === "loading") {
    return <main className="grid-bg min-h-[100dvh] bg-background" />;
  }

  if (status === "gate") {
    return (
      <PinGate
        expected={c.operatorPin}
        sound={c.sound}
        haptics={c.haptics}
        onOk={() => {
          openOperatorSession();
          setStatus("ok");
        }}
      />
    );
  }

  return (
    <main className="grid-bg min-h-[100dvh] bg-background px-6 py-8 text-foreground">
      <div aria-hidden="true" className="grain pointer-events-none fixed inset-[-2%] z-20" />
      <Toaster theme="dark" position="top-center" />
      <div className="mx-auto max-w-4xl space-y-8 pb-16">
        <div className="rise flex items-center justify-between gap-4">
          <h1 className="font-display text-3xl uppercase tracking-[0.2em] text-glow">
            Panel del operador
          </h1>
          <div className="flex items-center gap-4">
            <span
              aria-live="polite"
              className={`text-sm text-success transition-opacity ${saved ? "opacity-100" : "opacity-0"}`}
            >
              Guardado ✓
            </span>
            <Link
              to="/"
              className="rounded-full bg-primary px-6 py-3 font-display text-sm uppercase tracking-widest text-primary-foreground transition active:scale-95"
            >
              Ir al escáner
            </Link>
          </div>
        </div>

        <section
          className="rise grid gap-4 rounded-xl border border-border bg-card/60 p-6 md:grid-cols-2"
          style={{ animationDelay: ".05s" }}
        >
          <h2 className="font-display text-xl uppercase tracking-widest text-primary md:col-span-2">
            Instalación
          </h2>
          <L t="Nombre de la instalación">
            <input
              className={field}
              value={c.facility}
              onChange={(e) => up({ facility: e.target.value })}
            />
          </L>
          <L t="Nombre de la IA">
            <input
              className={field}
              value={c.systemName}
              onChange={(e) => up({ systemName: e.target.value })}
            />
          </L>
        </section>

        <section
          className="rise grid gap-4 rounded-xl border border-border bg-card/60 p-6 md:grid-cols-2"
          style={{ animationDelay: ".1s" }}
        >
          <h2 className="font-display text-xl uppercase tracking-widest text-primary md:col-span-2">
            Experiencia
          </h2>
          <L t="Mensaje de bienvenida (usa {nombre}, {rol}, {nivel}, {instalacion})" wide>
            <textarea
              rows={2}
              className={field}
              value={c.welcomeTemplate}
              onChange={(e) => up({ welcomeTemplate: e.target.value })}
            />
          </L>
          <L t={`Duración del escaneo: ${c.scanSeconds}s`}>
            <input
              type="range"
              min={2}
              max={15}
              value={c.scanSeconds}
              onChange={(e) => up({ scanSeconds: +e.target.value })}
              className="w-full accent-[var(--primary)]"
            />
          </L>
          <L
            t={
              c.autoResetSeconds
                ? `Reinicio automático tras conceder: ${c.autoResetSeconds}s`
                : "Reinicio automático tras conceder: desactivado"
            }
          >
            <input
              type="range"
              min={0}
              max={60}
              step={5}
              value={c.autoResetSeconds}
              onChange={(e) => up({ autoResetSeconds: +e.target.value })}
              className="w-full accent-[var(--primary)]"
            />
          </L>
          <div className="flex flex-wrap gap-4 pt-2 md:col-span-2">
            {(["voice", "haptics", "sound", "requireFullHand"] as const).map((k) => (
              <label
                key={k}
                className="flex items-center gap-3 rounded-lg border border-border bg-background/40 px-4 py-3"
              >
                <Switch checked={c[k]} onCheckedChange={(v) => up({ [k]: v })} />
                <span className="text-sm">
                  {
                    {
                      voice: "Voz de la IA",
                      haptics: "Vibración",
                      sound: "Sonidos",
                      requireFullHand: "Exigir 5 dedos",
                    }[k]
                  }
                </span>
              </label>
            ))}
          </div>
          <L t="PIN del operador (4 dígitos, opcional)" wide>
            <div className="flex gap-3">
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="Sin PIN"
                className={field}
                value={c.operatorPin}
                onChange={(e) => up({ operatorPin: e.target.value.replace(/\D/g, "").slice(0, 4) })}
              />
              {c.operatorPin && (
                <button
                  type="button"
                  onClick={() => up({ operatorPin: "" })}
                  className="shrink-0 rounded-md border border-destructive px-4 text-sm text-destructive transition active:scale-95"
                >
                  Quitar
                </button>
              )}
            </div>
            <span className="mt-1 block text-xs text-muted-foreground">
              Si defines un PIN, entrar al panel pedirá código. La sesión se recuerda 2 horas en
              este dispositivo.
            </span>
          </L>
        </section>

        <section className="rise space-y-4" style={{ animationDelay: ".15s" }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-xl uppercase tracking-widest">
              Participantes ({c.participants.length})
            </h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => exportConfig(c)}
                className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm transition active:scale-95"
              >
                <Download size={16} aria-hidden="true" /> Exportar
              </button>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-4 py-2 text-sm transition active:scale-95">
                <Upload size={16} aria-hidden="true" /> Importar
                <input
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void onImport(f);
                  }}
                />
              </label>
              <button
                type="button"
                onClick={add}
                className="inline-flex items-center gap-2 rounded-md border border-primary bg-primary/10 px-4 py-2 text-sm text-primary transition active:scale-95"
              >
                <Plus size={16} aria-hidden="true" /> Añadir
              </button>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Cada escaneo identifica al siguiente participante en orden. Próximo:{" "}
            <span className="text-primary">
              {c.participants[c.nextIndex % (c.participants.length || 1)]?.name || "—"}
            </span>
          </p>

          {c.participants.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/40 p-10 text-center">
              <p className="font-display text-lg uppercase tracking-widest text-muted-foreground">
                Sin participantes
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                Añade jugadores para que la bienvenida muestre su nombre, cargo y nivel de acceso en
                cada escaneo.
              </p>
              <button
                type="button"
                onClick={add}
                className="mt-5 inline-flex items-center gap-2 rounded-md border border-primary px-5 py-3 text-sm text-primary transition active:scale-95"
              >
                <Plus size={16} aria-hidden="true" /> Añadir participante
              </button>
            </div>
          ) : (
            c.participants.map((p, i) => {
              const isNext = i === c.nextIndex % c.participants.length;
              return (
                <div
                  key={p.id}
                  className={`grid gap-3 rounded-xl border bg-card/60 p-5 md:grid-cols-3 ${
                    isNext ? "border-primary" : "border-border"
                  }`}
                >
                  <div className="flex items-center gap-3 md:col-span-3">
                    <span className="rounded border border-primary/40 px-2 py-0.5 font-mono text-xs text-primary">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {isNext && (
                      <span className="text-xs uppercase tracking-widest text-primary">
                        Siguiente en escanear
                      </span>
                    )}
                    <span className="ml-auto flex gap-1">
                      <button
                        type="button"
                        aria-label="Mover arriba"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                        className="rounded p-2 text-muted-foreground transition hover:text-primary disabled:opacity-30"
                      >
                        <ArrowUp size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label="Mover abajo"
                        disabled={i === c.participants.length - 1}
                        onClick={() => move(i, 1)}
                        className="rounded p-2 text-muted-foreground transition hover:text-primary disabled:opacity-30"
                      >
                        <ArrowDown size={16} aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                  <L t="Nombre">
                    <input
                      className={`${field} ${!p.name.trim() ? "border-destructive" : ""}`}
                      placeholder="Nombre del participante"
                      value={p.name}
                      onChange={(e) => upP(p.id, { name: e.target.value })}
                    />
                    {!p.name.trim() && (
                      <span className="mt-1 block text-xs text-destructive">
                        Nombre obligatorio
                      </span>
                    )}
                  </L>
                  <L t="Cargo (ej. Científico jefe)">
                    <input
                      className={field}
                      placeholder="Cargo"
                      value={p.role}
                      onChange={(e) => upP(p.id, { role: e.target.value })}
                    />
                  </L>
                  <L t="Nivel de acceso">
                    <input
                      className={field}
                      placeholder="Nivel de acceso"
                      value={p.clearance}
                      onChange={(e) => upP(p.id, { clearance: e.target.value })}
                    />
                  </L>
                  <L
                    t="Información extra que se mostrará (ej. Último acceso: Sector 4, 03:12h)"
                    wide
                  >
                    <textarea
                      rows={2}
                      className={field}
                      placeholder="Detalle extra para la ficha verificada"
                      value={p.note}
                      onChange={(e) => upP(p.id, { note: e.target.value })}
                    />
                  </L>
                  <div className="flex items-center gap-4 md:col-span-3">
                    <button
                      type="button"
                      onClick={() => up({ nextIndex: i })}
                      disabled={isNext}
                      className="text-sm text-primary transition disabled:opacity-40"
                    >
                      Hacer el siguiente
                    </button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                          type="button"
                          className="ml-auto inline-flex items-center gap-1.5 text-sm text-destructive transition active:scale-95"
                        >
                          <Trash2 size={14} aria-hidden="true" /> Eliminar
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            ¿Eliminar a {p.name.trim() || "este participante"}?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Se quitará de la lista de escaneos. Esta acción no se puede deshacer.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancelar</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => remove(p.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Eliminar
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}

function L({ t, children, wide }: { t: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`space-y-2 ${wide ? "md:col-span-2" : ""}`}>
      <span className="text-xs uppercase tracking-widest text-muted-foreground">{t}</span>
      {children}
    </label>
  );
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "←"];

function PinGate({
  expected,
  sound,
  haptics,
  onOk,
}: {
  expected: string;
  sound: boolean;
  haptics: boolean;
  onOk: () => void;
}) {
  const [val, setVal] = useState("");
  const [err, setErr] = useState(false);

  const press = (d: string) => {
    if (val.length >= 4) return;
    if (sound) beep(600 + Number(d) * 30, 0.04, "square", 0.03);
    if (haptics) vibrate(8);
    const next = val + d;
    setVal(next);
    if (next.length !== 4) return;
    if (next === expected) {
      if (haptics) vibrate([15, 30, 15]);
      if (sound) beep(920, 0.12, "sine", 0.05);
      setTimeout(onOk, 200);
    } else {
      setErr(true);
      if (haptics) vibrate(200);
      if (sound) beep(180, 0.3, "sawtooth", 0.06);
      setTimeout(() => {
        setErr(false);
        setVal("");
      }, 650);
    }
  };

  return (
    <main className="grid-bg flex min-h-[100dvh] flex-col items-center justify-center gap-7 bg-background px-6 text-foreground">
      <div className="text-center">
        <p className="font-display text-sm uppercase tracking-[0.5em] text-muted-foreground">
          Acceso de operador
        </p>
        <p className="mt-3 font-display text-2xl uppercase tracking-[0.3em] text-primary text-glow">
          Introduce el PIN
        </p>
      </div>
      <div className={`flex gap-5 ${err ? "shake" : ""}`} aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full border transition ${
              err
                ? "border-destructive bg-destructive"
                : val[i]
                  ? "border-primary bg-primary"
                  : "border-primary/40"
            }`}
          />
        ))}
      </div>
      <p aria-live="polite" className={`text-sm ${err ? "text-destructive" : "opacity-0"}`}>
        PIN incorrecto
      </p>
      <div className="grid w-72 grid-cols-3 gap-3">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              if (k === "C") {
                setVal("");
                setErr(false);
              } else if (k === "←") {
                setVal((v) => v.slice(0, -1));
              } else {
                press(k);
              }
            }}
            className="h-16 rounded-lg border border-primary/40 bg-card font-display text-xl transition active:scale-95 active:bg-primary/10"
          >
            {k}
          </button>
        ))}
      </div>
      <Link
        to="/"
        className="font-display text-xs uppercase tracking-widest text-muted-foreground transition hover:text-primary"
      >
        ← Volver al escáner
      </Link>
    </main>
  );
}
