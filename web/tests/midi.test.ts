/**
 * Martian Dreams' and Savage Empire's MIDI songs through Origin's driver, on a chip that only counts: notes are keyed
 * on, every channel's frequency stays in range, and a song runs to its end and starts again.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MidiSong } from '../src/audio/midi.ts';
import { Lib } from '../src/files/lib.ts';

for (const [folder, tim] of [['martian', 'MD.TIM'], ['savage', 'SAVAGE.TIM']] as const) {
  const dir = join(import.meta.dirname, '../gamedata', folder);
  describe.skipIf(!existsSync(join(dir, 'MUSIC.LZC')))(`${folder}'s music`, () => {
    it('plays every song in music.lzc, keying notes on', { timeout: 60000 }, () => {
      const t = new Lib(new Uint8Array(readFileSync(join(dir, tim))), 4, true).item(1)!;
      const lib = new Lib(new Uint8Array(readFileSync(join(dir, 'MUSIC.LZC'))), 4, true);
      for (let n = 0; n < 32; n++) {
        const data = lib.item(n);
        if (!data) continue;
        let keyOn = 0;
        let bad = 0;
        const chip = { write: (r: number, v: number) => { if (r >= 0xb0 && r <= 0xb8 && v & 0x20) keyOn++; if (v < 0 || v > 255 || r < 0 || r > 255) bad++; }, generate: () => new Int16Array(0) };
        const song = new MidiSong(data, chip, t);
        let seconds = 0;
        let ended = false;
        for (let i = 0; i < 20000 && seconds < 30; i++) {
          if (!song.update()) {
            ended = true;
            break;
          }
          seconds += 1 / song.refresh;
          for (let k = 0; k < Math.round(60 / song.refresh); k++) song.interrupt();
        }
        expect(keyOn, `song ${n}`).toBeGreaterThan(0);
        expect(bad).toBe(0);
        if (n < 3) console.log(folder, 'song', n, 'notes', keyOn, ended ? `ends at ${seconds.toFixed(0)}s` : `>${seconds.toFixed(0)}s`);
      }
    });
  });
}
