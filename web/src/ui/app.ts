/**
 * app.ts - the game on a phone: the map across the top, taking taps; under it one pane that shows the log or the
 * party, with tabs to choose; and at the foot the commands - or, while someone is talking, the things to say.
 * Held sideways, the map stands at the left and the rest beside it.
 */
import type { Actor } from '../game/actors.ts';
import { Game, type SaveState } from '../game/game.ts';
import { invWeight } from '../game/inventory.ts';
import type { Obj } from '../game/objects.ts';
import { OBJ } from '../game/u6tables.ts';
import { USED_IN_PLACE } from '../game/usecode.ts';
import { MD_IN_PLACE } from '../game/mdusecode.ts';
import { REAGENTS, reagentCounts, reagentNames, words, type Spell } from '../game/magic.ts';
import { kvDelete, kvGet, kvSet } from '../files/gamefiles.ts';
import { play } from './anim.ts';
import { endingPicture, stillPicture } from './endings.ts';
import { mdEndingScene } from './mdending.ts';
import { u6EndingScene } from './u6ending.ts';
import { u6IntroScene } from './u6intro.ts';
import { mdIntroScene } from './mdintro.ts';
import { seTitleScene } from './seintro.ts';
import { loadImages, loadMidgame, shapeRgba } from '../files/cutscene.ts';
import type { Shape } from '../files/shape.ts';
import { INTRO_U6 } from './intro6.ts';
import { Gypsy } from './gypsy.ts';
import { ASK_NAME, INTRO, Intanya, QUESTIONS as QUESTIONS_SE, SE_ENDING, SE_STORY } from './intanya.ts';
import { interview, type Hero, type Step } from './freud.ts';
import { MapView } from './mapview.ts';
import { haveIcons } from './theme.ts';
import { Music } from '../audio/music.ts';
import { Sfx } from '../audio/sfx.ts';

type Mode = 'look' | 'talk' | 'use' | 'get' | 'attack' | 'cast' | 'where' | null;
type Pane = 'log' | 'party';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const btn = (label: string, on: () => void, cls = ''): HTMLButtonElement => {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', on);
  return b;
};
/**
 * Where the world lies on a picture of each game's cloth map, as fractions of the picture: [offset, per square]
 * across and down. Measured on the maps from the boxes (photographed whole, frame and all), by laying the world
 * drawn from the game's files over them. A picture of another shape is taken to be the world edge to edge.
 */
const MAP_CAL: Record<string, { aspect: number; u: [number, number]; v: [number, number] }> = {
  u6: { aspect: 2250 / 2245, u: [0.04, 0.00090332], v: [0.022, 0.00092578] },
  md: { aspect: 2000 / 1160, u: [0.10329, 0.0007727], v: [-0.03913, 0.0010326] },
  se: { aspect: 1225 / 1218, u: [0.035, 0.00090820], v: [0.035, 0.00090820] },
};
function mapCalibration(kind: string, aspect: number): { u: [number, number]; v: [number, number] } {
  const c = MAP_CAL[kind];
  if (c && Math.abs(aspect / c.aspect - 1) < 0.06) return c;
  return { u: [0, 1 / 1024], v: [0, 1 / 1024] };
}

/** The battle speeds: how long each fighter's turn is shown. */
const BATTLE_SPEEDS = [
  { name: 'slow', ms: 750 },
  { name: 'normal', ms: 420 },
  { name: 'fast', ms: 200 },
];
const esc = (s: string): string => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** Things a tap uses rather than walks onto. */
const USABLE: ReadonlySet<number> = new Set([
  OBJ.OAKEN_DOOR, OBJ.WINDOWED_DOOR, OBJ.CEDAR_DOOR, OBJ.STEEL_DOOR, OBJ.LADDER, OBJ.CAVE, OBJ.HOLE, OBJ.SIGN,
  OBJ.SIGN_ARROW, OBJ.GRAVE, OBJ.CHEST, OBJ.BARREL, OBJ.CRATE, OBJ.DRAWER, OBJ.BOOK, OBJ.SCROLL, 412, 414, 415, 420, 423,
]);

export interface AppHooks {
  save(state: SaveState): void;
  /** Back to the first screen; `forget` drops the saved game. */
  leave(forget: boolean): void;
}

export class App {
  private readonly view: MapView;
  private readonly root = el('div', 'play');
  private readonly status = el('div', 'status');
  private readonly modeTag = el('div', 'mode');
  /** The speaker's face over the map while they talk. */
  private readonly face = el('div', 'face');
  private faceOf = -1;
  private readonly body = el('div', 'panebody');
  private readonly foot = el('div', 'foot');
  private readonly tabLog: HTMLButtonElement;
  private readonly tabParty: HTMLButtonElement;
  private pane: Pane = 'log';
  /** A spell chosen in the book, waiting for where. */
  private pending: { caster: Actor; spell: Spell } | null = null;
  private wasTalking = false;
  /** Whether the log follows its newest line (until the player scrolls back). */
  private stick = true;
  private logLength = 0;
  /** Where in the log the conversation now going began. */
  private talkFrom = 0;
  /** The container whose contents are open over the game. */
  private shownContainer: Obj | null = null;
  private readonly music: Music;
  private readonly sfx: Sfx;
  private mode: Mode = null;
  private walk: { x: number; y: number; then: Mode | 'walk'; foe?: Actor } | null = null;
  private walkTimer = 0;
  private seenLog = 0;
  private sheet: HTMLElement | null = null;
  private saveTimer = 0;
  private footKey = '';
  private readonly timers: number[] = [];

  constructor(
    host: HTMLElement,
    readonly game: Game,
    private readonly hooks: AppHooks,
  ) {
    const wrap = el('div', 'viewwrap paper');
    const box = el('div', 'mapbox');
    const canvas = el('canvas', 'view');
    this.view = new MapView(game, canvas);
    this.view.light.className = 'light';
    this.modeTag.hidden = true;
    this.zoomReset = btn('Zoom', () => this.setZoom(0), 'zoomreset');
    this.zoomReset.setAttribute('aria-label', 'Back to the usual zoom');
    this.zoomReset.hidden = true;
    box.append(canvas, this.view.light, this.modeTag, this.face, this.zoomReset);
    this.status.className = 'clock';
    wrap.append(box);
    const divider = el('div', 'divider');
    const tabs = el('div', 'tabs');
    this.tabLog = btn('Log', () => this.setPane('log'));
    this.tabParty = btn('Party', () => this.setPane('party'));
    tabs.append(this.tabLog, this.tabParty, this.status, btn('Menu', () => this.menu()));
    divider.append(tabs);
    const pane = el('div', 'pane paper');
    // A scroll bar of our own (phones hide theirs): where the view is in what there is.
    this.thumb = el('i');
    const track = el('div', 'scrolltrack');
    track.append(this.thumb);
    pane.append(this.body, track);
    const side = el('div', 'side');
    side.append(divider, pane, this.foot);
    this.root.append(wrap, side);
    host.replaceChildren(this.root);
    this.body.addEventListener('scroll', () => {
      if (this.pane === 'log') this.stick = this.body.scrollTop + this.body.clientHeight >= this.body.scrollHeight - 6;
      this.drawThumb();
    });
    // The pane changes size (a conversation shrinks the map): the newest line stays in view.
    new ResizeObserver(() => {
      if (this.pane === 'log') this.toBottom();
      else this.sizeParty();
      this.drawThumb();
    }).observe(this.body);

    // A tap acts (tap()); a finger held down walks the party towards it while it stays, sliding to steer.
    const at = (e: PointerEvent): { x: number; y: number } => {
      const r = canvas.getBoundingClientRect();
      return this.view.squareAt(e.clientX - r.left, e.clientY - r.top);
    };
    let down: {
      id: number; sq: { x: number; y: number }; holding: boolean; timer: number;
      from: { x: number; y: number }; carry: Obj | null; ghost: HTMLCanvasElement | null;
    } | null = null;
    // Two fingers pinch the map: apart to come back in (never closer than the default), together to see more.
    const fingers = new Map<number, { x: number; y: number }>();
    let pinch: { dist: number; extra: number } | null = null;
    const spread = (): number => {
      const [a, b] = [...fingers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y) || 1;
    };
    canvas.addEventListener('pointerdown', (e) => {
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size === 2) {
        // A second finger: a pinch, not a tap or a walk.
        if (down) clearTimeout(down.timer);
        down = null;
        this.walk = null;
        pinch = { dist: spread(), extra: this.zoomOut };
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!fingers.has(e.pointerId)) return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && fingers.size === 2) {
        const base = this.baseCols();
        const want = Math.round(((base + pinch.extra) * pinch.dist) / spread());
        this.setZoom(Math.max(0, want - base));
      }
    });
    const lift = (e: PointerEvent): void => {
      fingers.delete(e.pointerId);
      if (fingers.size < 2) pinch = null;
    };
    canvas.addEventListener('pointerup', lift);
    canvas.addEventListener('pointercancel', lift);
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (fingers.size > 1) return;
      canvas.setPointerCapture(e.pointerId);
      const sq = at(e);
      // A thing within reach may be dragged: a finger that moves off it carries it.
      const g = this.game;
      const top = !g.converse && !this.mode ? [...(g.objects.list(sq.x, sq.y, g.player.z) ?? [])].reverse().find((o) => g.canDrag(o)) : undefined;
      down = { id: e.pointerId, sq, holding: false, timer: 0, from: { x: e.clientX, y: e.clientY }, carry: top ?? null, ghost: null };
      const d = down;
      d.timer = window.setTimeout(() => {
        // Held: walking, not a tap - unless a command waits on a square, or someone is talking.
        if (down !== d || this.mode || this.game.converse) return;
        d.holding = true;
        this.hold(() => (down === d ? d.sq : null));
      }, 280);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!down || e.pointerId !== down.id) return;
      down.sq = at(e);
      const d = down;
      if (d.carry && !d.holding && !d.ghost && Math.hypot(e.clientX - d.from.x, e.clientY - d.from.y) > 14) {
        // Dragging, not walking: the thing follows the finger.
        clearTimeout(d.timer);
        d.ghost = this.view.tileImage(this.game.objects.tileNum(d.carry));
        d.ghost.className = 'dragghost';
        document.body.append(d.ghost);
      }
      if (d.ghost) {
        d.ghost.style.left = `${e.clientX}px`;
        d.ghost.style.top = `${e.clientY}px`;
      }
    });
    const up = (e: PointerEvent): void => {
      if (!down || e.pointerId !== down.id) return;
      const d = down;
      down = null;
      clearTimeout(d.timer);
      if (d.ghost) {
        d.ghost.remove();
        if (e.type === 'pointerup' && d.carry && !this.busy) this.game.dragTo(d.carry, d.sq.x, d.sq.y);
        return;
      }
      if (!d.holding && e.type === 'pointerup') this.tap(d.sq);
      if (d.holding) {
        this.walk = null;
        this.mark();
      }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    const onKey = (e: KeyboardEvent): void => this.key(e);
    const onSize = (): void => this.layout();
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onSize);
    this.dispose = () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onSize);
      this.timers.forEach(clearInterval);
      clearTimeout(this.walkTimer);
      clearTimeout(this.saveTimer);
      this.sheet?.remove();
      this.music.stop();
    };
    this.music = new Music(game);
    this.sfx = new Sfx(() => this.music.context);
    try {
      this.sfx.enabled = localStorage.getItem('nuvie.sfx') !== 'off';
    } catch {
      // Sound on.
    }
    game.sfx = (id, circle) => this.sfx.play(id, circle);
    // Sound may start only once the player has touched the page.
    const wake = (): void => void this.music.start();
    window.addEventListener('pointerdown', wake, { once: true });
    window.addEventListener('keydown', wake, { once: true });
    game.onChange = () => this.changed();
    this.timers.push(window.setInterval(() => {
      this.view.tick();
      this.view.render();
    }, 150));
    // A fight's turns, one at a time, at the battle speed: each fighter is seen to act.
    game.combat.paced = true;
    this.timers.push(window.setInterval(() => {
      const c = game.combat;
      if (!c.queue.length || performance.now() < this.turnAt) return;
      const p = game.player;
      let a = c.nextTurn();
      // Turns far off the map need no watching.
      while (a && (a.z !== p.z || Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) > 8) && c.queue.length) a = c.nextTurn();
      this.turnAt = performance.now() + BATTLE_SPEEDS[this.battleSpeed].ms;
      this.changed();
      this.view.render();
    }, 30));
    this.layout();
    this.changed();
    if (game.fresh && game.kind === 'u6') this.creation();
    if (game.fresh && game.kind === 'md') this.freud();
    if (game.fresh && game.kind === 'se') this.intanya();
  }

  // ---- a new Avatar (intro.lua's create_character) ----

  private creation(): void {
    const g = this.game;
    let name = '';
    let female = false;
    let face = 0;
    this.open('A new Avatar', (body) => {
      body.append(el('p', '', 'In a gypsy\'s wagon at a country fair, a woman with a crystal looks up as thou enterest.'));
      const input = el('input');
      input.maxLength = 13;
      input.placeholder = 'Avatar';
      input.autocomplete = 'off';
      input.addEventListener('input', () => (name = input.value));
      const named = el('label', 'field');
      named.append(el('span', '', 'By what name shalt thou be called?'), input);
      const sex = el('div', 'row');
      const faces = el('div', 'faces');
      const drawFaces = (): void => {
        faces.replaceChildren();
        for (let i = 0; i < 6; i++) {
          const shape = g.avatarFace((female ? 0 : 6) + i);
          if (!shape) continue;
          const b = btn('', () => {
            face = i;
            drawFaces();
          }, i === face ? 'pickface on' : 'pickface');
          b.setAttribute('aria-label', `Face ${i + 1}`);
          b.append(this.view.portraitImage(shape));
          faces.append(b);
        }
      };
      const male = btn('Male', () => {
        female = false;
        male.classList.add('on');
        fem.classList.remove('on');
        drawFaces();
      }, 'on');
      const fem = btn('Female', () => {
        female = true;
        fem.classList.add('on');
        male.classList.remove('on');
        drawFaces();
      });
      sex.append(male, fem);
      drawFaces();
      body.append(named, el('p', 'small', 'Art thou a man or a woman?'), sex, el('p', 'small', 'Which face is thine?'), faces);
      const go = el('div', 'row');
      go.append(btn('Sit before the gypsy', () => this.gypsy(name, female, face), 'primary'));
      body.append(go);
      if (g.files.has('intro.shp')) {
        const watch = el('div', 'row');
        watch.append(btn('Watch the introduction first', () => this.introU6(0)));
        body.append(watch);
      }
    });
  }

  /** play_midgame_sequence: a scene's pictures (the Avatar as they are) and its words, a line at a time. */
  private midgame(n: number): void {
    const g = this.game;
    const scenes = loadMidgame(g.files, `midgame${n.toString(16)}.lzc`, g.kind === 'md');
    const pages: { text: string; pic: number }[] = [];
    scenes.forEach((s, i) => s.text.forEach((t) => t && t !== '*END*' && pages.push({ text: t.replace(/\^/g, ' '), pic: i })));
    if (!pages.length) return;
    const draw = (k: number): void => {
      if (k >= pages.length) return this.close();
      const sc = scenes[pages[k].pic];
      this.open(g.kind === 'md' ? 'Martian Dreams' : 'The Savage Empire', (body) => {
        const c = document.createElement('canvas');
        // The scene's own size: its background, drawn where its hot spot falls.
        c.width = sc.images[0]?.w ?? 320;
        c.height = sc.images[0]?.h ?? 200;
        c.className = 'scene midgame';
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, c.width, c.height);
        const pal = this.view.palette;
        const layer = (s: Shape | undefined): void => {
          if (!s) return;
          const tmp = document.createElement('canvas');
          tmp.width = s.w;
          tmp.height = s.h;
          tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(shapeRgba(s, pal)), s.w, s.h), 0, 0);
          const bg = sc.images[0];
          ctx.drawImage(tmp, (bg?.hx ?? 0) - (s.hx ?? 0), (bg?.hy ?? 0) - (s.hy ?? 0));
        };
        layer(sc.images[0]);
        if (sc.images.length > 1) layer(sc.images[1 + (g.gender === 1 ? 1 : 0)]);
        body.append(c, el('p', '', pages[k].text));
        const row = el('div', 'row');
        row.append(btn(k + 1 < pages.length ? 'Continue' : 'Close', () => {
          this.onClose = null;
          draw(k + 1);
        }, 'primary'));
        body.append(row);
      });
    };
    draw(0);
  }

  /** Ultima VI's introduction, a page of its words over a still at a time; then the gypsy. */
  private introU6(i: number): void {
    const g = this.game;
    if (i >= INTRO_U6.length) return this.creation();
    const [text, [file, pal, layers]] = INTRO_U6[i];
    let moving: ReturnType<typeof play> = null;
    this.open('Ultima VI', (body) => {
      // The scene moves as intro.lua plays it; a still where it cannot.
      moving = play(g.files, ['palettes.int', pal], u6IntroScene(g.files, i));
      const pic = moving?.canvas ?? stillPicture(g.files, file, ['palettes.int', pal], layers);
      if (pic) {
        pic.className = 'scene';
        body.append(pic);
      }
      body.append(el('p', '', text));
      const row = el('div', 'row');
      const go = (next: () => void): void => {
        moving?.stop();
        this.onClose = null;
        next();
      };
      row.append(btn('Skip', () => go(() => this.creation())), btn('Continue', () => go(() => this.introU6(i + 1)), 'primary'));
      body.append(row);
    });
    this.onClose = () => moving?.stop();
  }

  /** Martian Dreams' new Avatar: Freud's interview aboard the capsule (intro.lua's create_character). */
  private freud(): void {
    const g = this.game;
    const lines = g.sceneText('scenetxt.lzc', 5);
    if (lines.length < 60) return;
    const it = interview(lines, (lo, hi) => lo + g.random(hi - lo + 1));
    // The introduction first, if wished (intro.lua's run_introduction): its words over each scene's picture.
    const scenes: [number, string, number[][]][] = [[0, 'scene1.lzc', [[0, 0, 0, 24], [0, 1, 0, 24], [1, 0, 240, 151]]], [1, 'scene3.lzc', [[0, 0, 0, 24]]], [2, 'scene4a.lzc', [[0, 0, 0, 24]]]];
    const intro: [string, string, number[][]][] = [];
    for (const [item, file, layers] of scenes) for (const l of g.sceneText('scenetxt.lzc', item)) if (l.trim()) intro.push([l.replace(/\^/g, ' '), file, layers]);
    const introPage = (i: number): void => {
      if (i >= intro.length) return show(it.next(''));
      const [text, file, layers] = intro[i];
      this.open('Martian Dreams', (body) => {
        const pic = stillPicture(g.files, file, ['md_title.pal', 0], layers);
        if (pic) {
          pic.className = 'scene';
          body.append(pic);
        }
        body.append(el('p', '', text));
        const row = el('div', 'row');
        row.append(btn('Skip', () => show(it.next(''))), btn('Continue', () => introPage(i + 1), 'primary'));
        body.append(row);
      });
    };
    // The introduction in motion, on its own clock as run_introduction plays it, the words beneath; or page by page where it cannot play.
    const film = (): void => {
      let moving: ReturnType<typeof play> = null;
      const done = (): void => {
        moving?.stop();
        this.onClose = null;
        show(it.next(''));
      };
      this.open('Martian Dreams', (body) => {
        const caption = el('p', 'caption');
        const row = el('div', 'row');
        const skip = btn('Skip', done);
        moving = play(g.files, ['md_title.pal', 0], mdIntroScene((n) => g.sceneText('scenetxt.lzc', n), () => loadImages(g.files, 'scene2.lzc')[0]?.[0] ?? null), {
          text: (t, [r, gr, b]) => {
            caption.textContent = t;
            caption.style.color = `rgb(${r},${gr},${b})`;
          },
          end: () => {
            skip.textContent = 'Continue';
            skip.classList.add('primary');
          },
        });
        if (!moving) return introPage(0);
        moving.canvas.className = 'scene';
        row.append(skip);
        body.append(moving.canvas, caption, row);
      });
      this.onClose = () => moving?.stop();
    };
    const show = (r: IteratorResult<Step, Hero>): void => {
      if (r.done) {
        g.createHero({ ...r.value, face: 0 });
        this.close();
        return;
      }
      const step = r.value;
      this.open('Sigmund Freud', (body) => {
        body.append(el('p', step.freud ? 'speech' : '', step.text));
        const row = el('div', step.ask === 'go' ? 'row' : 'answers');
        if (step.ask === 'name') {
          const form = el('form');
          form.className = 'row';
          const input = el('input');
          input.maxLength = 13;
          input.placeholder = 'Your name';
          const ok = btn('Answer', () => {}, 'primary');
          ok.type = 'submit';
          form.append(input, ok);
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (input.value.trim()) show(it.next(input.value));
          });
          body.append(form);
          setTimeout(() => input.focus(), 50);
          return;
        }
        if (step.ask === 'go') row.append(btn('Continue', () => show(it.next('')), 'primary'));
        else for (const k of step.ask === 'ab' ? ['a', 'b'] : ['a', 'b', 'c']) row.append(btn(k.toUpperCase(), () => show(it.next(k))));
        body.append(row);
      });
    };
    if (intro.length && g.files.has('scene1.lzc')) {
      this.open('Martian Dreams', (body) => {
        body.append(el('p', '', 'A new Avatar: the introduction, then Freud\'s questions.'));
        const row = el('div', 'row');
        row.append(btn('Skip the introduction', () => show(it.next(''))), btn('Watch the introduction', () => film(), 'primary'));
        body.append(row);
      });
    } else show(it.next(''));
  }

  /** Savage Empire's new Avatar: Intanya the shaman's questions (intro.lua's create_new_character). */
  private intanya(): void {
    const g = this.game;
    const shaman = new Intanya((lo, hi) => lo + g.random(hi - lo + 1));
    let name = 'Avatar';
    const page = (text: string, next: () => void): void => {
      this.open('Intanya', (body) => {
        body.append(el('p', '', text));
        const row = el('div', 'row');
        row.append(btn('Continue', next, 'primary'));
        body.append(row);
      });
    };
    const question = (): void => {
      if (shaman.done) {
        const [str, dex, int] = shaman.stats;
        g.createHero({ name, female: false, face: 0, str, dex, int });
        return page('Intanya\'s potion burns, then soothes. Your strength returns... and the Valley of Eodon awaits.', () => this.close());
      }
      this.open(`Intanya asks (${shaman.asked + 1} of 3)`, (body) => {
        const t = QUESTIONS_SE[shaman.q];
        const m = t.match(/^(.*?)(?:Will you|Do you) \(a\) (.*?),? or \(b\) (.*)$/);
        body.append(el('p', '', m ? `${m[1]}` : t));
        const list = el('div', 'answers');
        list.append(btn(`(a) ${m ? m[2] : 'A'}`, () => (shaman.answer(true), question())), btn(`(b) ${m ? m[3] : 'B'}`, () => (shaman.answer(false), question())));
        body.append(list);
      });
    };
    const askName = (): void => {
      this.open('Intanya', (body) => {
        body.append(el('p', '', ASK_NAME));
        const form = el('form');
        form.className = 'row';
        const input = el('input');
        input.maxLength = 13;
        input.placeholder = 'Your name';
        const ok = btn('Answer', () => {}, 'primary');
        ok.type = 'submit';
        form.append(input, ok);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (!input.value.trim()) return;
          name = input.value.trim();
          question();
        });
        body.append(form);
        setTimeout(() => input.focus(), 50);
      });
    };
    const begin = (): void => page(INTRO[0], () => page(INTRO[1], () => page(INTRO[2], askName)));
    // The story so far, as the game's menu offers it: ten pictures with their words.
    const story = (i: number): void => {
      if (i >= SE_STORY.length) return begin();
      this.open('The story so far', (body) => {
        const pic = stillPicture(g.files, 'create.lzc', ['savage.pal', 1], [[5, 0, 0, 0], [5, i + 1, 120, 45]]);
        if (pic) {
          pic.className = 'scene';
          body.append(pic);
        }
        body.append(el('p', '', SE_STORY[i]));
        const row = el('div', 'row');
        row.append(btn('Skip', begin), btn('Continue', () => story(i + 1), 'primary'));
        body.append(row);
      });
    };
    // The title first, in motion as intro_sequence plays it (where intro.lzc is there).
    const title = (): void => {
      let moving: ReturnType<typeof play> = null;
      const next = (): void => {
        moving?.stop();
        this.onClose = null;
        story(0);
      };
      this.open('The Savage Empire', (body) => {
        const row = el('div', 'row');
        const go = btn('Skip', next);
        moving = g.files.has('intro.lzc') ? play(g.files, ['savage.pal', 0], seTitleScene(), { end: () => {
          go.textContent = 'Continue';
          go.classList.add('primary');
        } }) : null;
        if (!moving) return story(0);
        moving.canvas.className = 'scene';
        row.append(go);
        body.append(moving.canvas, row);
      });
      this.onClose = () => moving?.stop();
    };
    if (g.files.has('create.lzc')) {
      this.open('The Savage Empire', (body) => {
        body.append(el('p', '', 'A new Avatar: the story so far, then Intanya\'s questions.'));
        const row = el('div', 'row');
        row.append(btn('Skip the story', begin), btn('The story so far', () => title(), 'primary'));
        body.append(row);
      });
    } else begin();
  }

  private gypsy(name: string, female: boolean, face: number): void {
    const who = name.trim() || 'Avatar';
    const contest = new Gypsy();
    const ask = (): void => {
      if (contest.done) return finish();
      const q = contest.question();
      this.open(`The gypsy asks (${contest.asked + 1} of 7)`, (body) => {
        body.append(el('p', '', `"${q.text}`));
        const pick = (w: 'a' | 'b'): void => {
          contest.answer(w);
          this.sfx.play('success');
          ask();
        };
        const list = el('div', 'answers');
        list.append(btn(`A) ${q.a}`, () => pick('a')), btn(`B) ${q.b}`, () => pick('b')));
        body.append(list);
      });
    };
    const finish = (): void => {
      this.open('The gypsy', (body) => {
        body.append(
          el('p', '', `"The path of the Avatar lies beneath thy feet, worthy ${who}," the gypsy intones. With a mysterious smile, she passes you the flask of shimmering liquids. "Drink of these waters and go forth among our people, who shall receive thee in joy!"`),
          el('p', 'small', `Strength ${contest.str}, dexterity ${contest.dex}, intelligence ${contest.int}.`),
        );
        const row = el('div', 'row');
        row.append(btn('Drink', () => {
          this.game.createHero({ name: who, female, face, str: contest.str, dex: contest.dex, int: contest.int });
          this.open('Britannia', (b) => {
            b.append(
              el('p', '', 'As you drink from the flask, vertigo overwhelms you. A soothing mist obscures the gypsy\'s face, and you sink without fear into an untroubled sleep.'),
              el('p', '', 'You wake in a different time, upon another world\'s shore. Though the Avatar\'s quests bring you both triumph and tragedy, never do you stray from the path of the Eight Virtues.'),
              el('p', '', 'Finally, tempered by your struggles against the enemies of Virtue, you are proven ready to answer the epic challenge of Ultima VI!'),
            );
            const r = el('div', 'row');
            r.append(btn('Begin', () => this.close(), 'primary'));
            b.append(r);
          });
        }, 'primary'));
        body.append(row);
      });
    };
    this.open('The gypsy', (body) => {
      body.append(
        el('p', '', '"At last thou hast come to fulfill thy destiny," the gypsy says. She smiles, as if in great relief. "Sit before me now, and I shall pour the light of Virtue into the shadows of thy future."'),
        el('p', '', 'On a wooden table eight bottles stand, a rainbow of bubbling liquids. "Behold the Virtues of the Avatar," the woman says. "Let us begin the casting!"'),
      );
      const row = el('div', 'row');
      row.append(btn('Begin', ask, 'primary'));
      body.append(row);
    });
  }

  dispose: () => void;

  /** Squares added across by pinching out (even, so the party stays in the middle). */
  private zoomOut = 0;
  private zoomReset!: HTMLButtonElement;

  /** The default zoom: as many squares across as keeps each a comfortable size for a finger. */
  private baseCols(): number {
    const w = this.view.canvas.getBoundingClientRect().width || 352;
    // At least 11 squares, each at most 40 pixels; odd, so the party stands in the middle.
    let n = Math.floor(w / 32);
    if (n % 2 === 0) n--;
    return Math.max(11, Math.min(15, n));
  }

  private setZoom(extra: number): void {
    const z = Math.min(24, extra - (extra % 2));
    if (z === this.zoomOut) return;
    this.zoomOut = z;
    this.layout();
  }

  private layout(): void {
    const n = this.baseCols() + this.zoomOut;
    if (n !== this.view.cols) this.view.resize(n, n);
    this.zoomReset.hidden = this.zoomOut === 0;
    this.view.render();
  }

  // ---- what a tap on the map means ----

  private tap(sq: { x: number; y: number }): void {
    const g = this.game;
    if (g.converse || this.busy) return;
    clearTimeout(this.walkTimer);
    const p = g.player;
    const mode = this.mode;
    this.setMode(null);
    if (mode === 'where' && g.askWhere) {
      this.walk = null;
      g.askWhere.then(sq.x, sq.y);
      return;
    }
    if (mode === 'cast' && this.pending) {
      const { caster, spell } = this.pending;
      this.pending = null;
      this.walk = null;
      if (this.view.visible(sq.x, sq.y)) g.castSpell(caster, spell, sq.x, sq.y);
      return;
    }
    if (mode === 'look') {
      this.walk = null;
      if (this.view.visible(sq.x, sq.y)) g.look(sq.x, sq.y);
      return;
    }
    if (!this.view.visible(sq.x, sq.y)) return;
    // Afloat or astride: the party itself is tapped to get off; land is tapped to go ashore there.
    if (!mode && (g.vehicle || p.objN === 431) && sq.x === p.x && sq.y === p.y) {
      g.use(p.x, p.y);
      return;
    }
    if (!mode && g.vehicle) {
      const water = g.afloat(g.vehicle, sq.x, sq.y);
      this.walk = { ...sq, then: water ? 'walk' : 'use' };
      this.step();
      return;
    }
    if (sq.x === p.x && sq.y === p.y && !mode) {
      // The party itself: what is underfoot, or a turn passed.
      const o = g.objects.get(p.x, p.y, p.z);
      if (o && USABLE.has(o.objN)) g.use(p.x, p.y);
      else if (o) g.get(p.x, p.y);
      else g.pass();
      return;
    }
    let then: Mode | 'walk' = mode ?? 'walk';
    if (!mode) {
      const a = g.actors.at(sq.x, sq.y, p.z);
      const o = g.objects.get(sq.x, sq.y, p.z);
      const door = g.objects.list(sq.x, sq.y, p.z)?.some((d) => g.objects.isDoor(d) && g.objects.isShut(d));
      if (a && !a.inParty) then = g.combat.hostile(a) ? 'attack' : a.objN === 430 && a.id >= 203 ? 'use' : 'talk';
      else if (door || (o && USABLE.has(o.objN) && !g.map.isPassable(sq.x, sq.y, p.z)) || (o && (o.objN === OBJ.LADDER || o.objN === OBJ.CAVE || o.objN === OBJ.HOLE))) then = 'use';
      // Levers, cranks, fires, bells, wells and the like are used where they stand.
      else if (g.kind === 'u6' && (g.objects.list(sq.x, sq.y, p.z) ?? []).some((n) => USED_IN_PLACE.has(n.objN) && !(n.status & 0x02))) then = 'use';
      else if (g.kind === 'md' && (g.objects.list(sq.x, sq.y, p.z) ?? []).some((n) => MD_IN_PLACE.has(n.objN) && !(n.status & 0x02))) then = 'use';
      else if (g.kind === 'se' && (g.objects.list(sq.x, sq.y, p.z) ?? []).some((n) => n.objN === 61)) then = 'use'; // a corn stalk
      else if (a && a.objN === 428 && g.kind === 'u6') then = 'use';
    }
    const foe = then === 'attack' ? g.actors.at(sq.x, sq.y, p.z) ?? undefined : undefined;
    this.walk = { ...sq, then, foe };
    this.step();
  }

  /** Walk towards wherever the finger is, a step at a time, while `where` gives a square. */
  private hold(where: () => { x: number; y: number } | null): void {
    clearTimeout(this.walkTimer);
    const g = this.game;
    const sq = where();
    if (!sq || g.converse) return;
    const p = g.player;
    if (sq.x !== p.x || sq.y !== p.y) {
      // Held, the party walks into no one: talking and fighting are a tap's.
      const path = g.pathTo(sq.x, sq.y) ?? g.pathTo(sq.x, sq.y, true);
      if (path && path.length) {
        this.walk = { ...sq, then: 'walk' };
        this.mark(path);
        const [dx, dy] = path[0];
        const t = g.actors.at(p.x + dx, p.y + dy, p.z);
        if (!t || t.inParty || (g.vehicle && t === g.vehicle)) g.move(dx, dy);
      }
    }
    this.walkTimer = window.setTimeout(() => this.hold(where), 170);
  }

  /** One step of the way to what was tapped; at the end of it, what the tap was for. */
  private step(): void {
    const g = this.game;
    const w = this.walk;
    if (w && this.busy) {
      // The fighters are still taking their turns: the party's next step waits for them.
      clearTimeout(this.walkTimer);
      this.walkTimer = window.setTimeout(() => this.step(), 60);
      return;
    }
    if (!w || g.converse) {
      this.walk = null;
      this.mark();
      return;
    }
    const p = g.player;
    const beside = w.then !== 'walk';
    const near = Math.abs(w.x - p.x) <= 1 && Math.abs(w.y - p.y) <= 1;
    // A foe moves: follow them.
    if (w.foe) {
      if (!w.foe.alive || !w.foe.visible || w.foe.objN === 0 || w.foe.z !== g.player.z) {
        this.walk = null;
        this.mark();
        return;
      }
      w.x = w.foe.x;
      w.y = w.foe.y;
    }
    // An attack from wherever the weapon reaches.
    if (w.then === 'attack' && g.attackAt(w.x, w.y)) {
      this.walk = null;
      this.mark();
      return;
    }
    if (beside && near && w.then !== 'attack') {
      this.walk = null;
      this.mark();
      if (w.then === 'talk') g.talk(w.x, w.y);
      else if (w.then === 'use') g.use(w.x, w.y);
      else if (w.then === 'get') g.get(w.x, w.y);
      return;
    }
    const path = g.pathTo(w.x, w.y, beside);
    if (!path || path.length === 0) {
      this.walk = null;
      this.mark();
      if (!path) {
        g.say('sys', 'No way there.');
        this.changed();
      }
      return;
    }
    this.mark(path);
    if (!g.move(path[0][0], path[0][1])) {
      this.walk = null;
      this.mark();
      return;
    }
    this.walkTimer = window.setTimeout(() => this.step(), 130);
  }

  /** Mark the way and its end over the map. */
  private mark(path?: [number, number][]): void {
    const w = this.walk;
    this.view.marks = [];
    if (w && path) {
      const color = w.then === 'talk' ? '#7fb8ff' : w.then === 'attack' ? '#ff4a3a' : w.then === 'walk' ? '#ffd24a' : '#ffffff';
      let { x, y } = this.game.player;
      for (const [dx, dy] of path.slice(0, -1)) {
        x += dx;
        y += dy;
        this.view.marks.push({ x, y, color, kind: 'dot' });
      }
      this.view.marks.push({ x: w.x, y: w.y, color, kind: 'box' });
    }
    this.view.render();
  }

  private key(e: KeyboardEvent): void {
    if (this.sheet || (e.target as HTMLElement).tagName === 'INPUT') return;
    const g = this.game;
    const dirs: Record<string, [number, number]> = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (g.converse) {
      if (e.key === 'Enter' || e.key === ' ') g.continueTalk();
      return;
    }
    const d = dirs[e.key];
    if (d) {
      e.preventDefault();
      this.walk = null;
      g.move(d[0], d[1]);
    } else if (e.key === ' ') g.pass();
    else if (e.key === 'c') this.spellbook();
    else if ('ltuga'.includes(e.key)) this.setMode(({ l: 'look', t: 'talk', u: 'use', g: 'get', a: 'attack' } as const)[e.key as 'l']);
  }

  private setMode(m: Mode): void {
    this.mode = m;
    this.modeTag.hidden = !m;
    if (m) this.modeTag.textContent = m === 'where' && this.game.askWhere ? this.game.askWhere.label : m === 'cast' && this.pending ? `${this.pending.spell.name}: tap where` : `${m[0].toUpperCase() + m.slice(1)}: tap where`;
    this.footKey = '';
    this.drawFoot();
  }

  private setPane(p: Pane): void {
    this.pane = p;
    this.changed();
  }

  // ---- drawing everything but the map ----

  private changed(): void {
    const g = this.game;
    this.music?.update();
    if (g.openContainer && g.openContainer !== this.shownContainer && !g.converse) this.containerSheet(g.openContainer);
    if (g.askText && !this.sheet) this.textSheet();
    if (g.askChoice && !this.sheet) this.choiceSheet();
    if (g.openBook) {
      g.openBook = false;
      this.spellbook();
    }
    if (g.scry) {
      const at = g.scry;
      g.scry = null;
      this.open('Crystal ball', (body) => {
        const map = this.view.overhead(128, at);
        map.className = 'overhead';
        body.append(map, el('p', 'small', 'A place far off, as the crystal ball shows it.'));
      });
    }
    if (g.won && !this.sheet) this.ending();
    if (g.cutscene !== null && !this.sheet) {
      const n = g.cutscene;
      g.cutscene = null;
      this.midgame(n);
    }
    if (g.peer) {
      g.peer = false;
      this.open(g.kind === 'u6' ? 'Peer' : 'Map', (body) => {
        const map = this.view.overhead(128);
        map.className = 'overhead';
        body.append(map, el('p', 'small', `The land about, from above: ${g.where()}.`));
      });
    }
    if (g.askWhere && this.mode !== 'where') {
      this.sheet?.remove();
      this.sheet = null;
      this.setMode('where');
    }
    this.view.render();
    this.status.textContent = `${String(g.clock.hour).padStart(2, '0')}:${String(g.clock.minute).padStart(2, '0')}`;
    // Afloat or aloft, the wind matters: shown as the way it blows from.
    if (g.vehicle) {
      const [dx, dy] = g.wind;
      const from = (dy > 0 ? 'N' : dy < 0 ? 'S' : '') + (dx > 0 ? 'W' : dx < 0 ? 'E' : '');
      this.status.textContent += ` ${from ? `Wind ${from}` : 'Calm'}`;
    }
    if (g.player.z === 0) this.surface = { x: g.player.x, y: g.player.y };
    // While someone talks, or a container stands open, the pane shows the log whatever was chosen.
    const pane: Pane = g.converse ? 'log' : this.pane;
    this.face.hidden = !(g.converse && g.speaker);
    const sp = g.converse ? g.speaker : null;
    if (sp && (sp.actor !== this.faceOf || this.face.textContent !== sp.name)) {
      this.faceOf = sp.actor;
      const a = g.actors.get(sp.actor);
      this.face.replaceChildren();
      if (a) this.face.append(this.facePicture(a));
      this.face.append(el('div', 'facename', sp.name));
    }
    if (this.root.classList.toggle('talking', !!g.converse) !== this.wasTalking) {
      this.wasTalking = !this.wasTalking;
      if (this.wasTalking) this.talkFrom = Math.max(0, g.log.length - 3);
      requestAnimationFrame(() => this.layout());
    }
    this.tabLog.classList.toggle('on', pane === 'log');
    this.tabParty.classList.toggle('on', pane === 'party');
    if (pane === 'log') this.seenLog = g.log.length;
    this.tabLog.classList.toggle('news', pane !== 'log' && g.log.length > this.seenLog);
    if (pane === 'log') this.drawLog();
    else this.drawParty();
    this.drawFoot();
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => !g.converse && this.hooks.save(g.save()), 1500);
  }

  private facePicture(a: Actor): HTMLCanvasElement {
    const p = this.game.portrait(a);
    return p ? this.view.portraitImage(p) : this.view.tileImage(this.game.objects.objToTile[a.objN] + 8);
  }

  private drawLog(): void {
    const g = this.game;
    const log = el('div', 'log');
    // In a conversation, the words its speaker answers to are marked, and a tap asks about them.
    const c = g.converse;
    const keys = c ? g.lib.keywords(g.lib.scriptNum(c.npc)).filter((k) => k !== '*' && k.length > 1) : [];
    const fits = (w: string): boolean => {
      const lw = w.toLowerCase().replace(/'s$/, '');
      return lw.length >= 3 && keys.some((k) => k.length >= Math.min(4, lw.length) && lw.slice(0, k.length) === k);
    };
    // In a conversation the window holds only this exchange: from what was last said to them (or their greeting).
    let from = Math.max(0, g.log.length - 60);
    if (c) {
      from = Math.max(from, this.talkFrom);
      for (let i = g.log.length - 1; i >= from; i--) {
        if (g.log[i].kind === 'you') {
          from = i;
          break;
        }
      }
    }
    g.log.slice(from).forEach((line, i, shown) => {
      const p = el('p', line.kind);
      const text = line.text.replace(/^\n+|\n+$/g, '');
      if (!text) return;
      const current = c && g.log.length - shown.length + i >= this.talkFrom;
      if (line.kind === 'npc') {
        p.innerHTML = esc(text).replace(/(@?)([A-Za-z]+(?:'[A-Za-z]+)*)/g, (m, at: string, w: string) =>
          at || (current && fits(w)) ? `<span class="kw" data-say="${w.toLowerCase().replace(/'s$/, '')}">${w}</span>` : m,
        );
      } else p.textContent = text;
      log.append(p);
    });
    log.addEventListener('click', (e) => {
      const say = (e.target as HTMLElement).dataset?.say;
      if (say && g.asking()?.type === 'keyword') {
        this.optsAt = g.log.length;
        g.reply(say);
      }
    });
    const grew = g.log.length !== this.logLength;
    this.logLength = g.log.length;
    this.body.replaceChildren(log);
    if (c) {
      // A new exchange is read from its top; nothing to scroll down to find.
      if (from !== this.exchangeFrom) {
        this.exchangeFrom = from;
        this.body.scrollTop = 0;
      }
      this.stick = false;
      requestAnimationFrame(() => this.drawThumb());
      return;
    }
    this.exchangeFrom = -1;
    if (grew) this.stick = true;
    this.toBottom();
  }

  /** Where the conversation's exchange now shown begins in the log. */
  private exchangeFrom = -1;
  /** The log's length when the player last chose to see the topics: until then, Continue. */
  private optsAt = -1;

  private thumb!: HTMLElement;
  /** When the next fighter may take their turn. */
  private turnAt = 0;
  private battleSpeed = (() => {
    try {
      const saved = localStorage.getItem('nuvie.battle');
      const v = saved === null ? 1 : Number(saved);
      return v >= 0 && v < BATTLE_SPEEDS.length ? v : 1;
    } catch {
      return 1;
    }
  })();

  /** While fighters take their turns, the player waits. */
  private get busy(): boolean {
    return this.game.combat.queue.length > 0;
  }

  /** The scroll bar's thumb: shown only when there is more than fits. */
  private drawThumb(): void {
    const b = this.body;
    const more = b.scrollHeight > b.clientHeight + 2;
    this.thumb.parentElement!.hidden = !more;
    if (!more) return;
    const track = this.thumb.parentElement!.clientHeight;
    const h = Math.max(16, (b.clientHeight / b.scrollHeight) * track);
    this.thumb.style.height = `${h}px`;
    this.thumb.style.top = `${(b.scrollTop / (b.scrollHeight - b.clientHeight)) * (track - h)}px`;
  }

  /** Party rows sized so four fill the pane and a fifth shows its top: there is more below. */
  private sizeParty(): void {
    const list = this.body.firstElementChild as HTMLElement | null;
    if (!list || this.pane !== 'party') return;
    const head = list.querySelector<HTMLElement>('.partyhead');
    const room = this.body.clientHeight - (head?.offsetHeight ?? 0);
    const rowH = Math.max(40, Math.floor(room / 4.4));
    for (const r of list.querySelectorAll<HTMLElement>('.member')) r.style.height = `${rowH}px`;
  }

  /** Keep the newest lines in view, unless the player has scrolled back to read. */
  private toBottom(): void {
    requestAnimationFrame(() => this.drawThumb());
    if (!this.stick) return;
    this.body.scrollTop = this.body.scrollHeight;
    requestAnimationFrame(() => {
      if (this.stick) this.body.scrollTop = this.body.scrollHeight;
    });
  }

  private itemRow(o: Obj, sub = false): HTMLElement {
    const g = this.game;
    const row = el('div', sub ? 'item sub' : 'item');
    const name = el('div');
    name.append(el('div', '', g.objects.look(o) + (o.loc === 'readied' ? ' (readied)' : '')), el('div', 'small', `${g.objects.weightOf(o).toFixed(1)} stones`));
    row.append(this.view.tileImage(g.objects.tileNum(o)), name);
    return row;
  }

  private drawParty(): void {
    const g = this.game;
    const list = el('div');
    const head = el('div', 'partyhead');
    head.append(el('span', '', g.date()), el('span', '', `Gold ${g.gold()}`));
    list.append(head);
    for (const m of g.party) {
      const a = m.actor;
      const row = el('div', 'member');
      const mid = el('div');
      const bar = el('div', 'bar');
      const fill = el('i');
      fill.style.width = `${Math.max(0, Math.min(100, (a.hp / Math.max(1, a.maxHp)) * 100))}%`;
      bar.append(fill);
      mid.append(el('div', 'name', m.name), bar);
      row.append(this.view.tileImage(g.objects.objToTile[a.objN] + 8), mid, el('div', '', `${a.hp}/${a.maxHp}`));
      row.addEventListener('click', () => this.character(m.actor, m.name));
      list.append(row);
    }
    this.body.replaceChildren(list);
    this.body.scrollTop = 0;
    this.sizeParty();
    this.drawThumb();
  }

  private drawFoot(): void {
    const g = this.game;
    const ask = g.asking();
    const opts = ask ? g.sayOptions() : [];
    // Rebuilt only when what it offers changes, so a text being typed is not lost.
    const gate = !!g.converse && !g.paused && ask?.type === 'keyword' && this.optsAt !== g.log.length;
    const key = g.converse ? `say:${g.paused}:${gate}:${ask?.type}:${opts.map((o) => o.say + o.heard).join()}:${g.log.length}` : `cmd:${this.mode}`;
    if (key === this.footKey) return;
    this.footKey = key;
    if (!g.converse) {
      const bar = el('div', haveIcons ? 'bar-cmds icons' : 'bar-cmds');
      const icon = (b: HTMLButtonElement, tile: number): HTMLButtonElement => {
        b.setAttribute('aria-label', b.textContent ?? '');
        if (haveIcons) {
          b.replaceChildren();
          b.classList.add('iconbtn');
          const c = this.view.tileImage(tile);
          c.className = 'icon';
          b.prepend(c);
        }
        return b;
      };
      const m = (label: string, mode: Mode, tile: number): HTMLButtonElement =>
        icon(btn(label, () => this.setMode(this.mode === mode ? null : mode), this.mode === mode ? 'on' : ''), tile);
      bar.append(
        m('Attack', 'attack', 400),
        // Martian Dreams and Savage Empire have no spells: the land about, seen from above, instead.
        g.kind === 'u6' ? icon(btn('Cast', () => this.spellbook()), 401) : btn('Map', () => {
          g.peer = true;
          this.changed();
        }),
        m('Look', 'look', 403), m('Talk', 'talk', 402), m('Use', 'use', 407), m('Get', 'get', 404),
        icon(btn('Rest', () => this.restSheet()), 408), icon(btn('Notes', () => this.journal()), 409),
      );
      this.foot.replaceChildren(bar);
      return;
    }
    const say = el('div', 'say');
    if (g.paused) say.append(btn('Continue', () => g.continueTalk(), 'primary'));
    else if (gate) {
      // They have said their piece: Continue, and then the topics.
      say.append(btn('Continue', () => {
        this.optsAt = g.log.length;
        this.drawFoot();
      }, 'primary'));
    } else if (ask) {
      const list = el('div', 'opts');
      // What has not been asked first; what has, greyed, after.
      const sorted = [...opts.filter((o) => !o.heard && o.say !== 'bye'), ...opts.filter((o) => o.heard && o.say !== 'bye'), ...opts.filter((o) => o.say === 'bye')];
      for (const o of sorted) {
        const cls = [opts.length <= 2 || o.say === 'bye' ? 'wide' : '', o.heard ? 'heard' : ''].filter(Boolean).join(' ');
        list.append(btn(o.label, () => g.reply(o.say), cls));
      }
      if (opts.length) say.append(list);
      if (ask.type !== 'char') {
        const form = el('form');
        const input = el('input');
        input.placeholder = ask.type === 'number' ? 'A number…' : 'Say something else…';
        input.inputMode = ask.type === 'number' ? 'numeric' : 'text';
        input.autocapitalize = 'off';
        input.autocomplete = 'off';
        form.append(input, btn('Say', () => {}, 'primary'));
        (form.lastChild as HTMLButtonElement).type = 'submit';
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          if (input.value.trim() || ask.type !== 'keyword') g.reply(input.value);
        });
        say.append(form);
      }
    }
    this.foot.replaceChildren(say);
  }

  // ---- sheets ----

  private open(title: string, fill: (body: HTMLElement) => void): void {
    this.sheet?.remove();
    const f = this.onClose;
    this.onClose = null;
    f?.();
    const sheet = el('div', 'sheet');
    const box = el('div', 'paper');
    const head = el('header');
    const body = el('div', 'body');
    head.append(el('h2', '', title), btn('X', () => this.close()));
    box.append(head, body);
    sheet.append(box);
    sheet.addEventListener('click', (e) => e.target === sheet && this.close());
    fill(body);
    document.body.append(sheet);
    this.sheet = sheet;
  }

  /** Run once when the sheet now open closes. */
  private onClose: (() => void) | null = null;

  private close(): void {
    this.sheet?.remove();
    this.sheet = null;
    const f = this.onClose;
    this.onClose = null;
    f?.();
    this.changed();
  }

  /**
   * The paper doll (DollWidget, the original look): the body from the game's own tiles (368 to 371), and round it a
   * ring for each place a thing is worn or held - head, neck, body, both arms, both hands for rings, feet - with what
   * is readied there. A ring held by a two-handed weapon is barred. Tapping a place picks what is there.
   */
  private doll(a: Actor, pick: (o: Obj) => void): HTMLCanvasElement | null {
    const g = this.game;
    if (g.kind !== 'u6' || !haveIcons) return null;
    const S = 16;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    c.className = 'doll';
    const ctx = c.getContext('2d')!;
    const put = (tile: number, x: number, y: number): void => ctx.drawImage(this.view.tileImage(tile), x, y);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) put(368 + i * 2 + j, S + j * S, S + i * S);
    // Where each place is (DollWidget::display_doll).
    const at: Record<string, [number, number]> = {
      head: [24, 0], neck: [0, 8], body: [48, 8], arm: [0, 24], arm2: [48, 24], hand: [0, 40], hand2: [48, 40], foot: [24, 48],
    };
    const worn: Record<string, Obj | 'barred'> = {};
    for (const o of g.objects.inventories[a.id] ?? []) {
      if (o.loc !== 'readied') continue;
      const slot = g.readySlot(o);
      if (slot === 0) worn.head = o;
      else if (slot === 1) worn.neck = o;
      else if (slot === 2) worn.body = o;
      else if (slot === 7) worn.foot = o;
      else if (slot === 4) {
        worn.arm = o;
        worn.arm2 = 'barred';
      } else if (slot === 3) {
        if (!worn.arm) worn.arm = o;
        else worn.arm2 = o;
      } else if (slot === 5) {
        if (!worn.hand) worn.hand = o;
        else worn.hand2 = o;
      }
    }
    for (const [k, [x, y]] of Object.entries(at)) {
      const w = worn[k];
      if (w === 'barred') put(389, x, y);
      else if (w) put(g.objects.tileNum(w), x, y);
      else put(410, x, y);
    }
    c.addEventListener('click', (e) => {
      const r = c.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 64;
      const y = ((e.clientY - r.top) / r.height) * 64;
      for (const [k, [sx, sy]] of Object.entries(at)) {
        const w = worn[k];
        if (x >= sx && x < sx + S && y >= sy && y < sy + S && w && w !== 'barred') pick(w);
      }
    });
    return c;
  }

  /** What a container in the world holds, over the game, each thing to take or all of it. */
  private containerSheet(c: Obj): void {
    const g = this.game;
    this.shownContainer = c;
    const title = g.objects.look(c).replace(/^(a|an|the) /, '');
    this.open(title[0].toUpperCase() + title.slice(1), (body) => {
      const draw = (): void => {
        body.replaceChildren();
        const inside = c.container ?? [];
        if (!inside.length) {
          body.append(el('p', '', 'Empty.'));
          return;
        }
        for (const o of [...inside]) {
          const row = this.itemRow(o);
          row.append(btn('Take', () => {
            g.get(0, 0, o);
            draw();
          }));
          body.append(row);
        }
        const all = el('div', 'row');
        all.append(btn('Take all', () => {
          for (const o of [...inside]) g.get(0, 0, o);
          draw();
        }, 'primary'));
        body.append(all);
      };
      draw();
    });
    this.onClose = () => {
      g.openContainer = null;
      this.shownContainer = null;
    };
  }

  private character(a: Actor, name: string): void {
    const g = this.game;
    const expanded = new Set<Obj>();
    this.open(name, (body) => {
      const draw = (picked: Obj | null): void => {
        body.replaceChildren();
        const top = el('div', 'member');
        const mid = el('div');
        mid.append(el('div', 'name', g.lookActor(a)), el('div', 'small', `Level ${a.level}, ${a.exp} experience`));
        top.append(this.facePicture(a), mid, el('div'));
        const stats = el('div', 'stats');
        for (const [k, v] of [['Str', a.strength], ['Dex', a.dex], ['Int', a.intelligence], ['Health', `${a.hp}/${a.maxHp}`], ['Magic', a.magic], ['Load', `${Math.round(invWeight(g.objects, a.id))}/${a.maxWeight}`]] as const) {
          const d = el('div');
          d.append(el('b', '', String(v)), el('span', 'small', k));
          stats.append(d);
        }
        body.append(top);
        const doll = this.doll(a, (o) => draw(picked === o ? null : o));
        if (doll) body.append(doll);
        body.append(stats);
        const inv = g.objects.inventories[a.id];
        if (inv.length === 0) body.append(el('p', 'small', 'Carrying nothing.'));
        const add = (o: Obj, depth: number): void => {
          const row = this.itemRow(o, depth > 0);
          if (depth > 1) row.style.marginLeft = `${depth * 24}px`;
          row.addEventListener('click', () => draw(picked === o ? null : o));
          // A container is shut until opened here.
          if (o.container?.length) {
            const open = expanded.has(o);
            const t = btn(open ? '-' : `+${o.container.length}`, () => {
              if (open) expanded.delete(o);
              else expanded.add(o);
              draw(picked);
            }, 'fold');
            t.addEventListener('click', (e) => e.stopPropagation());
            row.append(t);
          }
          body.append(row);
          if (picked === o) {
            const acts = el('div', 'row');
            const done = (f: () => void) => (): void => {
              f();
              draw(null);
            };
            if (o.loc === 'readied') acts.append(btn('Unready', done(() => g.unready(o))));
            else if (g.readiable(o)) acts.append(btn('Ready', done(() => g.ready(o, a))));
            acts.append(btn('Use', done(() => g.useObj(o))), btn('Drop', done(() => g.drop(o))));
            for (const m of g.party) if (m.actor !== a) acts.append(btn(`Give to ${m.name}`, done(() => g.give(o, m.actor))));
            body.append(acts);
          }
          if (o.container && expanded.has(o)) for (const c of o.container) add(c, depth + 1);
        };
        for (const o of inv) add(o, 0);
      };
      draw(null);
    });
  }

  /** Pass a turn, or rest some hours (the original asks how many). */
  private restSheet(): void {
    const g = this.game;
    this.open('Rest', (body) => {
      const row = el('div', 'row');
      row.append(btn('Pass a turn', () => {
        this.close();
        g.pass();
      }));
      body.append(row);
      if (g.kind === 'md') {
        // Martian Dreams camps in a tent (use_tent).
        const tent = g.party.map((m) => g.objects.inventories[m.actor.id].find((o) => o.objN === 106)).find(Boolean);
        body.append(el('p', 'small', tent ? 'Pitch the tent and sleep, away from foes and others.' : 'The party has no tent to sleep in.'));
        if (tent) {
          const r = el('div', 'row');
          r.append(btn('Pitch the tent', () => {
            this.close();
            g.mdUse.tent(null);
            this.changed();
          }, 'primary'));
          body.append(r);
        }
        return;
      }
      body.append(el('p', 'small', 'Camp and sleep - away from towns, foes and others. Those with food heal, once in twelve hours.'));
      const hours = el('div', 'row');
      for (const h of [1, 2, 4, 8]) {
        hours.append(btn(`${h} hour${h > 1 ? 's' : ''}`, () => {
          this.close();
          g.rest(h);
        }));
      }
      body.append(hours);
    });
  }

  /** The game asks for words: a mantra, a bearing. */
  private textSheet(): void {
    const g = this.game;
    const ask = g.askText;
    if (!ask) return;
    this.open(ask.label.replace(/:$/, ''), (body) => {
      const form = el('form');
      form.className = 'row';
      const input = el('input');
      input.autocapitalize = 'characters';
      input.autocomplete = 'off';
      input.placeholder = ask.label;
      const ok = btn('Say', () => {}, 'primary');
      ok.type = 'submit';
      form.append(input, ok);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.onClose = null;
        this.sheet?.remove();
        this.sheet = null;
        g.say('you', input.value);
        ask.then(input.value);
        this.changed();
      });
      body.append(form);
      setTimeout(() => input.focus(), 50);
    });
    this.onClose = () => {
      if (g.askText === ask) g.askText = null;
    };
  }

  /** The game asks for one of a list. */
  private choiceSheet(): void {
    const g = this.game;
    const ask = g.askChoice;
    if (!ask) return;
    this.open(ask.label, (body) => {
      const list = el('div', 'choices');
      ask.options.forEach((name, i) => {
        list.append(btn(name, () => {
          this.onClose = null;
          this.sheet?.remove();
          this.sheet = null;
          g.say('you', name);
          ask.then(i);
          this.changed();
        }));
      });
      body.append(list);
    });
    this.onClose = () => {
      if (g.askChoice === ask) g.askChoice = null;
    };
  }

  /** The game is won: ending.lua's scenes, as pages of its words. */
  private ending(): void {
    const g = this.game;
    if (g.kind !== 'u6') return this.mdEnding();
    const name = g.playerName();
    const pages = [
      'Tremors shake the shrine as the Vortex Cube draws the Codex into the Ethereal Void. A glowing portal springs from the floor!',
      'From its crimson depths Lord British emerges, trailed by the mage Nystul. Anguish and disbelief prevail on the royal seer\'s face, but Lord British directs his stony gaze at you and speaks as if to a wayward child.',
      '"Thou didst have just cause to burgle our Codex, I trust," His Majesty says. "But for Virtue\'s sake... WHAT HAST THOU DONE WITH IT?"',
      'You pick up the concave lens and pass it to the King. "Was the book ever truly ours, Your Majesty? Was it written for Britannia alone? Thou dost no longer hold the Codex, but is its wisdom indeed lost? Look into the Vortex, and let the Codex answer for itself!"',
      'As Lord British holds the glass before the wall, the Codex of Ultimate Wisdom wavers into view against a myriad of swimming stars! Yet the book remains closed.',
      'And waves of heat shimmer in the air, heralding the birth of another red gate!',
      'King Draxinusom of the Gargoyles strides forward, flanked by a small army of wingless attendants. Like Lord British, he seems to suppress his rage only through a heroic effort of will. His scaly hand grasps your shoulder, and your Amulet of Submission grows very warm. "Thy time hath come, Thief," he says.',
      'Quickly you reach down to seize the convex lens... and you press it into the hand of the towering Gargoyle king, meeting his sunken eyes. "Join my Lord in his search for peace, I beg thee."',
      'At your urging, King Draxinusom reluctantly raises his lens to catch the light. As Lord British holds up his own lens, every eye in the room, human and Gargoyle alike, fixes upon the image of the Codex which shines upon the wall.',
      'The ancient book opens. Both kings gaze upon its pages in spellbound silence, as the eloquence of Ultimate Wisdom is revealed in the tongues of each lord\'s domain. You, too, can read the answers the Codex gives...',
      '...and when its wisdom is gleaned, when Lord British and King Draxinusom turn to each other as friends, hating no longer, fearing no more, you know that your mission in Britannia has ended at last.',
    ];
    // How long the quest took (ending.lua: a year of 365 days, a month of 30, from 4 July 161).
    const c = g.clock;
    const time = Math.max(0, c.year * 365 + c.month * 30 + c.day - (161 * 365 + 7 * 30 + 4));
    const years = Math.floor(time / 365);
    const months = Math.floor((time - years * 365) / 30);
    const days = time - years * 365 - months * 30;
    const count = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;
    const spent = [years && count(years, 'year'), months && count(months, 'month'), (days || (!years && !months)) && count(days, 'day')].filter(Boolean) as string[];
    const took = spent.length > 1 ? `${spent.slice(0, -1).join(', ')} and ${spent.at(-1)}` : spent[0];
    this.music.theme = 'end';
    this.music.update();
    const page = (i: number): void => {
      this.open(i < pages.length ? 'The Codex' : 'Congratulations', (body) => {
        // The scene moves as ending.lua plays it; a still where it cannot.
        const moving = play(g.files, ['endpal.lbm', 0], u6EndingScene(Math.min(i, pages.length - 1)));
        stop = moving?.stop ?? null;
        const pic = moving?.canvas ?? endingPicture(g.files, 'u6', Math.min(i, pages.length - 1), g.gender === 1);
        if (pic) {
          pic.className = 'scene';
          body.append(pic);
        }
        if (i < pages.length) body.append(el('p', '', pages[i]));
        else {
          body.append(
            el('p', '', `Thou hast completed Ultima VI: The False Prophet, in ${took}.`),
            el('p', '', `Well done, ${name}.`),
            el('p', 'small', 'Thou mayest go on in Britannia as long as thou wilt.'),
          );
        }
        const row = el('div', 'row');
        row.append(btn(i < pages.length ? 'Continue' : 'Close', () => {
          stop?.();
          if (i < pages.length) {
            this.onClose = null; // the next page, not the end of it
            page(i + 1);
          } else this.close();
        }, 'primary'));
        body.append(row);
      });
      this.onClose = () => {
        stop?.();
        g.won = false;
        this.music.theme = null;
        this.music.update();
      };
    };
    let stop: (() => void) | null = null;
    page(0);
  }

  /** Martian Dreams' ending (ending.lua): its lines from scenetxt.lzc, a page each. */
  private mdEnding(): void {
    const g = this.game;
    const pages = g.kind === 'se' ? SE_ENDING : g.sceneText('scenetxt.lzc', 3).filter((l) => l.trim());
    const page = (i: number): void => {
      this.open(i < pages.length ? 'Home' : 'The end', (body) => {
        // Martian Dreams' ending moves, as its ending.lua plays it; Savage Empire's is still pictures.
        const moving = g.kind === 'md' ? play(g.files, ['md_title.pal', 0], mdEndingScene(Math.min(i, pages.length - 1), g.gender === 1)) : null;
        stop = moving?.stop ?? null;
        const pic = moving?.canvas ?? endingPicture(g.files, g.kind as 'md' | 'se', i, g.gender === 1);
        if (pic) {
          pic.className = 'scene';
          body.append(pic);
        }
        body.append(el('p', '', i < pages.length ? pages[i] : `Well done, ${g.playerName()}. Thou mayest go on exploring ${g.kind === 'se' ? 'the Valley of Eodon' : 'Mars'}.`));
        const row = el('div', 'row');
        row.append(btn(i < pages.length ? 'Continue' : 'Close', () => {
          stop?.();
          if (i < pages.length) {
            this.onClose = null;
            page(i + 1);
          } else this.close();
        }, 'primary'));
        body.append(row);
      });
      this.onClose = () => {
        stop?.();
        g.won = false;
      };
    };
    let stop: (() => void) | null = null;
    page(0);
  }

  /** The spellbook: who casts, their magic and reagents, and the spells in their book by circle. */
  private spellbook(): void {
    const g = this.game;
    const casters = g.magic.casters();
    this.open('Spellbook', (body) => {
      const draw = (who: Actor | undefined): void => {
        body.replaceChildren();
        if (!who) {
          body.append(el('p', '', 'No one in the party has a spellbook readied.'), el('p', 'small', 'Spellbooks and reagents are sold in the towns; ready the book from a member\'s sheet (Party, then their name).'));
          return;
        }
        if (casters.length > 1) {
          const seg = el('div', 'seg');
          for (const c of casters) seg.append(btn(g.partyMemberName(c.id) || g.lookActor(c), () => draw(c), c === who ? 'on' : ''));
          body.append(seg);
        }
        const counts = reagentCounts(g, who);
        body.append(
          el('div', 'partyhead', `Magic ${who.magic}/${g.magic.maxMagic(who)}  Level ${who.level}`),
          el('p', 'small', REAGENTS.map((r, i) => `${r.name} ${counts[i]}`).join(', ')),
        );
        const known = g.magic.known(who);
        if (!known.length) body.append(el('p', '', 'No spells in the spellbook.'));
        for (let circle = 1; circle <= 8; circle++) {
          const these = known.filter((s) => s.circle === circle);
          if (!these.length) continue;
          body.append(el('h3', '', `Circle ${circle}`));
          for (const s of these) {
            const why = g.magic.cannot(who, s);
            const row = el('div', 'item spell');
            const mid = el('div');
            mid.append(el('div', '', s.name), el('div', 'small', `${words(s)}${reagentNames(s).length ? ' - ' + reagentNames(s).join(', ') : ''}`));
            const b = btn('Cast', () => {
              const aim = g.magic.aim(s);
              if (aim === 'none') {
                this.close();
                g.castSpell(who, s);
                return;
              }
              this.pending = { caster: who, spell: s };
              this.close();
              this.setMode('cast');
            });
            if (why) {
              b.disabled = true;
              b.title = why;
            }
            row.append(mid, b);
            body.append(row);
          }
        }
      };
      draw(casters[0]);
    });
  }

  /** Where the party last stood on the surface (the map shows the land, not what lies under it). */
  private surface: { x: number; y: number } | null = null;

  /**
   * The journal's map: the player's own picture of the cloth map that came in the box, if they have given one (kept in
   * this browser), else the land drawn from the game's files - with a marker where the Avatar is.
   */
  private worldMap(body: HTMLElement, redraw: () => void): void {
    const g = this.game;
    const p = g.player;
    if (p.z === 0) this.surface = { x: p.x, y: p.y };
    const box = el('div', 'worldmap');
    const img = el('img');
    img.alt = 'The world map';
    const mark = el('i', 'here');
    const inner = el('div', 'inner');
    inner.append(img, mark);
    box.append(inner);
    const zoom = btn('Closer', () => {
      box.classList.toggle('close');
      zoom.textContent = box.classList.contains('close') ? 'Whole map' : 'Closer';
      place();
    });
    const pick = el('label', 'pick');
    const input = el('input');
    input.type = 'file';
    input.accept = 'image/*';
    pick.append('Use a picture of the map', input);
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) void kvSet(`map:${g.kind}`, f).then(redraw);
    });
    const row = el('div', 'row');
    row.append(zoom, pick);
    const where = el('p', 'small', '');
    body.append(box, where, row);
    let cal: { u: [number, number]; v: [number, number] } = { u: [0, 1 / 1024], v: [0, 1 / 1024] };
    const place = (): void => {
      const s = this.surface;
      mark.hidden = !s;
      if (!s) return;
      const u = cal.u[0] + s.x * cal.u[1];
      const v = cal.v[0] + s.y * cal.v[1];
      mark.style.left = `${u * 100}%`;
      mark.style.top = `${v * 100}%`;
      if (box.classList.contains('close')) requestAnimationFrame(() => mark.scrollIntoView({ block: 'center', inline: 'center' }));
    };
    where.textContent = p.z === 0 ? 'The marker shows where the party stands.' : 'The party is underground; the marker shows where they last stood on the surface.';
    void kvGet<Blob>(`map:${g.kind}`).catch(() => undefined).then((blob) => {
      if (blob) {
        img.src = URL.createObjectURL(blob);
        img.addEventListener('load', () => {
          cal = mapCalibration(g.kind, img.naturalWidth / img.naturalHeight);
          place();
        }, { once: true });
        const drop = btn('Use the drawn map', () => void kvDelete(`map:${g.kind}`).then(redraw));
        row.append(drop);
      } else {
        img.src = this.view.world().toDataURL();
        img.classList.add('drawn');
        place();
      }
    });
  }

  private journal(): void {
    const g = this.game;
    this.open('Journal', (body) => {
      const draw = (tab: 'people' | 'read' | 'map', person = -1): void => {
        body.replaceChildren();
        const seg = el('div', 'seg');
        seg.append(
          btn('People', () => draw('people'), tab === 'people' ? 'on' : ''),
          btn('Read', () => draw('read'), tab === 'read' ? 'on' : ''),
          btn('Map', () => draw('map'), tab === 'map' ? 'on' : ''),
        );
        body.append(seg);
        if (tab === 'map') return void this.worldMap(body, () => draw('map'));
        const j = g.journal.data;
        if (tab === 'read') {
          if (j.readings.length === 0) body.append(el('p', 'small', 'Signs and books read are kept here.'));
          for (const r of [...j.readings].reverse()) {
            const n = el('div', 'note');
            n.append(el('div', 'small', `${r.what}, ${r.where}, ${r.date}`), el('q', '', r.text));
            body.append(n);
          }
          return;
        }
        const p = j.people.find((p) => p.actor === person);
        if (!p) {
          if (j.people.length === 0) body.append(el('p', 'small', 'Those spoken with are kept here, with what they said.'));
          for (const q of [...j.people].reverse()) {
            const row = el('div', 'member');
            const mid = el('div');
            mid.append(el('div', 'name', q.name || q.desc), el('div', 'small', `${q.name ? q.desc + ', ' : ''}${q.where}, met ${q.met}`));
            const a = g.actors.get(q.actor);
            row.append(a ? this.view.tileImage(g.objects.objToTile[a.objN] + 8) : el('div'), mid, el('div', 'small', `${q.notes.length} ›`));
            row.addEventListener('click', () => draw('people', q.actor));
            body.append(row);
          }
          return;
        }
        body.append(btn('< Everyone', () => draw('people')), el('h3', '', p.name || p.desc), el('div', 'small', `${p.desc}, ${p.where}, met ${p.met}`));
        if (p.topics.length) {
          const chips = el('div', 'chips');
          for (const t of p.topics) chips.append(el('span', '', t));
          body.append(el('div', 'small', 'Words they answer to:'), chips);
        }
        for (const n of p.notes) {
          const d = el('div', 'note');
          d.append(el('div', 'asked', `${n.asked}, ${n.date}`), el('q', '', n.said));
          body.append(d);
        }
      };
      draw('people');
    });
  }

  private menu(): void {
    const g = this.game;
    this.open('Nuvie Web', (body) => {
      const item = (label: string, f: () => void, cls = ''): void => {
        const row = el('div', 'row');
        row.append(btn(label, f, cls));
        body.append(row);
      };
      item('Journal', () => this.journal());
      const big = document.documentElement.classList.contains('big-text');
      item(big ? 'Text: large' : 'Text: small', () => {
        document.documentElement.classList.toggle('big-text', !big);
        try {
          localStorage.setItem('nuvie.text', big ? 'small' : 'large');
        } catch {
          // Not kept.
        }
        this.close();
        this.layout();
      });
      const bare = document.documentElement.classList.contains('no-frame');
      item(bare ? 'Map frame: off' : 'Map frame: paper', () => {
        document.documentElement.classList.toggle('no-frame', !bare);
        try {
          localStorage.setItem('nuvie.frame', bare ? 'paper' : 'off');
        } catch {
          // Not kept.
        }
        this.close();
        this.layout();
      });
      item(`Battle speed: ${BATTLE_SPEEDS[this.battleSpeed].name}`, () => {
        this.battleSpeed = (this.battleSpeed + 1) % BATTLE_SPEEDS.length;
        try {
          localStorage.setItem('nuvie.battle', String(this.battleSpeed));
        } catch {
          // Not kept.
        }
        this.close();
        this.menu();
      });
      item(this.sfx.enabled ? 'Sounds: on' : 'Sounds: off', () => {
        this.sfx.enabled = !this.sfx.enabled;
        try {
          localStorage.setItem('nuvie.sfx', this.sfx.enabled ? 'on' : 'off');
        } catch {
          // Not kept.
        }
        this.close();
      });
      if (this.music.available) {
        item(this.music.enabled ? 'Music: on' : 'Music: off', () => {
          this.music.setEnabled(!this.music.enabled);
          this.close();
        });
      }
      item('Save now', () => {
        this.hooks.save(g.save());
        g.say('sys', 'Saved.');
        this.close();
      });
      item('Start this world afresh', () => confirm('Start again from the beginning? The saved game is lost.') && this.hooks.leave(true));
      item('Change game files', () => this.hooks.leave(false));
      body.append(el('p', 'small', 'The game saves itself as you play, in this browser. A TypeScript port of the Nuvie engine (GPL); it plays your own copy of the game and ships none of it.'));
    });
  }
}
