/**
 * app.ts - the game on a phone: the map across the top, taking taps; under it one pane that shows the log or the
 * party, with tabs to choose; and at the foot the commands - or, while someone is talking, the things to say.
 * Held sideways, the map stands at the left and the rest beside it.
 */
import type { Actor } from '../game/actors.ts';
import { Game, type SaveState } from '../game/game.ts';
import { invWeight } from '../game/inventory.ts';
import type { Obj } from '../game/objects.ts';
import { OBJ, READY_SLOT } from '../game/u6tables.ts';
import { USED_IN_PLACE } from '../game/usecode.ts';
import { REAGENTS, reagentCounts, reagentNames, words, type Spell } from '../game/magic.ts';
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
const esc = (s: string): string => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** Things a tap uses rather than walks onto. */
const USABLE: ReadonlySet<number> = new Set([
  OBJ.OAKEN_DOOR, OBJ.WINDOWED_DOOR, OBJ.CEDAR_DOOR, OBJ.STEEL_DOOR, OBJ.LADDER, OBJ.CAVE, OBJ.HOLE, OBJ.SIGN,
  OBJ.SIGN_ARROW, OBJ.GRAVE, OBJ.CHEST, OBJ.BARREL, OBJ.CRATE, OBJ.DRAWER, OBJ.BOOK, OBJ.SCROLL, 412, 414, 415,
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
    box.append(canvas, this.view.light, this.modeTag, this.face);
    this.status.className = 'clock';
    wrap.append(box);
    const divider = el('div', 'divider');
    const tabs = el('div', 'tabs');
    this.tabLog = btn('Log', () => this.setPane('log'));
    this.tabParty = btn('Party', () => this.setPane('party'));
    tabs.append(this.tabLog, this.tabParty, this.status, btn('Menu', () => this.menu()));
    divider.append(tabs);
    const pane = el('div', 'pane paper');
    pane.append(this.body);
    const side = el('div', 'side');
    side.append(divider, pane, this.foot);
    this.root.append(wrap, side);
    host.replaceChildren(this.root);
    this.body.addEventListener('scroll', () => {
      this.stick = this.body.scrollTop + this.body.clientHeight >= this.body.scrollHeight - 6;
    });
    // The pane changes size (a conversation shrinks the map): the newest line stays in view.
    new ResizeObserver(() => this.toBottom()).observe(this.body);

    // A tap acts (tap()); a finger held down walks the party towards it while it stays, sliding to steer.
    const at = (e: PointerEvent): { x: number; y: number } => {
      const r = canvas.getBoundingClientRect();
      return this.view.squareAt(e.clientX - r.left, e.clientY - r.top);
    };
    let down: { id: number; sq: { x: number; y: number }; holding: boolean; timer: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const sq = at(e);
      down = { id: e.pointerId, sq, holding: false, timer: 0 };
      const d = down;
      d.timer = window.setTimeout(() => {
        // Held: walking, not a tap - unless a command waits on a square, or someone is talking.
        if (down !== d || this.mode || this.game.converse) return;
        d.holding = true;
        this.hold(() => (down === d ? d.sq : null));
      }, 280);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (down && e.pointerId === down.id) down.sq = at(e);
    });
    const up = (e: PointerEvent): void => {
      if (!down || e.pointerId !== down.id) return;
      const d = down;
      down = null;
      clearTimeout(d.timer);
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
    this.layout();
    this.changed();
  }

  dispose: () => void;

  /** As many squares across as keeps each a comfortable size for a finger. */
  private layout(): void {
    const w = this.view.canvas.getBoundingClientRect().width || 352;
    // At least 11 squares, each at most 40 pixels; odd, so the party stands in the middle.
    let n = Math.floor(w / 32);
    if (n % 2 === 0) n--;
    n = Math.max(11, Math.min(15, n));
    if (n !== this.view.cols) this.view.resize(n, n);
    this.view.render();
  }

  // ---- what a tap on the map means ----

  private tap(sq: { x: number; y: number }): void {
    const g = this.game;
    if (g.converse) return;
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
    if (g.peer) {
      g.peer = false;
      this.open('Peer', (body) => {
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
    g.log.slice(-60).forEach((line, i, shown) => {
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
      if (say && g.asking()?.type === 'keyword') g.reply(say);
    });
    const grew = g.log.length !== this.logLength;
    this.logLength = g.log.length;
    this.body.replaceChildren(log);
    if (grew) this.stick = true;
    this.toBottom();
  }

  /** Keep the newest lines in view, unless the player has scrolled back to read. */
  private toBottom(): void {
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
    list.append(el('p', 'small', 'Tap a member for their numbers and what they carry.'));
    this.body.replaceChildren(list);
  }

  private drawFoot(): void {
    const g = this.game;
    const ask = g.asking();
    const opts = ask ? g.sayOptions() : [];
    // Rebuilt only when what it offers changes, so a text being typed is not lost.
    const key = g.converse ? `say:${g.paused}:${ask?.type}:${opts.map((o) => o.say).join()}:${g.log.length}` : `cmd:${this.mode}`;
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
        icon(btn('Cast', () => this.spellbook()), 401),
        m('Look', 'look', 403), m('Talk', 'talk', 402), m('Use', 'use', 407), m('Get', 'get', 404),
        icon(btn('Rest', () => this.restSheet()), 408), icon(btn('Notes', () => this.journal()), 409),
      );
      this.foot.replaceChildren(bar);
      return;
    }
    const say = el('div', 'say');
    if (g.paused) say.append(btn('Continue', () => g.continueTalk(), 'primary'));
    else if (ask) {
      const list = el('div', 'opts');
      for (const o of opts) list.append(btn(o.label, () => g.reply(o.say), opts.length <= 2 || o.say === 'bye' ? 'wide' : ''));
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
      const slot = READY_SLOT.get(o.objN);
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

  /** The game is won. */
  private ending(): void {
    const g = this.game;
    this.open('The Codex', (body) => {
      body.append(
        el('p', '', 'The Codex of Ultimate Wisdom has passed into the Ethereal Void, where both Britannians and gargoyles may look upon it, and neither may possess it.'),
        el('p', '', 'The lenses, and the moonstones in the vortex cube, have done their work. The war between the peoples is over.'),
        el('p', 'small', 'The ending sequence itself is not ported yet. Thou mayest go on exploring.'),
      );
    });
    this.onClose = () => {
      g.won = false;
    };
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

  private journal(): void {
    const g = this.game;
    this.open('Journal', (body) => {
      const draw = (tab: 'people' | 'read', person = -1): void => {
        body.replaceChildren();
        const seg = el('div', 'seg');
        seg.append(btn('People', () => draw('people'), tab === 'people' ? 'on' : ''), btn('Read', () => draw('read'), tab === 'read' ? 'on' : ''));
        body.append(seg);
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
