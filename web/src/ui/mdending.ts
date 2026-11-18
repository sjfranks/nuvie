/**
 * mdending.ts - Martian Dreams' ending in motion, a scene for each page of its words, as data/scripts/md/ending.lua
 * plays it: Jack and the capsule, the launch from Mars, the splashdown, the parade, the group photograph by the
 * moongate, and the dust storm.
 */
import { fadeFrames, of, poll, type Frame, type Scene, type Sprite } from './anim.ts';

const END = 'endgame.lzc';
const GATE = 'moongate.lzc';

const s = (grp: number, pic: number, x: number, y: number, more: Partial<Sprite> = {}): Sprite => ({ lib: END, grp, pic, x, y, ...more });

function launch(): Scene {
  const f: Frame[] = [];
  for (let i = -1; i <= 39; i++) {
    const bg = s(1, 0, ((((i + 2) % 5) + 5) % 5) - 2, 23 + ((((i + 3) % 4) + 4) % 4));
    const sp = [bg];
    if (i > -1 && i < 13) {
      sp.push(s(1, 1, 105 + (i * i * 2) / 3, 112 - i * i, { scale: i * i + 16, clip: true }));
      sp.push(s(1, 2 + Math.floor(i / 2), 105, 112));
    }
    f.push({ sprites: sp, ms: poll(3) });
  }
  f.push({ sprites: [s(1, 0, 0, 24)], ms: poll(3) });
  return of(f);
}

function splash(): Scene {
  return of([0, 1, 2, 3].map((j) => ({ sprites: [s(2, 0, 0, 24), s(2, Math.abs(2 - j) + 1, 170, 150)], ms: poll(8) })), true);
}

function photo(g: number, flash: boolean): Scene {
  const at = (i: number): Sprite[] => [
    s(4, 0, 0, 24),
    { lib: GATE, grp: 1, pic: i % 8, x: 35, y: 135 },
    s(4, g, 195, 151),
    s(4, i >= 38 && i <= 42 ? 4 : 3, 75, 151),
  ];
  if (!flash) return of([...Array(8).keys()].map((i) => ({ sprites: at(i), ms: poll(3) })), true);
  const f: Frame[] = [...fadeFrames(6, at(0))];
  for (let i = 0; i < 40; i++) f.push({ sprites: at(i), ms: poll(3) });
  // The flash of the camera, fading.
  f.push({ sprites: [s(4, 5, 0, 24)], ms: poll(2) });
  f.push(...fadeFrames(6, [s(4, 5, 0, 24)], 25, true));
  for (let i = 41; i < 80; i++) f.push({ sprites: at(i), ms: poll(3) });
  return of(f);
}

function storm(): Scene {
  // The dust's wander is random in the script; fixed here so the scene is the same each time it plays.
  let seed = 7;
  const rand = (n: number): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % (n + 1));
  const f: Frame[] = [];
  for (let i = 0; i < 64; i++) {
    const sp: Sprite[] = [s(5, 0, 0, 24), s(7, Math.floor(i / 8) > 4 ? 4 : Math.floor(i / 8), 240, 140)];
    if (i < 56) sp.push(s(8, i < 50 ? 0 : i - 50, 0, 140));
    for (const [x0, v] of [[340, 10], [420, 20], [500, 30], [580, 30], [660, 20]]) sp.push(s(6, 0, x0 - i * v - rand(19), 24 - rand(9), { clip: true }));
    f.push({ sprites: sp, ms: poll(2) });
  }
  return of(f);
}

/** The scene for a page of the ending (text_tbl's line), for a man or a woman. */
export function mdEndingScene(page: number, female: boolean): Scene {
  const g = female ? 2 : 1;
  switch (page) {
    case 0:
      return of([...fadeFrames(3, [s(0, 0, 0, 24), s(0, g, 155, 151)])]);
    case 1:
      return of([{ sprites: [s(0, 0, 0, 24), s(0, g, 155, 151)], ms: 1000 }]);
    case 2:
      return launch();
    case 3:
    case 4:
      return splash();
    case 5:
      return of(fadeFrames(6, [s(3, 0, 0, 24), s(3, g, 190, 151)]));
    case 6:
      return photo(g, true);
    case 7:
      return photo(g, false);
    default: {
      const last = storm();
      return page === 8 ? last : of([last.frame(63)]);
    }
  }
}
