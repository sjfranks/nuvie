/**
 * midi.ts - Martian Dreams' and Savage Empire's music: Origin's MIDI songs (.lzc libraries of MThd files) played as
 * Nuvie plays them - adplug's mid.cpp reading the tracks, OriginFXAdLibDriver.cpp turning notes into the FM chip's
 * registers with the game's own instruments (md.tim, savage.tim), its vibrato and slides run 60 times a second.
 */
import type { OplChip } from './opl.ts';

const s8 = (v: number): number => ((v & 0xff) << 24) >> 24;
const s16 = (v: number): number => ((v & 0xffff) << 16) >> 16;
const div = (a: number, b: number): number => Math.trunc(a / b);

const BD_CMD = [0, 1, 0, 1, 0, 1, 16, 8, 4, 2, 1];
const FNUM = [0x1e5, 0x202, 0x220, 0x241, 0x263, 0x287, 0x2ae, 0x2d7, 0x302, 0x330, 0x360, 0x393, 0x3ca];
const OP = [0, 1, 2, 8, 9, 0xa, 0x10, 0x11, 0x12, 0, 1, 2, 8, 9, 0xa, 0x10, 0x14, 0x12, 0x15, 0x11];
const OP1 = [3, 4, 5, 0xb, 0xc, 0xd, 0x13, 0x14, 0x15, 3, 4, 5, 0xb, 0xc, 0xd, 0x13, 0x14, 0x12, 0x15, 0x11];
const SLIDE = [24, 0, 18, 20, 22, 0, 0, 0];

interface Voice {
  channel: number;
  note: number;
  state: number;
  vibrato: number;
  vibPhase: number;
  slide: number;
  base: number;
  /** Offset of its instrument in the .tim data, or -1. */
  tim: number;
}

/** OriginFXAdLibDriver: instruments are 48-byte records in the .tim file, found by program number. */
class OriginFX {
  private readonly voices: Voice[] = [];
  private active = 9;
  private readonly chanTim = new Int32Array(32);
  private readonly chanVibRate = new Uint8Array(32);
  private readonly chanVibDepth = new Int16Array(32);
  private readonly chanPitch = new Int16Array(32);
  private readonly chanVolume = new Int16Array(29).fill(0x100);
  private readonly free = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 0xb, 0xff, 0xff, 0, 0xc]);
  private bd = 0;
  private readonly records: number;

  constructor(private readonly opl: OplChip, private readonly tim: Uint8Array) {
    this.records = tim[0];
    this.tim = tim.subarray(1);
    for (let i = 0; i < 11; i++) this.voices.push({ channel: -1, note: -1, state: 1, vibrato: 0, vibPhase: 0, slide: 0, base: 0, tim: -1 });
    this.init();
    const programs: [number, number][] = [[9, 0x80], [10, 0x72], [11, 0x83], [12, 0x71], [13, 0x86], [14, 0x87], [15, 0x85], [16, 0x84],
      [17, 0x81], [18, 0x88], [19, 0x8d], [20, 0x8f], [21, 0x90], [22, 0x91], [23, 0x93], [24, 0x8c], [25, 0x8b]];
    for (const [c, p] of programs) this.programChange(c, p);
  }

  init(): void {
    for (let i = 0; i < 256; i++) this.opl.write(i, 0);
    this.opl.write(0x01, 0x20);
    this.opl.write(0xbd, 0);
    this.opl.write(0x08, 0);
  }

  private w(r: number, v: number): void {
    this.opl.write(r & 0xff, v & 0xff);
  }
  private t(off: number, i: number): number {
    return this.tim[off + i] ?? 0;
  }
  private t16(off: number, i: number): number {
    return s16(this.t(off, i) | (this.t(off, i + 1) << 8));
  }
  private timFor(program: number): number {
    for (let i = 0; i < this.records; i++) if (this.tim[i * 48 + 0x2f] === program) return i * 48;
    return 0;
  }
  private op(v: number): number {
    return OP[this.active < 9 ? v + 9 : v];
  }
  private op1(v: number): number {
    return OP1[this.active < 9 ? v + 9 : v];
  }

  /** sub_60D: a pitch (semitone and fraction, 256 to a semitone) as the chip's block and frequency number. */
  private freq(val: number): number {
    val = s16(val);
    const semis = div(val, 256);
    let block = div(semis + 6, 12) - 2;
    block = Math.max(0, Math.min(7, block));
    let f = FNUM[(semis + 6) % 12];
    if ((val & 0xff) !== 0) f += div((FNUM[((semis - 18) % 12) + 1] - f) * (val & 0xff), 256);
    return ((block << 10) + f) & 0xffff;
  }

  programChange(channel: number, program: number): void {
    const tim = this.timFor(program);
    for (let i = 0; i < 11; i++) {
      if (this.voices[i].channel === channel) {
        this.playNote(channel, this.voices[i].note, 0);
        this.voices[i].channel = -1;
        this.voices[i].tim = -1;
      }
    }
    this.chanTim[channel] = tim;
    this.chanVibRate[channel] = this.t(tim, 0x10);
    this.chanVibDepth[channel] = this.t(tim, 0x11);
    if (this.t(tim, 0xb) !== 0 && this.active === 9) {
      // A percussion instrument: the chip's rhythm mode, three voices given to drums.
      this.w(0xa6, 0);
      this.w(0xb6, 0);
      this.w(0xa7, 0);
      this.w(0xb7, 0xa);
      this.w(0xa8, 0x54);
      this.w(0xb8, 0x9);
      this.active = 6;
      for (let i = 6; i < 9; i++) {
        for (let j = 0; j < 13; j++) {
          if (this.free[j] === i) {
            this.free[j] = this.free[i];
            this.free[i] = 0xff;
            break;
          }
        }
      }
      this.bd = 0x20;
      this.w(0xbd, this.bd);
    }
  }

  pitchBend(channel: number, lsb: number, msb: number): void {
    const tim = this.chanTim[channel];
    this.chanPitch[channel] = div(s16((msb << 7) + lsb - 8192) * this.t(tim, 0xe), 256);
    for (let i = 0; i < this.active; i++) {
      const v = this.voices[i];
      if (v.state > 1 && v.channel === channel) {
        const fine = v.tim >= 0 ? this.t16(v.tim, 0x24) : 0;
        const f = (this.freq(v.base + this.chanPitch[channel] + v.slide + v.vibrato + fine) + 0x2000) & 0xffff;
        this.w(0xa0 + i, f & 0xff);
        this.w(0xb0 + i, f >> 8);
      }
    }
  }

  controlChange(channel: number, fn: number, value: number): void {
    let c = channel;
    if (c === 9) {
      for (c = 10; c <= 25; c++) this.controlChange(c, fn, value);
      c = 9;
    }
    if (fn === 1) this.chanVibDepth[channel] = s16(div(this.t(this.chanTim[channel], 0xf) * value, 128) + this.t(this.chanTim[channel], 0x11));
    else if (fn === 7) this.chanVolume[c] = value + 128;
    else if (fn === 0x7b) {
      let rhythmVoice = false;
      for (let i = 0; i < 0xb; i++) {
        if (this.voices[i].state > 1) {
          if (this.voices[i].channel === channel) this.playNote(channel, this.voices[i].note, 0);
          else if (i >= this.active) rhythmVoice = true;
        }
      }
      if (rhythmVoice && this.active < 9) {
        this.w(0xbd, 0);
        this.active = 9;
        this.free[6] = 7;
        this.free[7] = 8;
        this.free[8] = this.free[0xb];
        this.free[0xb] = 6;
      }
    } else if (fn === 0x79) {
      this.controlChange(channel, 1, 0);
      this.controlChange(channel, 7, 0x7f);
      this.pitchBend(channel, 0, 0x40);
    }
  }

  playNote(channel: number, note: number, velocity: number): void {
    note = s8(note);
    for (let tim = this.chanTim[channel]; ; tim += 48) {
      const voice = this.allocate(channel, note, velocity, tim);
      const reg = voice > 8 ? 0x11 - voice : voice;
      if (voice >= 0) {
        const fine = this.t16(tim, 0x24);
        const v = this.voices[voice];
        if (velocity !== 0) {
          v.vibrato = 0;
          v.vibPhase = 0;
          v.slide = this.t16(tim, 0x12);
        }
        const cl = s8(this.t(tim, 0x27));
        v.base = cl < 0 ? s16(div(-((note - 60) * 256), 1 << -(cl + 1)) + 0x3c00) : s16(div((note - 60) * 256, 1 << cl) + 0x3c00);
        let f = this.freq(v.base + this.chanPitch[channel] + v.slide + v.vibrato + fine);
        if (velocity === 0) {
          if (voice < this.active || voice <= 6) {
            this.w(0xa0 + reg, f & 0xff);
            this.w(0xb0 + reg, f >> 8);
          } else this.bd &= ~BD_CMD[voice];
        } else {
          let lvl = this.t(tim, 6);
          if (this.t(tim, 0xc) !== 0 || this.chanVolume[channel] < 0x100) {
            let di = div(63 - velocity, 1 << (7 - this.t(tim, 0xc))) + (lvl & 0x3f);
            const ax = div((0x3f - di) * this.chanVolume[channel], 256);
            di = Math.max(0, Math.min(0x3f, 0x3f - ax));
            this.w(0x40 + this.op1(voice), (lvl & 0xc0) + di);
          }
          lvl = this.t(tim, 1);
          if (this.t(tim, 0xd) !== 0) {
            const di = Math.max(0, Math.min(0x3f, div(0x3f - velocity, 1 << (7 - this.t(tim, 0xd))) + (lvl & 0x3f)));
            this.w(0x40 + this.op(voice), (lvl & 0xc0) + di);
          }
          if (this.t(tim, 0xb) === 0 || voice === 6) {
            if (this.t(tim, 0xb) === 0) f = (f + 0x2000) & 0xffff;
            this.w(0xa0 + reg, f & 0xff);
            this.w(0xb0 + reg, f >> 8);
          }
          if (this.t(tim, 0xb) !== 0) this.bd |= BD_CMD[voice];
        }
        if (this.t(tim, 0xb) !== 0) this.w(0xbd, this.bd);
      }
      if (this.t(tim, 0x26) === 0) break;
    }
  }

  /** sub_4BF: a voice for a note - the one playing it (note off), or a free one (note on). */
  private allocate(channel: number, note: number, velocity: number, tim: number): number {
    let si = -1;
    if (this.active >= 9 || this.t(tim, 0xb) === 0) {
      if (velocity === 0) {
        for (si = 0; si < this.active; si++) {
          const v = this.voices[si];
          if (v.state > 1 && v.note === note && v.channel === channel && v.tim === tim) {
            v.state = 0;
            this.release(si);
            this.take(si, 0xb);
            break;
          }
        }
        if (si === this.active) si = -1;
      } else {
        if (this.free[0xb] === 0xb) {
          if (this.chanTim[channel] === tim) {
            si = this.free[0xc];
            this.free[0xc] = this.free[si];
            this.take(si, 0xc);
            this.w(0xa0 + si, 0);
            this.w(0xb0 + si, 0);
          }
        } else {
          si = this.free[0xb];
          this.free[0xb] = this.free[si];
          this.take(si, 0xc);
        }
        if (si >= 0 && si < 11) {
          this.voices[si].state = 2;
          this.voices[si].note = note;
        } else si = -1;
      }
    } else {
      si = this.t(tim, 0xb);
      this.bd &= ~BD_CMD[si];
      this.w(0xbd, this.bd);
    }
    if (si >= 0) {
      const v = this.voices[si];
      if (v.channel !== channel || v.tim !== tim) {
        this.writeInstrument(si, tim);
        v.channel = channel;
        v.tim = tim;
      }
    }
    return si;
  }

  private release(voice: number): void {
    for (let i = 0; i < 0xd; i++) {
      if (this.free[i] === voice) {
        this.free[i] = this.free[voice];
        this.free[voice] = voice;
      }
    }
  }
  private take(voice: number, val: number): void {
    for (let i = 0; i < 0xd; i++) {
      if (this.free[i] === val) {
        this.free[i] = voice;
        this.free[voice] = val;
        break;
      }
    }
  }

  private writeInstrument(voice: number, tim: number): void {
    const a = this.op(voice);
    const b = this.op1(voice);
    let p = tim;
    for (const r of [0x20, 0x40, 0x60, 0x80, 0xe0]) this.w(r + a, this.t(p++, 0));
    if (this.active === 9 || this.t(tim, 0xb) < 7) {
      for (const r of [0x20, 0x40, 0x60, 0x80, 0xe0]) this.w(r + b, this.t(p++, 0));
      this.w(0xc0 + voice, this.t(p++, 0));
    }
  }

  /** interrupt_vector: 60 times a second, the slides and vibrato of the notes sounding. */
  interrupt(): void {
    for (let i = 0; i < this.active; i++) {
      const v = this.voices[i];
      const ch = v.channel;
      if (ch < 0 || ch >= 32) continue;
      const step = SLIDE[v.state] ?? 0;
      const tim = v.tim < 0 ? 0 : v.tim;
      const fine = v.tim < 0 ? 0 : this.t16(tim, 0x24);
      let update = false;
      if (step !== 0) {
        const rate = this.t16(tim, step * 2 - 16);
        const target = this.t16(tim, (step + 1) * 2 - 16);
        const gap = target > v.slide ? target - v.slide : v.slide - target;
        if (gap >= rate) v.slide = s16(v.slide >= target ? v.slide - rate : v.slide + rate);
        else {
          v.slide = target;
          v.state++;
        }
        update = true;
      }
      if (this.chanVibRate[ch] !== 0) {
        v.vibPhase = (v.vibPhase + this.chanVibRate[ch]) & 0xff;
        let ph = s8(v.vibPhase);
        if (ph > 63 || ph < -64) ph = s8(-128 - ph);
        v.vibrato = s16(div(this.chanVibDepth[ch] * ph, 16));
        update = true;
      }
      if (update || fine !== 0) {
        let f = this.freq(v.base + this.chanPitch[ch] + v.slide + v.vibrato + fine);
        if (v.state > 1) f = (f + 0x2000) & 0xffff;
        this.w(0xa0 + i, f & 0xff);
        this.w(0xb0 + i, f >> 8);
      }
    }
  }
}

const DRUM_CHAN = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10,
  10, 18, 11, 0, 12, 13, 17, 13, 16, 13, 14, 13, 13, 15, 13, 19, 0, 0, 0, 0, 21, 0, 0, 0, 26, 26, 25, 20, 20, 0, 0, 21, 21, 22, 23,
  0, 0, 24, 0, 20, 0];
const DRUM_NOTE = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 48,
  48, 48, 48, 0, 48, 42, 71, 42, 71, 47, 71, 47, 52, 79, 52, 77, 0, 0, 0, 0, 71, 0, 0, 0, 72, 79, 79, 64, 58, 0, 0, 89, 84, 48, 72,
  0, 0, 36, 0, 96, 0];

interface Track {
  on: boolean;
  start: number;
  end: number;
  pos: number;
  wait: number;
  status: number;
}

/** CmidPlayer: a type-1 MIDI file's tracks, each event as it falls due. */
export class MidiSong {
  private readonly fx: OriginFX;
  private readonly tracks: Track[] = [];
  private pos = 0;
  private division = 250;
  private tempo = 500000;
  private wait = 0;
  private hz = 50;
  private first = true;

  constructor(private readonly data: Uint8Array, opl: OplChip, tim: Uint8Array) {
    this.fx = new OriginFX(opl, tim);
    this.rewind();
  }

  private at(p: number): number {
    return p >= 0 && p < this.data.length ? this.data[p] : 0;
  }
  private next(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + this.at(this.pos++);
    return v;
  }
  private varLen(): number {
    let b = this.next(1);
    let v = b & 0x7f;
    while (b & 0x80) {
      b = this.next(1);
      v = (v << 7) + (b & 0x7f);
    }
    return v;
  }

  rewind(): void {
    this.tracks.length = 0;
    this.pos = 0;
    this.tempo = 500000;
    this.next(1);
    this.next(9);
    const count = this.next(2);
    this.division = this.next(2) || 250;
    for (let i = 0; i < count && i < 16; i++) {
      this.next(4);
      const len = this.next(4);
      const start = this.pos;
      this.tracks.push({ on: true, start, end: start + len, pos: start, wait: 0, status: 0 });
      this.pos = start + len;
    }
    this.first = true;
    this.fx.init();
  }

  /** Times a second the next update is wanted. */
  get refresh(): number {
    return Math.max(0.01, this.hz);
  }

  interrupt(): void {
    this.fx.interrupt();
  }

  /** Play what is due; false when the song has ended. */
  update(): boolean {
    if (this.first) {
      for (const t of this.tracks) {
        this.pos = t.pos;
        t.wait += this.varLen();
        t.pos = this.pos;
      }
      this.first = false;
    }
    let ret = true;
    this.wait = 0;
    while (this.wait === 0 && ret) {
      for (const t of this.tracks) {
        if (!t.on || t.wait !== 0 || t.pos >= t.end) continue;
        this.pos = t.pos;
        let v = this.next(1);
        if (v < 0x80) {
          v = t.status;
          this.pos--;
        } else if (v >= 0xf0 && v < 0xf9) t.status = 0;
        else if (v < 0xf0) t.status = v;
        const c = v & 0x0f;
        switch (v & 0xf0) {
          case 0x80: {
            const note = this.next(1);
            this.next(1);
            this.fx.playNote(c, note, 0);
            break;
          }
          case 0x90: {
            const note = this.next(1);
            const vel = this.next(1);
            if (c === 9) {
              if (DRUM_CHAN[note]) this.fx.playNote(DRUM_CHAN[note] - 1, DRUM_NOTE[note], vel);
            } else this.fx.playNote(c, note, vel);
            break;
          }
          case 0xa0:
            this.next(2);
            break;
          case 0xb0: {
            const ctrl = this.next(1);
            const val = this.next(1);
            this.fx.controlChange(c, ctrl, val);
            break;
          }
          case 0xc0:
            this.fx.programChange(c, this.next(1));
            break;
          case 0xd0:
            this.next(1);
            break;
          case 0xe0: {
            const lsb = this.next(1);
            const msb = this.next(1);
            this.fx.pitchBend(c, lsb, msb);
            break;
          }
          case 0xf0:
            if (v === 0xf0 || v === 0xf7) {
              const l = this.varLen();
              const tail = this.at(this.pos + l) === 0xf7;
              this.pos += l;
              if (tail) this.next(1);
            } else if (v === 0xf2) this.next(2);
            else if (v === 0xf3) this.next(1);
            else if (v === 0xfe) {
              const i = this.next(1);
              this.next(2);
              if (i !== 3) this.fx.controlChange(c, 0x7b, 0);
            } else if (v === 0xff) {
              const kind = this.next(1);
              const l = this.varLen();
              if (kind === 0x51) this.tempo = this.next(l);
              else this.pos += l;
            }
            break;
        }
        t.wait = this.pos < t.end ? this.varLen() : 0;
        t.pos = this.pos;
      }
      ret = this.tracks.some((t) => t.on && t.pos < t.end);
      this.wait = 0;
      if (ret) {
        this.wait = 0xffffff;
        for (const t of this.tracks) if (t.on && t.pos < t.end && t.wait < this.wait) this.wait = t.wait;
      }
    }
    if (this.wait !== 0 && ret) {
      for (const t of this.tracks) if (t.on) t.wait -= this.wait;
      this.hz = 1 / ((this.wait / this.division) * (this.tempo / 1000000));
    } else this.hz = 50;
    return ret;
  }
}
