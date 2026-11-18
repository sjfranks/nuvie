/**
 * u6intro.ts - Ultima VI's introduction in motion, as data/scripts/u6/intro.lua plays it: the lounge (the television
 * running its programmes, the clock telling the time), the storm at the window (clouds, rain, lightning, the strike
 * among the stones), the stones and the red gate, and the altar - the gargoyles closing in and swaying, the priest,
 * the gate in the dark and the rescue.
 *
 * The script runs as one, a page for each of its words (intro6.ts): to show a page it runs through the pages before it
 * without drawing, so each page begins where the last left off; where the script waits for a key on that page, the
 * scene goes on.
 */
import { loadPalette } from '../files/cutscene.ts';
import type { GameFiles } from '../files/gamefiles.ts';
import type { Shape } from '../files/shape.ts';
import { fromGen, type Frame, type Scene, type Sprite } from './anim.ts';

type S = Sprite & { visible: boolean };

const rand = (lo: number, hi: number): number => lo + Math.floor(Math.random() * (hi - lo + 1));

// ---- the lounge's television (display_tv) ----

const TV_PROGRAMS = [
  [0x82, 0x82, 0x80, 0x3, 0x2, 0x8a, 0x2, 0x8a, 0x1, 0x8a, 0x1, 0x8a, 0x0, 0x8a, 0x0, 0x8a, 0x1, 0x8a, 0x1, 0x81], // breathing
  [0x82, 0x82, 0x80, 0x28, 0x3, 0x8b, 0x81], // intestines
  [0x82, 0x82, 0x80, 0x4, 0x4, 0x81, 0x80, 0x4, 0x8, 0x81, 0x80, 0x4, 0x9, 0x81, 0x80, 0x4, 0x0a, 0x81, 0x80, 0x4, 0x0b, 0x81, 0x80, 0x4, 0x0c, 0x81], // vacuum
  [0x82, 0x82, 0x87, 0x80, 0x46, 0x0f, 0x86, 0x84, 0x9, 0x10, 0x10, 0x10, 0x11, 0x11, 0x11, 0x12, 0x12, 0x12, 0x81], // the anchor man
  [0x82, 0x82, 0x80, 0x32, 0x83, 0x81], // the endless road
  [0x82, 0x82, 0x80, 0x5, 0x27, 0x8a, 0x28, 0x8a, 0x29, 0x81, 0x80, 0x6, 0x2a, 0x8a, 0x2a, 0x8a, 0x2b, 0x8a, 0x2b, 0x8a, 0x2c, 0x8a, 0x2c, 0x8a,
    0x2d, 0x8a, 0x2d, 0x81, 0x80, 0x0a, 0x2e, 0x8a, 0x2f, 0x8a, 0x30, 0x8a, 0x84, 0x9, 0x2e, 0x2e, 0x2e, 0x2f, 0x2f, 0x2f, 0x30, 0x30, 0x30, 0x8a,
    0x2e, 0x8a, 0x2f, 0x8a, 0x30, 0x81], // a rock band
  [0x82, 0x82, 0x80, 0x55, 0x16, 0x17, 0x84, 0x0c, 0x13, 0x13, 0x13, 0x13, 0x14, 0x14, 0x14, 0x14, 0x15, 0x15, 0x15, 0x15, 0x88, 0x81, 0x80,
    0x0f, 0x16, 0x84, 0x2, 0x1a, 0x1b, 0x89, 0x88, 0x81, 0x80, 0x3, 0x16, 0x1a, 0x89, 0x88, 0x81, 0x80, 0x3, 0x16, 0x1c, 0x88, 0x81, 0x80, 0x3,
    0x16, 0x1d, 0x88, 0x81, 0x80, 0x3, 0x16, 0x1e, 0x88, 0x81, 0x80, 0x3, 0x16, 0x23, 0x88, 0x81, 0x80, 0x32, 0x16, 0x88, 0x81], // pledge now!
];
const TV_X = [
  0x0, 0x0, 0x0, 0x0, 0x0, 0x1f, 0x1f, 0x1f, 0x0, 0x0, 0x0, 0x0, 0x0, 0x1f, 0x1f, 0x0, 0x9, 0x9, 0x9, 0x0c, 0x0c, 0x0c, 0x0, 0x4, 0x1f, 0x1f, 0x4,
  0x0, 0x4, 0x4, 0x4, 0x1f, 0x1f, 0x0, 0x0, 0x6, 0x6, 0x8, 0x4, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
];
const TV_Y_BASE = [
  0x0, 0x0, 0x0, 0x0, 0x0, 0x2, 0x2, 0x2, 0x0, 0x0, 0x0, 0x0, 0x0, 0x2, 0x2, 0x0, 0x7, 0x7, 0x7, 0x3, 0x3, 0x3, 0x0, 0x2, 0x2, 0x2, 0x0, 0x0, 0x0,
  0x0, 0x1, 0x2, 0x2, 0x0, 0x0, 0x3, 0x8, 0x1d, 0x1c, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
];
const NEWS = [0x5, 0x6, 0x7, 0x0d, 0x0e, 0x18, 0x19, 0x1f, 0x20];

export function u6IntroScene(files: GameFiles, page: number): Scene {
  const USED = [0, 1, 2, 3, 7];
  const palettes = USED.map((i) => loadPalette(files, 'palettes.int', i) ?? new Uint8Array(0x300));
  let pal = new Uint8Array(palettes[1]);
  const setPalette = (i: number): void => {
    pal = new Uint8Array(palettes[USED.indexOf(i)]);
  };
  const rotate = (at: number, n: number): void => {
    const last = [pal[(at + n - 1) * 3], pal[(at + n - 1) * 3 + 1], pal[(at + n - 1) * 3 + 2]];
    pal.copyWithin((at + 1) * 3, at * 3, (at + n - 1) * 3);
    pal.set(last, at * 3);
  };
  const entry = (i: number, r: number, g: number, b: number): void => pal.set([r, g, b], i * 3);

  let lib = 'intro_1.shp';
  let sprites: S[] = [];
  const mk = (grp: number, x: number, y: number, visible = true, more: Partial<Sprite> = {}): S => {
    const s: S = { lib, grp, pic: 0, x, y, visible, ...more };
    sprites.push(s);
    return s;
  };
  let screen = 1;
  let p = 0;
  const frame = (): Frame => ({ ms: 25, opacity: screen, pal, sprites: sprites.filter((s) => s.visible && (s.opacity ?? 1) > 0) });

  /** A canvas update, shown only on the page being played. */
  function* update(): Generator<Frame> {
    if (p === page) yield frame();
  }
  /** The script's wait for a key, the scene going on by `each` (which updates the canvas): before the page played, the page ends here. */
  function* wait(each: () => Generator<Frame>): Generator<Frame> {
    if (p === page) for (;;) yield* each();
    p++;
  }
  function* plain(): Generator<Frame> {
    yield* update();
  }
  const here = (): boolean => p === page;

  // ---- the lounge ----
  function* lounge(): Generator<Frame> {
    lib = 'intro_1.shp';
    // First the two logos, each fading in and out (play's opening, before the lounge).
    if (here()) {
      setPalette(0);
      const logo = mk(0x45, 0, 0);
      for (const g of [0x45, 0x46]) {
        logo.grp = g;
        for (let i = 0; i <= 0xff; i += 3) {
          logo.opacity = i / 0xff;
          yield* update();
        }
        for (let i = 0xff; i >= 0; i -= 3) {
          logo.opacity = i / 0xff;
          yield* update();
        }
      }
      sprites = [];
    }
    setPalette(1);
    let tvX = 0xe5;
    const tvY = 0x32;
    const bg0 = mk(15, 210, 0);
    const bg = mk(0, 0, 0);
    const bg1 = mk(1, 320, 0);
    const avatar = mk(0xd, 0, 63);
    const tv = [0, 1, 2, 3, 4].map(() => mk(0, tvX, tvY, true, { clipRect: [tvX, tvY, 57, 37] }));
    for (const t of tv) t.shape = { w: 57, h: 37, data: new Uint8Array(57 * 37) };
    const finger = mk(0xe, 143, 91);
    const clock = [0, 4, 0xa, 0xe].map((dx) => mk(12, 0xdd + dx, 0x14));
    const statik: Shape = { w: 57, h: 37, data: new Uint8Array(57 * 37) };
    const yOff = [...TV_Y_BASE];
    let loopPos = 0;
    let loopCnt = 0;
    let pos = 0;
    let prog = 2;
    let news = 0;
    let pledgeCount = 0;
    let pledgeImage = 37;
    let road = 0xe;
    let tvTurn = true;

    const show = (i: number, n: number): void => {
      const s = tv[i];
      if (!s) return;
      s.shape = undefined;
      s.grp = 0x10 + n;
      s.x = tvX + TV_X[n];
      s.y = tvY + yOff[n];
      s.clipRect = [Math.max(0, tvX), tvY, 57, 37];
      s.visible = true;
    };
    const displayTv = (): void => {
      let k = 0;
      for (const t of tv) t.visible = false;
      finger.visible = false;
      for (let done = false; !done; ) {
        const P = TV_PROGRAMS[prog];
        let item = P[pos];
        if (item < 0x80) show(k++, item);
        else if (item === 0x82) {
          const s = tv[k];
          if (s) {
            statik.data.fill(16);
            for (let i = 0; i < 1000; i++) statik.data[rand(0, 57 * 37 - 1)] = 0;
            s.shape = statik;
            s.x = tvX;
            s.y = tvY;
            s.clipRect = [tvX, tvY, 57, 37];
            s.visible = true;
          }
          finger.visible = true;
          done = true;
        } else if (item === 0x80) {
          pos++;
          loopCnt = P[pos];
          loopPos = pos;
        } else if (item === 0x81) {
          if (loopCnt > 0) {
            pos = loopPos;
            loopCnt--;
          }
          done = true;
        } else if (item === 0x83) {
          if (--road === 0) road = 0xe;
          yOff[0x22] = 0x15 - road;
          show(k++, 0x22);
          yOff[0x22] = 0x24 - road;
          show(k++, 0x22);
          show(k++, 0x21);
        } else if (item === 0x84) {
          const len = P[pos + 1];
          item = P[pos + 1 + rand(1, len)];
          show(k++, item);
          pos += 1 + len;
        } else if (item === 0x86) show(k++, news);
        else if (item === 0x87) news = NEWS[rand(0, 8)];
        else if (item === 0x88) {
          pledgeCount++;
          if (pledgeCount % 4 === 0) show(k++, pledgeImage);
          if (pledgeCount === 16) {
            pledgeImage = pledgeImage === 37 ? 38 : 37;
            pledgeCount = 0;
          }
        } else if (item === 0x89) show(k++, rand(50, 52));
        else if (item === 0x8a) done = true;
        else if (item === 0x8b) rotate(0xe0, 5);
        pos++;
        if (TV_PROGRAMS[prog][pos] === undefined) {
          prog = (prog + 1) % TV_PROGRAMS.length;
          pos = 0;
        }
      }
    };
    const displayClock = (): void => {
      const now = new Date();
      let hour = now.getHours();
      const minute = now.getMinutes();
      if (hour > 12) hour -= 12;
      clock[0].grp = hour < 10 ? 12 : 3;
      if (hour >= 10) hour -= 10;
      clock[1].grp = hour + 2;
      clock[2].grp = Math.floor(minute / 10) + 2;
      clock[3].grp = (minute % 10) + 2;
    };
    const displayLounge = (): void => {
      displayClock();
      if (tvTurn) displayTv();
      tvTurn = !tvTurn;
    };
    function* live(): Generator<Frame> {
      displayLounge();
      yield* update();
    }

    displayClock();
    yield* wait(live); // Upon your world, five seasons have passed...
    yield* wait(live); // ...television supermen cannot take the place of friends...
    // Outside, a chill wind rises: the view moves to the window.
    for (let i = 0; i <= 319; i++) {
      bg.x--;
      bg1.x--;
      tvX--;
      avatar.x -= 2;
      finger.x -= 2;
      if (bg1.x < 166 && bg1.x % 2 === 0) bg0.x--;
      for (const c of clock) c.x--;
      if (here()) {
        displayLounge();
        yield* update();
      }
    }
    yield* wait(plain);
    sprites = [];
  }

  // ---- the storm at the window ----
  function* storm(): Generator<Frame> {
    lib = 'intro_2.shp';
    setPalette(2);
    let cloudX = -400;
    mk(1, 0, 0);
    const cloud1 = mk(0, cloudX, -5);
    const cloud2 = mk(0, cloudX, -5);
    const clouds = [1, 2, 3, 4, 5].map(() => mk(rand(2, 3), rand(0, 320) - 260, rand(0, 30)));
    const lightning = mk(11, 0, 0, false);
    mk(10, 0, 0x4c);
    mk(8, 0, 0);
    const strike = mk(rand(19, 23), 158, 114, false);
    const rain = [...Array(101).keys()].map(() => mk(rand(4, 7), rand(0, 320), rand(0, 200), false));
    const frameS = mk(28, 0, 0);
    const window = mk(26, 0x39, 0);
    const doorL = mk(24, 320, 0);
    const doorR = mk(25, 573, 0);
    let flash = 0;
    let drops = 0;
    let rainDelay = 20;
    let bolt = 0;
    let boltX = 0;
    let boltY = 0;

    const display = (): void => {
      for (const c of clouds) {
        if (c.x > 320) {
          c.x = rand(0, 320) - 320;
          c.y = rand(0, 30);
        }
        c.x += 2;
      }
      if (++cloudX === 320) cloudX = 0;
      cloud1.x = cloudX;
      cloud2.x = cloudX - 320;
      if (rand(0, 6) === 0 && bolt === 0) {
        bolt = rand(1, 4);
        lightning.grp = rand(11, 18);
        lightning.visible = true;
        boltX = rand(-5, 320);
        boltY = rand(-5, 200);
      }
      if (bolt > 0) {
        lightning.x = boltX + rand(0, 3);
        lightning.y = boltY + rand(0, 3);
      } else lightning.visible = false;
      if ((bolt > 0 && rand(0, 3) === 0) || strike.visible) {
        entry(0x58, 0x40, 0x94, 0xfc);
        entry(0x5a, 0x40, 0x94, 0xfc);
        entry(0x5c, 0x40, 0x94, 0xfc);
      } else {
        entry(0x58, 0x20, 0xa4, 0x80);
        entry(0x5a, 0x14, 0x8c, 0x74);
        entry(0x5c, 0x0c, 0x74, 0x68);
      }
      if (rand(0, 1) === 0) strike.grp = rand(19, 23);
      if (flash > 0) flash--;
      else if (rand(0, 5) === 0 || strike.visible) {
        window.grp = 27;
        flash = rand(1, 5);
      } else window.grp = 26;
      if (drops < 100 && rand(0, rainDelay) === 0) {
        rainDelay = Math.max(1, rainDelay - 2);
        const r = rain[drops++];
        r.visible = true;
        r.grp = rand(4, 7);
        r.y = -4;
        r.x = rand(0, 320);
      }
      for (let i = 0; i <= drops && i < rain.length; i++) {
        const r = rain[i];
        if (r.visible) {
          r.x += 2;
          r.y += 8;
          if (r.x > 320 || r.y > 200) r.visible = false;
        } else {
          r.visible = true;
          r.grp = rand(4, 7);
          r.y = -4;
          r.x = rand(0, 320);
        }
      }
      if (bolt > 0) bolt--;
    };
    function* live(): Generator<Frame> {
      if (here()) display();
      yield* update();
      yield* update();
    }

    for (let i = 0; i < 20; i++) yield* live();
    yield* wait(live); // ...and in moments, the storm is upon you.
    yield* wait(live); // Tongues of lightning...
    strike.visible = true;
    yield* wait(live); // ...a bolt of searing blue fire strikes the earth!
    // Lightning among the stones! The view moves on from the window.
    for (let i = 0; i < 320; i += 2) {
      yield* live();
      window.x -= 2;
      frameS.x -= 2;
      doorL.x -= 2;
      doorR.x -= 2;
      if (i + 2 > 160) strike.visible = false;
    }
    yield* wait(live);
    // You bolt from your house: the doors open on the storm.
    for (let i = 0; i < 68; i++) {
      yield* live();
      doorL.x--;
      doorR.x++;
    }
    yield* wait(live);
    for (let i = 0xff; i >= 0; i -= 3) {
      screen = i / 0xff;
      yield* update();
    }
    sprites = [];
  }

  // ---- the stones ----
  function* stones(): Generator<Frame> {
    lib = 'intro_3.shp';
    setPalette(3);
    let counter = 0;
    const turn = (): void => {
      if (counter === 4) {
        rotate(144, 16);
        counter = 0;
      } else counter++;
    };
    const bg = mk(0, 0, 0);
    const stoneCover = mk(3, 0x96, 0x64, false);
    const gateCover = mk(4, 0x5e, 0x66, false);
    const hand = mk(1, 0xbd, 0xc7, false);
    const gate = mk(2, 0x7c, 0x64, false, { clipRect: [0, 0, 320, 0x66] });
    const avatar = mk(7, -2, 0x12, false);
    function* live(): Generator<Frame> {
      if (here()) turn();
      yield* update();
    }
    const jitter = (): void => {
      gate.x = 0x7c + rand(0, 1);
      gate.y = 5 + rand(0, 3);
    };
    function* shake(): Generator<Frame> {
      for (let k = 0; k < 2; k++) {
        if (here()) {
          turn();
          jitter();
        }
        yield* update();
      }
    }

    for (let i = 0; i <= 0xff; i += 3) {
      screen = i / 0xff;
      yield* update();
    }
    screen = 1;
    yield* wait(live); // Near the stones...
    stoneCover.visible = true;
    hand.visible = true;
    for (let i = 0xc7; i >= 0x54; i -= 2) {
      hand.y = i;
      yield* update();
    }
    yield* wait(live); // Wondering, you pick it up...
    bg.grp = 5;
    stoneCover.visible = false;
    gateCover.visible = true;
    gate.visible = true;
    for (let i = 0x64; i >= 0x5; i--) {
      gate.y = i;
      yield* live();
    }
    for (let i = 0x54; i <= 0xc7; i += 2) {
      hand.y = i;
      yield* live();
    }
    hand.visible = false;
    yield* wait(live); // ...a softly glowing door ascends in silence!
    hand.grp = 6;
    hand.x = 0x9b;
    hand.visible = true;
    for (let i = 0xc7; i >= 0x44; i -= 2) {
      hand.y = i;
      bg.y--;
      gateCover.y--;
      gate.y--;
      yield* live();
    }
    yield* wait(live); // Exultant memories...
    for (let i = 0x44; i <= 0xc7; i += 2) {
      hand.y = i;
      bg.y++;
      gateCover.y++;
      gate.y++;
      yield* live();
    }
    hand.visible = false;
    yield* wait(live); // But your joy soon gives way to apprehension...
    yield* wait(shake); // Abruptly, the portal quivers...
    // Desperation makes the decision an easy one: into the gate.
    for (let k = 0; k < 40 && here(); k++) yield* shake();
    avatar.visible = true;
    entry(0x19, 0, 0, 0);
    for (let i = 0; i <= 19; i++) {
      avatar.grp = 7 + i;
      for (let j = 0; j <= 4; j++) {
        yield* update();
        if (here()) {
          turn();
          jitter();
        }
      }
      avatar.y -= 3;
    }
    for (let i = 0xff; i >= 0; i -= 3) {
      yield* update();
      if (here()) {
        turn();
        jitter();
      }
      avatar.opacity = i / 0xff;
    }
    avatar.visible = false;
    entry(0x19, 0x74, 0x74, 0x74);
    gate.x = 0x7c;
    for (let i = 0x5; i <= 0x64; i++) {
      gate.y = i;
      yield* live();
    }
    bg.grp = 0;
    bg.y = 0;
    gate.visible = false;
    gateCover.visible = false;
    stoneCover.visible = true;
    yield* wait(live);
    sprites = [];
  }

  // ---- the altar ----
  function* altar(): Generator<Frame> {
    lib = 'intro.shp';
    setPalette(7);
    let counter = 0;
    const turnGate = (): void => {
      if (counter === 3) {
        rotate(232, 8);
        counter = 0;
      } else counter++;
    };
    const bg = mk(6, 0, 0);
    const gate = mk(7, 0x78, 0x3a, false);
    const left = mk(3, -84, 0x6d);
    const right = mk(4, 326, 0xc7);
    const body = mk(8, 0xd5, 0x8d, false);
    const head = mk(11, 0x123, 0x9b, false);
    const iolo = mk(1, 0xa8, 0xca, false);
    const shamino = mk(2, 0x44, 0x7a, false);
    const dupre = mk(0, -0x20, 0x7a, false);
    const avatar = mk(9, 0x31, 0x44, false);
    const alter = mk(5, 0, 0x70);
    const ropes = mk(12, 0xd2, 0x84, false);
    const all = sprites.slice();
    const SWAY = [1, 1, 1, -1, -1, -1, -1, -1, -1, 1, 1, 1];
    let li = 1;
    let ri = 6;
    const sway1 = (s: S, idx: number): number => {
      if (rand(0, 3) === 0) return idx;
      idx = idx === 12 ? 1 : idx + 1;
      s.x += SWAY[idx - 1];
      return idx;
    };
    const sway = (): void => {
      li = sway1(left, li);
      ri = sway1(right, ri);
    };
    function* swaying(): Generator<Frame> {
      if (here()) sway();
      yield* update();
      yield* update();
    }
    function* swayGate(): Generator<Frame> {
      if (here()) {
        sway();
        turnGate();
      }
      yield* update();
    }
    function* gateOnly(): Generator<Frame> {
      if (here()) turnGate();
      yield* update();
    }

    screen = 0;
    for (let i = 0; i <= 0xff; i += 3) {
      screen = i / 0xff;
      yield* update();
    }
    screen = 1;
    yield* wait(plain); // Dazed, you emerge...
    yield* wait(plain); // At first the plain is still...
    const LX = [1, 1, 0, 1, 1, 1];
    const LY = [0, 0, -1, 0, 0, -1];
    const RX = [-1, -1, -1, -1, -1, -1];
    const RY = [-1, -1, 0, -1, -1, -1];
    for (let i = 0; i <= 95; i++) {
      left.x += LX[i % 6];
      left.y += LY[i % 6];
      if (i > 23) {
        right.x += RX[i % 6] * 2;
        right.y += RY[i % 6] * 2;
      }
      yield* update();
      yield* update();
    }
    yield* wait(plain); // ...but you have no place to go.
    yield* wait(plain); // ...scaly claws grasp your body.
    avatar.visible = true;
    ropes.visible = true;
    yield* wait(plain); // ...bind you to the altar stone!
    left.y += 4;
    right.y += 4;
    body.visible = true;
    head.visible = true;
    for (let i = 0; i <= 22; i++) {
      body.x -= 3;
      body.y -= 3;
      head.x -= 3;
      head.y -= 3;
      yield* update();
      yield* update();
    }
    for (let i = 0; i <= 13; i++) {
      body.y -= 3;
      head.y -= 3;
      yield* update();
      yield* update();
    }
    Object.assign(body, { x: 144, y: 30 });
    Object.assign(head, { x: 222, y: 44 });
    yield* wait(swaying); // Kneeling, the hordes sway and chant...
    yield* wait(swaying); // The leader unwraps a velvet covered book...
    yield* wait(swaying); // ...a malignant dagger drips with moonlight.
    gate.visible = true;
    counter = 0;
    for (let i = 0x78; i >= 0x3a; i--) {
      gate.y = i;
      yield* gateOnly();
    }
    yield* wait(gateOnly); // You close your eyes...
    for (let i = 0xff; i >= 0; i -= 3) {
      if (here()) turnGate();
      screen = i / 0xff;
      yield* update();
    }
    sprites = [];
    screen = 1;
    // Catcalls, the dagger...; Pandemonium...; From the inevitable...; You are still alive.
    for (let k = 0; k < 3; k++) yield* wait(plain);
    yield* wait(plain);
    sprites = all;
    for (const s of [bg, gate, left, right, body, head, alter, avatar, ropes]) s.visible = true;
    for (let i = 0; i <= 0xff; i += 3) {
      if (here()) {
        sway();
        turnGate();
      }
      screen = i / 0xff;
      yield* update();
    }
    screen = 1;
    head.grp = 10;
    yield* wait(swayGate); // Silent red light fills the darkness...
    for (let i = 0; i <= 42; i++) {
      if (here()) {
        sway();
        turnGate();
      }
      const dx = rand(-1, 2);
      body.x += dx;
      body.y += 3;
      head.x += dx;
      head.y += 3;
      yield* update();
    }
    body.visible = false;
    head.visible = false;
    iolo.visible = true;
    dupre.visible = true;
    shamino.visible = true;
    for (let i = 0; i <= 82; i++) {
      if (here()) {
        sway();
        turnGate();
      }
      dupre.x += i > 33 ? 2 : 1;
      dupre.y--;
      if (i > 13) {
        shamino.x += i > 36 ? 2 : 1;
        shamino.y--;
      }
      if (i > 10) {
        iolo.x++;
        iolo.y -= i > 14 ? 2 : 1;
      }
      yield* update();
    }
    yield* wait(swayGate); // Friendly faces vault from a newborn moongate...
    ropes.visible = false;
    for (let i = 0; i <= 82; i++) {
      if (here()) {
        sway();
        turnGate();
      }
      for (const s of [dupre, shamino, iolo]) {
        s.x--;
        s.y += 2;
      }
      avatar.y++;
      yield* update();
    }
    yield* wait(swayGate); // "Quickly, old friend! To the gate!"
    yield* wait(swayGate); // Snatching the fallen priest's book...
    for (let i = 0; i <= 150; i++) {
      if (i % 2 === 0) gate.y++;
      yield* swayGate();
    }
    yield* wait(swaying); // The gate wanes rapidly...
    yield* wait(swaying); // ...but not rapidly enough.
    yield* wait(swaying); // From the mob's vanguard...
  }

  function* script(): Generator<Frame> {
    yield* lounge();
    yield* storm();
    yield* stones();
    yield* altar();
  }
  return fromGen(script());
}
