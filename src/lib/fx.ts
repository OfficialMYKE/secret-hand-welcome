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
  } catch {
    // best effort
  }
}

export function vibrate(p: number | number[]) {
  try {
    navigator.vibrate?.(p);
  } catch {
    // best effort
  }
}

let voices: SpeechSynthesisVoice[] = [];

function refreshVoices() {
  try {
    voices = window.speechSynthesis?.getVoices() ?? [];
  } catch {
    voices = [];
  }
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  refreshVoices();
  try {
    window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
  } catch {
    // best effort
  }
}

export function speak(text: string, onEnd?: () => void, onProgress?: (chars: number) => void) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    onEnd?.();
  };
  try {
    const s = window.speechSynthesis;
    if (!s) return finish();
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "es-ES";
    u.rate = 0.95;
    u.pitch = 0.9;
    if (!voices.length) refreshVoices();
    const v = voices.find((voice) => voice.lang.toLowerCase().startsWith("es"));
    if (v) u.voice = v;
    if (onProgress) {
      u.onboundary = (e) => {
        if (typeof e.charIndex === "number" && e.charIndex > 0) onProgress(e.charIndex);
      };
    }
    u.onend = finish;
    u.onerror = finish;
    s.speak(u);
    // Some engines never fire onend when the utterance is interrupted.
    setTimeout(finish, 2000 + text.length * 100);
  } catch {
    finish();
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
    const o1 = a.createOscillator();
    o1.frequency.value = 55;
    o1.type = "sawtooth";
    const o2 = a.createOscillator();
    o2.frequency.value = 55.7;
    o2.type = "sine";
    const f = a.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 220;
    o1.connect(f);
    o2.connect(f);
    f.connect(g).connect(a.destination);
    o1.start();
    o2.start();
    hum = {
      stop: () => {
        o1.stop();
        o2.stop();
        hum = null;
      },
    };
  } catch {
    // best effort
  }
}

export function stopHum() {
  try {
    hum?.stop();
  } catch {
    // best effort
  }
}

type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener?: (type: string, listener: () => void) => void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
};

let wakeSentinel: WakeLockSentinelLike | null = null;

export function keepAwake() {
  if (typeof window === "undefined") return;
  const nav = navigator as NavigatorWithWakeLock;
  if (!nav.wakeLock) return;
  const request = async () => {
    if (wakeSentinel) return;
    try {
      wakeSentinel = await nav.wakeLock.request("screen");
      wakeSentinel.addEventListener?.("release", () => {
        wakeSentinel = null;
      });
    } catch {
      // best effort
    }
  };
  void request();
  try {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void request();
    });
  } catch {
    // best effort
  }
}

/** Filtered noise sweep — sounds like a laser/optical sensor pass. */
export function sweep(dur = 0.6, from = 400, to = 3200, vol = 0.04) {
  try {
    const a = ac();
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 8;
    f.frequency.setValueAtTime(from, a.currentTime);
    f.frequency.exponentialRampToValueAtTime(to, a.currentTime + dur);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, a.currentTime);
    g.gain.exponentialRampToValueAtTime(vol, a.currentTime + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
    src.connect(f).connect(g).connect(a.destination);
    src.start();
  } catch {
    // best effort
  }
}
