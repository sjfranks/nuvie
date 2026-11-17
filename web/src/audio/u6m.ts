/**
 * u6m.ts - Ultima 6's music player (AdPlug's u6m.cpp by Marc Winterrowd): reads a song (an LZW-packed .m file) and
 * writes to an OPL2 FM chip, called 60 times a second.
 */
import { lzwFile } from '../files/lzw.ts';

export interface Opl {
  write(reg: number, val: number): void;
}

interface SubSong {
  reps: number;
  start: number;
  cont: number;
}

const FREQ_TABLE: [number, number][] = [
  [0x00, 0x00], [0x58, 0x01], [0x82, 0x01], [0xb0, 0x01], [0xcc, 0x01], [0x03, 0x02], [0x41, 0x02], [0x86, 0x02],
  [0x00, 0x00], [0x6a, 0x01], [0x96, 0x01], [0xc7, 0x01], [0xe4, 0x01], [0x1e, 0x02], [0x5f, 0x02], [0xa8, 0x02],
  [0x00, 0x00], [0x47, 0x01], [0x6e, 0x01], [0x9a, 0x01], [0xb5, 0x01], [0xe9, 0x01], [0x24, 0x02], [0x66, 0x02],
];
const CARRIER = [0x03, 0x04, 0x05, 0x0b, 0x0c, 0x0d, 0x13, 0x14, 0x15];
const MODULATOR = [0x00, 0x01, 0x02, 0x08, 0x09, 0x0a, 0x10, 0x11, 0x12];

export class U6Music {
  private readonly song: Uint8Array;
  songEnd = false;
  private pos = 0;
  private loopPos = 0;
  private delay = 0;
  private readonly instruments = new Array<number>(9).fill(0);
  private readonly freqDelta = new Int8Array(9);
  private readonly freq: { lo: number; hi: number }[] = [];
  private readonly vbValue = new Int16Array(9);
  private readonly vbAmp = new Uint8Array(9);
  private readonly vbMul = new Uint8Array(9);
  private readonly vbDir = new Uint8Array(9);
  private readonly mf = new Uint8Array(9);
  private readonly mfDelta = new Int8Array(9);
  private readonly mfDelayBackup = new Uint8Array(9);
  private readonly mfDelay = new Uint8Array(9);
  private stack: SubSong[] = [];

  constructor(
    file: Uint8Array,
    private readonly opl: Opl,
  ) {
    this.song = lzwFile(file);
    this.rewind();
  }

  rewind(): void {
    this.songEnd = false;
    this.pos = this.loopPos = this.delay = 0;
    this.stack = [];
    for (let i = 0; i < 9; i++) {
      this.freq[i] = { lo: 0, hi: 0 };
      this.freqDelta[i] = this.vbValue[i] = this.vbAmp[i] = this.vbMul[i] = this.vbDir[i] = 0;
      this.mf[i] = this.mfDelta[i] = this.mfDelay[i] = this.mfDelayBackup[i] = 0;
    }
    // A clean chip, in OPL2 mode.
    for (let r = 0x20; r <= 0xf5; r++) this.opl.write(r, 0);
    this.opl.write(0x08, 0);
    this.opl.write(0xbd, 0);
    this.opl.write(1, 32);
  }

  /** One tick (of 60 a second). Returns false once the song has come round to its loop. */
  update(): boolean {
    this.delay = Math.max(0, this.delay - 1);
    if (this.delay === 0) this.commands();
    for (let i = 0; i < 9; i++) {
      if (this.freqDelta[i] !== 0) {
        this.freqSlide(i);
        if (this.mfDelta[i] !== 0) this.mfSlide(i);
      } else {
        if (this.vbMul[i] !== 0 && (this.freq[i].hi & 0x20) === 0x20) this.vibrato(i);
        if (this.mfDelta[i] !== 0) this.mfSlide(i);
      }
    }
    return !this.songEnd;
  }

  private byte(): number {
    return this.song[this.pos++] ?? 0;
  }
  private signed(): number {
    const b = this.byte();
    return b > 127 ? b - 256 : b;
  }

  private commands(): void {
    for (let guard = 0; guard < 4096; guard++) {
      if (this.pos >= this.song.length) {
        this.songEnd = true;
        this.pos = this.loopPos;
        return;
      }
      const cmd = this.byte();
      const hi = cmd >> 4;
      const ch = cmd & 0xf;
      switch (hi) {
        case 0x0:
          this.setFreq(ch, this.expand(this.byte()));
          break;
        case 0x1: {
          this.vbDir[ch] = 0;
          this.vbValue[ch] = 0;
          const f = this.expand(this.byte());
          this.setFreq(ch, f);
          this.setFreq(ch, { lo: f.lo, hi: f.hi | 0x20 });
          break;
        }
        case 0x2: {
          const f = this.expand(this.byte());
          this.setFreq(ch, { lo: f.lo, hi: f.hi | 0x20 });
          break;
        }
        case 0x3:
          this.mfDelta[ch] = 0;
          this.setCarrierMf(ch, this.byte());
          break;
        case 0x4:
          this.opcell(ch, false, 0x40, this.byte());
          break;
        case 0x5:
          this.freqDelta[ch] = this.signed();
          break;
        case 0x6: {
          const v = this.byte();
          this.vbAmp[ch] = v >> 4;
          this.vbMul[ch] = v & 0xf;
          break;
        }
        case 0x7: {
          const o = this.instruments[this.byte()] ?? 0;
          const at = (i: number): number => this.song[o + i] ?? 0;
          [0x20, 0x40, 0x60, 0x80, 0xe0].forEach((r, i) => this.opcell(ch, false, r, at(i)));
          [0x20, 0x40, 0x60, 0x80, 0xe0].forEach((r, i) => this.opcell(ch, true, r, at(5 + i)));
          this.opl.write(0xc0 + ch, at(10));
          break;
        }
        case 0x8:
          switch (ch) {
            case 1: {
              const reps = this.byte();
              const start = this.byte() | (this.byte() << 8);
              this.stack.push({ reps, start, cont: this.pos });
              this.pos = start;
              break;
            }
            case 2:
              this.delay = this.byte();
              return;
            case 3: {
              const n = this.byte();
              this.instruments[n] = this.pos;
              this.pos += 11;
              break;
            }
            case 5:
            case 6: {
              const v = this.byte();
              const c = v >> 4;
              this.mfDelta[c] = ch === 5 ? 1 : -1;
              this.mfDelay[c] = this.mfDelayBackup[c] = (v & 0xf) + 1;
              break;
            }
          }
          break;
        case 0xe:
          this.loopPos = this.pos;
          break;
        case 0xf: {
          const top = this.stack.pop();
          if (top) {
            top.reps--;
            if (top.reps === 0) this.pos = top.cont;
            else {
              this.pos = top.start;
              this.stack.push(top);
            }
          } else {
            this.pos = this.loopPos;
            this.songEnd = true;
          }
          break;
        }
      }
    }
  }

  private expand(b: number): { lo: number; hi: number } {
    let packed = b & 0x1f;
    if (packed >= 24) packed = 0;
    return { lo: FREQ_TABLE[packed][0], hi: (FREQ_TABLE[packed][1] + ((b >> 5) << 2)) & 0xff };
  }

  private setFreq(ch: number, f: { lo: number; hi: number }, keep = true): void {
    this.opl.write(0xa0 + ch, f.lo);
    this.opl.write(0xb0 + ch, f.hi);
    if (keep) this.freq[ch] = f;
  }

  private setCarrierMf(ch: number, v: number): void {
    this.opcell(ch, true, 0x40, v);
    this.mf[ch] = v;
  }

  private freqSlide(ch: number): void {
    const f = this.freq[ch];
    const w = (f.lo + (f.hi << 8) + this.freqDelta[ch] + 0x10000) & 0xffff;
    this.setFreq(ch, { lo: w & 0xff, hi: w >> 8 });
  }

  private vibrato(ch: number): void {
    if (this.vbValue[ch] >= this.vbAmp[ch]) this.vbDir[ch] = 1;
    else if (this.vbValue[ch] <= 0) this.vbDir[ch] = 0;
    this.vbValue[ch] += this.vbDir[ch] === 0 ? 1 : -1;
    const f = this.freq[ch];
    const w = (f.lo + (f.hi << 8) + (this.vbValue[ch] - (this.vbAmp[ch] >> 1)) * this.vbMul[ch] + 0x10000) & 0xffff;
    this.setFreq(ch, { lo: w & 0xff, hi: w >> 8 }, false);
  }

  private mfSlide(ch: number): void {
    this.mfDelay[ch]--;
    if (this.mfDelay[ch] !== 0) return;
    this.mfDelay[ch] = this.mfDelayBackup[ch];
    let v = this.mf[ch] + this.mfDelta[ch];
    if (v > 0x3f) {
      v = 0x3f;
      this.mfDelta[ch] = 0;
    } else if (v < 0) {
      v = 0;
      this.mfDelta[ch] = 0;
    }
    this.setCarrierMf(ch, v);
  }

  private opcell(ch: number, carrier: boolean, reg: number, v: number): void {
    this.opl.write(reg + (carrier ? CARRIER[ch] : MODULATOR[ch]), v);
  }
}
