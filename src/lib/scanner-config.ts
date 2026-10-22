export type Participant = { id: string; name: string; role: string; clearance: string; note: string };
export type ScannerConfig = {
  facility: string;
  systemName: string;
  welcomeTemplate: string;
  scanSeconds: number;
  voice: boolean;
  haptics: boolean;
  sound: boolean;
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
  participants: [],
  nextIndex: 0,
};

export function loadConfig(): ScannerConfig {
  if (typeof window === "undefined") return defaultConfig;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...defaultConfig, ...JSON.parse(raw) } : defaultConfig;
  } catch {
    return defaultConfig;
  }
}

export function saveConfig(c: ScannerConfig) {
  localStorage.setItem(KEY, JSON.stringify(c));
}

export const newId = () => Math.random().toString(36).slice(2, 10);

export function fillTemplate(t: string, p: Participant | null, c: ScannerConfig) {
  return t
    .replaceAll("{nombre}", p?.name || "agente")
    .replaceAll("{rol}", p?.role || "")
    .replaceAll("{nivel}", p?.clearance || "")
    .replaceAll("{instalacion}", c.facility);
}
