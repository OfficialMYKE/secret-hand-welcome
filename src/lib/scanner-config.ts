import { z } from "zod";

export type Participant = {
  id: string;
  name: string;
  role: string;
  clearance: string;
  note: string;
};
export type ScannerConfig = {
  facility: string;
  systemName: string;
  welcomeTemplate: string;
  scanSeconds: number;
  voice: boolean;
  haptics: boolean;
  sound: boolean;
  autoResetSeconds: number;
  requireFullHand: boolean;
  operatorPin: string;
  participants: Participant[];
  nextIndex: number;
};

const KEY = "scanner-config-v1";

export const defaultConfig: ScannerConfig = {
  facility: "Laboratorio Omega-7",
  systemName: "A.R.I.A.",
  welcomeTemplate: "Bienvenido, {nombre}. Identidad confirmada. Acceso concedido.",
  scanSeconds: 5,
  voice: true,
  haptics: true,
  sound: true,
  autoResetSeconds: 0,
  requireFullHand: false,
  operatorPin: "",
  participants: [],
  nextIndex: 0,
};

const participantSchema = z.object({
  id: z.string().catch(""),
  name: z.string().catch(""),
  role: z.string().catch(""),
  clearance: z.string().catch(""),
  note: z.string().catch(""),
});

const configSchema = z.object({
  facility: z.string().catch(defaultConfig.facility),
  systemName: z.string().catch(defaultConfig.systemName),
  welcomeTemplate: z.string().catch(defaultConfig.welcomeTemplate),
  scanSeconds: z.number().min(2).max(15).catch(defaultConfig.scanSeconds),
  voice: z.boolean().catch(defaultConfig.voice),
  haptics: z.boolean().catch(defaultConfig.haptics),
  sound: z.boolean().catch(defaultConfig.sound),
  autoResetSeconds: z.number().min(0).max(120).catch(defaultConfig.autoResetSeconds),
  requireFullHand: z.boolean().catch(defaultConfig.requireFullHand),
  operatorPin: z
    .string()
    .regex(/^\d{0,4}$/)
    .catch(""),
  participants: z.array(participantSchema).catch(defaultConfig.participants),
  nextIndex: z.number().int().min(0).catch(defaultConfig.nextIndex),
});

export function loadConfig(): ScannerConfig {
  if (typeof window === "undefined") return defaultConfig;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultConfig;
    const merged = { ...defaultConfig, ...(JSON.parse(raw) as Partial<ScannerConfig>) };
    const parsed = configSchema.safeParse(merged);
    return parsed.success ? parsed.data : defaultConfig;
  } catch {
    return defaultConfig;
  }
}

export function saveConfig(c: ScannerConfig) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(configSchema.parse(c)));
}

export function parseConfig(raw: string): ScannerConfig {
  const data: unknown = JSON.parse(raw);
  const parsed = configSchema.safeParse(data);
  if (!parsed.success) throw new Error("El archivo no tiene un formato de configuración válido.");
  return parsed.data;
}

export function exportConfig(c: ScannerConfig) {
  const blob = new Blob([JSON.stringify(configSchema.parse(c), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "escaner-config.json";
  a.click();
  URL.revokeObjectURL(url);
}

export const newId = () => Math.random().toString(36).slice(2, 10);

export function fillTemplate(t: string, p: Participant | null, c: ScannerConfig) {
  return t
    .replaceAll("{nombre}", p?.name || "agente")
    .replaceAll("{rol}", p?.role || "")
    .replaceAll("{nivel}", p?.clearance || "")
    .replaceAll("{instalacion}", c.facility);
}

const SESSION_KEY = "scanner-operator-session";
const SESSION_MS = 2 * 60 * 60 * 1000;

export function operatorSessionOk(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const t = Number(sessionStorage.getItem(SESSION_KEY) ?? 0);
    return t > 0 && Date.now() - t < SESSION_MS;
  } catch {
    return false;
  }
}

export function openOperatorSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, String(Date.now()));
  } catch {
    // storage unavailable
  }
}
