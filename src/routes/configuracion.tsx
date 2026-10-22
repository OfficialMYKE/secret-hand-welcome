import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { defaultConfig, loadConfig, newId, saveConfig, type Participant, type ScannerConfig } from "@/lib/scanner-config";

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

const field = "w-full rounded-md border border-input bg-background px-3 py-3 text-base text-foreground outline-none focus:border-primary";

function Config() {
  const [c, setC] = useState<ScannerConfig>(defaultConfig);
  const [saved, setSaved] = useState(false);
  useEffect(() => setC(loadConfig()), []);

  const up = (patch: Partial<ScannerConfig>) => {
    const n = { ...c, ...patch };
    setC(n);
    saveConfig(n);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };
  const upP = (id: string, patch: Partial<Participant>) => up({ participants: c.participants.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  return (
    <main className="grid-bg min-h-[100dvh] bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-3xl uppercase tracking-[0.2em] text-glow">Panel del operador</h1>
          <div className="flex items-center gap-4">
            <span className={`text-sm text-success transition-opacity ${saved ? "opacity-100" : "opacity-0"}`}>Guardado ✓</span>
            <Link to="/" className="rounded-full bg-primary px-6 py-3 font-display uppercase tracking-widest text-primary-foreground">Ir al escáner</Link>
          </div>
        </div>

        <section className="grid gap-4 rounded-xl border border-border bg-card/60 p-6 md:grid-cols-2">
          <L t="Nombre de la instalación"><input className={field} value={c.facility} onChange={(e) => up({ facility: e.target.value })} /></L>
          <L t="Nombre de la IA"><input className={field} value={c.systemName} onChange={(e) => up({ systemName: e.target.value })} /></L>
          <L t="Mensaje de bienvenida (usa {nombre}, {rol}, {nivel}, {instalacion})" wide>
            <textarea rows={2} className={field} value={c.welcomeTemplate} onChange={(e) => up({ welcomeTemplate: e.target.value })} />
          </L>
          <L t={`Duración del escaneo: ${c.scanSeconds}s`}>
            <input type="range" min={2} max={15} value={c.scanSeconds} onChange={(e) => up({ scanSeconds: +e.target.value })} className="w-full accent-[var(--primary)]" />
          </L>
          <div className="flex flex-wrap gap-6 pt-6">
            {(["voice", "haptics", "sound"] as const).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input type="checkbox" className="h-5 w-5 accent-[var(--primary)]" checked={c[k]} onChange={(e) => up({ [k]: e.target.checked })} />
                {{ voice: "Voz de la IA", haptics: "Vibración", sound: "Sonidos" }[k]}
              </label>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl uppercase tracking-widest">Participantes ({c.participants.length})</h2>
            <button onClick={() => up({ participants: [...c.participants, { id: newId(), name: "", role: "", clearance: "Nivel 5", note: "" }] })} className="rounded-md border border-primary px-4 py-2 text-primary">
              + Añadir
            </button>
          </div>
          <p className="text-sm text-muted-foreground">
            Cada escaneo identifica al siguiente participante en orden. Próximo: <span className="text-primary">{c.participants[c.nextIndex % (c.participants.length || 1)]?.name || "—"}</span>
          </p>
          {c.participants.map((p, i) => (
            <div key={p.id} className={`grid gap-3 rounded-xl border bg-card/60 p-5 md:grid-cols-3 ${i === c.nextIndex % c.participants.length ? "border-primary" : "border-border"}`}>
              <input className={field} placeholder="Nombre" value={p.name} onChange={(e) => upP(p.id, { name: e.target.value })} />
              <input className={field} placeholder="Cargo (ej. Científico jefe)" value={p.role} onChange={(e) => upP(p.id, { role: e.target.value })} />
              <input className={field} placeholder="Nivel de acceso" value={p.clearance} onChange={(e) => upP(p.id, { clearance: e.target.value })} />
              <textarea className={`${field} md:col-span-3`} rows={2} placeholder="Información extra que se mostrará (ej. Último acceso: Sector 4, 03:12h)" value={p.note} onChange={(e) => upP(p.id, { note: e.target.value })} />
              <div className="flex gap-3 md:col-span-3">
                <button onClick={() => up({ nextIndex: i })} className="text-sm text-primary">Hacer el siguiente</button>
                <button onClick={() => up({ participants: c.participants.filter((x) => x.id !== p.id), nextIndex: 0 })} className="text-sm text-destructive">Eliminar</button>
              </div>
            </div>
          ))}
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
