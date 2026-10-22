let ctx: AudioContext | null = null;
const ac = () => (ctx ??= new AudioContext());

export function beep(freq = 880, dur = 0.08, type: OscillatorType = "sine", vol = 0.08) {
  try {
    const a = ac();
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + dur);
  } catch {}
}

export function vibrate(p: number | number[]) {
  try {
    navigator.vibrate?.(p);
  } catch {}
}

export function speak(text: string, onEnd?: () => void) {
  try {
    const s = window.speechSynthesis;
    if (!s) return onEnd?.();
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "es-ES";
    u.rate = 0.95;
    u.pitch = 0.9;
    const v = s.getVoices().find((v) => v.lang.startsWith("es"));
    if (v) u.voice = v;
    u.onend = () => onEnd?.();
    s.speak(u);
  } catch {
    onEnd?.();
  }
}

let hum: { stop: () => void } | null = null;
export function startHum() {
  if (hum) return;
  try {
    const a = ac();
    a.resume();
    const g = a.createGain();
    g.gain.value = 0.015;
    const o1 = a.createOscillator(); o1.frequency.value = 55; o1.type = "sawtooth";
    const o2 = a.createOscillator(); o2.frequency.value = 55.7; o2.type = "sine";
    const f = a.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 220;
    o1.connect(f); o2.connect(f); f.connect(g).connect(a.destination);
    o1.start(); o2.start();
    hum = { stop: () => { o1.stop(); o2.stop(); hum = null; } };
  } catch {}
}
