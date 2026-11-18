/**
 * opl.ts - the FM synthesiser the music is played on: DOSBox's OPL emulator, compiled to WebAssembly
 * (@malvineous/opl, GPL-3.0). In the browser its two files are served from ./opl/ (copied there by
 * tools/copy-opl.mjs) and loaded with a script tag; the emulator then makes samples on demand.
 */

export interface OplChip {
  write(reg: number, val: number): void;
  /** `n` stereo samples (at most 512), 16 bits each, interleaved. */
  generate(n: number): Int16Array;
}

interface EmModule {
  OPL: new (rate: number, channels: number, bufBytes: number) => { write(r: number, v: number): void; generate(n: number): void; getBuffer(): Int16Array };
}

let loading: Promise<(o: object) => Promise<EmModule>> | null = null;

function loadFactory(): Promise<(o: object) => Promise<EmModule>> {
  loading ??= new Promise((resolve, reject) => {
    const w = window as unknown as { opl?: (o: object) => Promise<EmModule> };
    if (w.opl) return resolve(w.opl);
    const s = document.createElement('script');
    s.src = './opl/opl.js';
    s.onload = () => (w.opl ? resolve(w.opl) : reject(new Error('no OPL emulator')));
    s.onerror = () => reject(new Error('could not load the OPL emulator'));
    document.head.append(s);
  });
  return loading;
}

/** A chip at the given sample rate. `factory` stands in for the browser's loader (tests pass Node's). */
export async function createOpl(rate: number, factory?: (o: object) => Promise<EmModule>, dir = './opl/'): Promise<OplChip> {
  const make = factory ?? (await loadFactory());
  // The module is itself "thenable" (an old Emscripten build): awaited, it would resolve to itself for ever. Taken
  // through .then once, it is stripped of that before going on.
  const Module = await new Promise<EmModule>((resolve) => {
    const m = make({ locateFile: (p: string) => `${dir}${p}` }) as unknown as { then(f: (m: EmModule) => void): void };
    m.then((mod) => {
      delete (mod as { then?: unknown }).then;
      resolve(mod);
    });
  });
  const chip = new Module.OPL(rate, 2, 512 * 2 * 2);
  const buf = chip.getBuffer();
  return {
    write: (r, v) => chip.write(r, v),
    generate: (n) => {
      // The chip will not make fewer than two samples at a call; for one, it makes two and the second is let go.
      chip.generate(Math.max(2, n));
      return new Int16Array(buf.buffer, buf.byteOffset, n * 2);
    },
  };
}
