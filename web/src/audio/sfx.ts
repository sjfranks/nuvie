/**
 * sfx.ts - Ultima 6's sound effects as its PC speaker made them (Nuvie's PCSpeakerSfxManager.cpp and
 * PCSpeakerStream.cpp): square-wave tones held, swept, scattered at random, or switched on and off fast enough that
 * the switching is the note. Each is made as a buffer of samples and played once.
 */
export type SfxId =
  | 'blocked' | 'success' | 'failure' | 'swing' | 'hit' | 'cast1' | 'cast2' | 'kallor' | 'death' | 'quake' | 'hail' | 'bell';

const R = 22050;
const AMP = 0.18;

class Builder {
  readonly out: number[] = [];
  private phase = 0;
  private level = AMP;

  /** `n` samples of a square wave at `f` Hz (0 for silence). */
  tone(f: number, n: number): void {
    for (let i = 0; i < n; i++) {
      if (f <= 0) {
        this.out.push(0);
        continue;
      }
      this.phase += f / R;
      if (this.phase >= 0.5) {
        this.phase -= 0.5;
        this.level = -this.level;
      }
      this.out.push(this.level);
    }
  }

  /** PCSpeakerFreqStream */
  freq(f: number, d: number): void {
    this.tone(f, Math.round((d * R) / 1255));
  }

  /** PCSpeakerSweepFreqStream */
  sweep(start: number, end: number, d: number, s: number): void {
    const steps = Math.floor(d / s);
    const step = ((end - start) * s) / d;
    const per = Math.max(1, Math.round(s * R * 0.000879533));
    for (let k = 0; k < steps; k++) this.tone(start + step * k, per);
  }

  /** PCSpeakerRandomStream, with the original's own scatter of pitches. */
  random(base: number, d: number, s: number): void {
    let r = 0x7664;
    const next = (): number => {
      r = (r + 0x9248) & 0xffff;
      r = ((r >> 3) + ((r & 7) << 13)) ^ 0x9248;
      r = (r + 0x11) & 0xffff;
      return (r % (base - 0x64 + 1)) + 0x64;
    };
    const steps = Math.floor(d / s);
    const per = Math.max(1, Math.round((s * R) / 16000));
    for (let k = 0; k <= steps; k++) this.tone(next(), per);
  }

  /** PCSpeakerStutterStream: the speaker switched on and off; the switching is the sound. */
  stutter(a0: number, a2: number, a4: number, a6: number, a8: number): void {
    let dx = 0;
    const per = Math.max(1, Math.round(a6));
    for (let cx = a4; cx > 0; cx--) {
      dx = (dx + a8) & 0xffff;
      const v = dx > a2 ? AMP : -AMP;
      for (let i = 0; i < per; i++) this.out.push(v);
      a2 = (a2 + a0) & 0xffff;
    }
  }
}

const rnd = (n: number): number => Math.floor(Math.random() * n);

export function makeSfx(id: SfxId, circle = 1): Float32Array {
  const b = new Builder();
  switch (id) {
    case 'blocked':
      b.freq(311, 0xa);
      break;
    case 'success':
      b.freq(2000, 0xa);
      break;
    case 'failure':
      b.sweep(800, 2000, 50, 1);
      break;
    case 'swing':
      b.sweep(400, 750, 150, 5);
      break;
    case 'hit':
      b.random(0x2710, 0x320, 1);
      break;
    case 'cast1':
      b.random(0x2bc, 0x640 * circle + 0x1f40, 0x320);
      break;
    case 'cast2': {
      const a = [3, 2, 2, 2, 1, 1, 1, 1, 1];
      const b2 = [0xa8c, 0xbb8, 0x3e8, 0x64, 0x1388, 0xfa0, 0x9c4, 0x3e8, 1];
      const c = [0x7fbc, 0x7918, 0x9088, 0xafc8, 0x7918, 0x84d0, 0x8e94, 0x9858, 0xa410];
      const d = [0x226a, 0x1e96, 0x1b94, 0x1996, 0x173e, 0x15c2, 0x143c, 0x12d4, 0x1180];
      b.stutter(a[circle], b2[circle], circle * 0xfa0 + 0x2710, 1, d[circle]);
      b.stutter(-a[circle], c[circle], circle * 0xfa0 + 0x2710, 1, d[circle]);
      break;
    }
    case 'kallor':
      for (let i = 0; i < 0x32; i++) b.stutter((0x32 - i) << 2, 0x2710 - (i << 6), 0x3e8, 1, (i << 4) + 0x320);
      b.stutter(8, 0, 0x1f40, 1, 0x640);
      break;
    case 'death':
      for (const t of [0x12c, 0x119, 0x12c, 0xfa, 0x119, 0xde, 0xfa, 0xfa]) b.stutter(3, 1, 0x4e20, 1, t);
      break;
    case 'quake':
      for (let i = 0; i < 0x28; i++) b.freq(rnd(0xb5) + 0x13, 8);
      break;
    case 'hail':
      for (let i = 0; i < 0x28; i++) b.freq(rnd(0x28) + 0x20, 8);
      break;
    case 'bell':
      b.stutter(-1, 0x4e20, 0x3e80, 1, 0x7d0);
      break;
  }
  return Float32Array.from(b.out);
}

/** Plays effects through an audio context (the music's). */
export class Sfx {
  enabled = true;
  private last = new Map<string, number>();

  constructor(private readonly ctx: () => AudioContext | null) {}

  play(id: SfxId, circle = 1): void {
    const ctx = this.ctx();
    if (!ctx || !this.enabled || ctx.state !== 'running') return;
    // The same sound twice at once is one sound.
    const now = performance.now();
    if ((this.last.get(id) ?? 0) > now - 60) return;
    this.last.set(id, now);
    const data = makeSfx(id, circle);
    const buf = ctx.createBuffer(1, data.length, R);
    buf.getChannelData(0).set(data);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
  }
}
