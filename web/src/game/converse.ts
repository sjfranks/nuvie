/**
 * converse.ts - talking to people: the interpreter for the game's conversation scripts (Nuvie's Converse.cpp and
 * ConverseInterpret.cpp). A script is text mixed with control codes; it runs until it wants the player's answer, and
 * what it says meanwhile is queued as events for whoever shows them.
 */
import type { GameFiles } from '../files/gamefiles.ts';
import { Lib } from '../files/lib.ts';
import { isLzw, lzwDecompress } from '../files/lzw.ts';
import type { Actor } from './actors.ts';
import type { Kind } from './kind.ts';
import { OBJ } from './u6tables.ts';

const OP = {
  GT: 0x81, GE: 0x82, LT: 0x83, LE: 0x84, NE: 0x85, EQ: 0x86, ADD: 0x90, SUB: 0x91, MUL: 0x92, DIV: 0x93, LOR: 0x94,
  LAND: 0x95, CANCARRY: 0x9a, WEIGHT: 0x9b, HORSE: 0x9c, HORSED: 0x9d, SLEEP: 0x9e, HASOBJ: 0x9f, RAND: 0xa0,
  IF: 0xa1, ENDIF: 0xa2, ELSE: 0xa3, SETF: 0xa4, CLEARF: 0xa5, DECL: 0xa6, EVAL: 0xa7, ASSIGN: 0xa8, FLAG: 0xab,
  JUMP: 0xb0, VAR: 0xb2, SVAR: 0xb3, DATA: 0xb4, DPRINT: 0xb5, BYE: 0xb6, INDEXOF: 0xb7, ENDDATA: 0xb8, NEW: 0xb9,
  DELETE: 0xba, OBJCOUNT: 0xbb, INVENTORY: 0xbe, PORTRAIT: 0xbf, ADDKARMA: 0xc4, SUBKARMA: 0xc5, INPARTY: 0xc6,
  OBJINPARTY: 0xc7, GIVE: 0xc9, JOIN: 0xca, WAIT: 0xcb, LEAVE: 0xcc, WORKTYPE: 0xcd, RESURRECT: 0xd6,
  NPCNEARBY: 0xd7, SETNAME: 0xd8, HEAL: 0xd9, WOUNDED: 0xda, CURE: 0xdb, POISONED: 0xdc, NPC: 0xdd, EXP: 0xe0,
  LVL: 0xe1, STR: 0xe2, INT: 0xe3, DEX: 0xe4, ENDANSWER: 0xee, KEYWORDS: 0xef, SLOOK: 0xf1, SCONVERSE: 0xf2,
  SPREFIX: 0xf3, ANSWER: 0xf6, ASK: 0xf7, ASKC: 0xf8, INPUTSTR: 0xf9, INPUT: 0xfb, INPUTNUM: 0xfc, SIDENT: 0xff,
} as const;

const VAR_SEX = 0x10;
const VAR_KARMA = 0x14;
const VAR_GARGF = 0x15;
const VAR_NPC_NAME = 0x17;
const VAR_PARTYLIVE = 0x17;
const VAR_PARTYALL = 0x18;
const VAR_HP = 0x19;
const VAR_PLAYER_NAME = 0x19;
const VAR_QUESTF = 0x1a;
const VAR_WORKTYPE = 0x20;
const VAR_YSTRING = 0x22;
const VAR_INPUT = 0x23;
const VAR_LAST = 0x25;

const VALOPS = new Set<number>([
  0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x90, 0x91, 0x92, 0x93, 0x94, 0x95, 0x9a, 0x9b, 0x9d, 0x9f, 0xa0, 0xa7, 0xab,
  0xb2, 0xb3, 0xb4, 0xb7, 0xbb, 0xc6, 0xc7, 0xca, 0xcc, 0xd7, 0xda, 0xdc, 0xdd, 0xe0, 0xe1, 0xe2, 0xe3, 0xe4,
]);
const isPrint = (c: number): boolean => c === 0x0a || (c >= 0x20 && c <= 0x7b) || c === 0x7e;
const isValop = (c: number): boolean => VALOPS.has(c);
const isDatasize = (c: number): boolean => c === 0xd2 || c === 0xd3 || c === 0xd4;
const isCtrl = (c: number): boolean => (c >= 0xa1 || c === 0x9c || c === 0x9e) && !isValop(c) && !isDatasize(c);

/** What the interpreter needs of the game. */
export interface ConvWorld {
  actor(n: number): Actor | undefined;
  playerActor(): Actor;
  playerName(): string;
  gender: number;
  karma: number;
  questFlag: number;
  gargFlag: number;
  hour(): number;
  partySize(): number;
  partyMax(): number;
  partyContains(n: number): boolean;
  /** The actor at a place in the party (0 the leader). */
  partyMember(i: number): Actor | undefined;
  /** The name of the party member who is actor `n`. */
  partyMemberName(n: number): string;
  partyAdd(a: Actor): void;
  partyRemove(a: Actor): void;
  /** What an actor is called when looked at ("a guard"). */
  lookActor(a: Actor): string;
  invHas(actor: number, objN: number, quality: number, matchQuality: boolean): boolean;
  invCount(actor: number, objN: number): number;
  invNew(actor: number, objN: number, qty: number, quality: number): void;
  invDelete(actor: number, objN: number, qty: number, quality: number): void;
  /** Stones an actor can still carry. */
  invRoom(actor: number): number;
  objWeight(objN: number): number;
  setWorktype(a: Actor, wt: number): void;
  heal(a: Actor): void;
  sleep(): void;
  random(n: number): number;
}

export type ConvEvent =
  | { type: 'text'; text: string }
  /** The speaker stops until the player goes on. */
  | { type: 'pause' }
  | { type: 'portrait'; actor: number; name: string }
  | { type: 'end' };

/** What the script waits on. */
export type ConvAsk =
  | { type: 'keyword' }
  /** One of these characters. */
  | { type: 'char'; allowed: string }
  | { type: 'text' }
  | { type: 'number' };

interface Val {
  v: number;
  d: number;
}
interface TVal {
  type: number;
  val: number;
}
interface Frame {
  run: boolean;
  breakC: number;
  startC: number;
}

const enum Answer { NO, YES, DONE }

export class ConverseLib {
  private readonly a: Lib | null;
  private readonly b: Lib | null;
  constructor(
    files: GameFiles,
    readonly kind: Kind = 'u6',
  ) {
    const lib = (n: string, skip4: boolean): Lib | null => (files.has(n) ? new Lib(files.get(n)!, 4, skip4) : null);
    // Ultima 6 splits its people between two files; the others keep them all in talk.lzc.
    this.a = kind === 'u6' ? lib('converse.a', false) : lib('talk.lzc', true);
    this.b = kind === 'u6' ? lib('converse.b', false) : null;
  }

  /** Which script an actor speaks: wisps and guards share one each. */
  scriptNum(a: Actor): number {
    if (this.kind === 'u6' && a.id > 200) {
      if (a.objN === OBJ.WISP) return 201;
      if (a.objN === OBJ.GUARD) return 202;
    }
    return a.id;
  }

  /** Script `n`, decoded; null where there is none. */
  script(n: number): Uint8Array | null {
    if (this.kind !== 'u6') {
      // Savage Empire's scripts start at its third actor.
      const item = this.a?.item(this.kind === 'se' ? n - 2 : n);
      return item && item.length > 4 ? item : null;
    }
    const lib = n <= 98 ? this.a : this.b;
    const raw = lib?.raw(n <= 98 ? n : n - 99);
    if (!raw || raw.length <= 4) return null;
    if (raw[0] === 0 && raw[1] === 0 && raw[2] === 0 && raw[3] === 0) return raw.slice(4);
    return isLzw(raw) ? lzwDecompress(raw) : null;
  }

  /** The name a script gives its speaker. */
  name(n: number): string {
    const s = this.script(n);
    if (!s) return '';
    let out = '';
    for (let c = 0; c <= 14 && c + 2 < s.length && s[c + 2] !== 0xf1 && s[c + 2] !== 0xf3; c++) out += String.fromCharCode(s[c + 2]);
    return out;
  }

  /** Every keyword a script answers to (for the list of things to say). */
  keywords(n: number): string[] {
    const s = this.script(n);
    const out: string[] = [];
    if (!s) return out;
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== OP.KEYWORDS) continue;
      let j = i + 1;
      let text = '';
      while (j < s.length && isPrint(s[j])) text += String.fromCharCode(s[j++]);
      if (s[j] === OP.ANSWER || s[j] === OP.KEYWORDS) for (const k of text.split(',')) if (k && k !== '*') out.push(k.toLowerCase());
    }
    return out;
  }
}

export class Converse {
  readonly events: ConvEvent[] = [];
  ask: ConvAsk | null = null;
  ended = false;
  name = '';
  desc = '';
  private pos = 0;
  private readonly vars = new Array<number>(VAR_LAST + 1).fill(0);
  private readonly svars = new Array<string>(VAR_LAST + 1).fill('');
  private in: Val[] = [];
  private text = '';
  private output = '';
  private frames: Frame[] = [];
  private declV = 0;
  private declT = 0;
  private answer = Answer.NO;
  private waiting = false;
  private rstrings: string[] = [];
  private ystring = '';
  private dbLvar = false;
  private dbLoc = 0;
  private dbOffset = 0;
  private input = '';

  constructor(
    private readonly w: ConvWorld,
    private readonly lib: ConverseLib,
    readonly npc: Actor,
    private readonly script: Uint8Array,
  ) {
    const p = w.playerActor();
    this.vars[VAR_SEX] = w.gender;
    this.vars[VAR_KARMA] = w.karma;
    this.vars[VAR_GARGF] = w.gargFlag;
    this.vars[VAR_PARTYLIVE] = w.partySize() - 1;
    this.vars[VAR_PARTYALL] = this.vars[VAR_PARTYLIVE];
    this.vars[VAR_HP] = p.hp;
    this.svars[VAR_NPC_NAME] = lib.name(lib.scriptNum(npc));
    this.svars[VAR_PLAYER_NAME] = w.playerName();
    this.vars[VAR_QUESTF] = w.questFlag;
    this.vars[VAR_WORKTYPE] = npc.worktype;
    this.showPortrait(npc.id);
  }

  /** Start a conversation with `npc`, or null where they have nothing to say. */
  static start(w: ConvWorld, lib: ConverseLib, npc: Actor): Converse | null {
    const s = lib.script(lib.scriptNum(npc));
    if (!s) return null;
    const c = new Converse(w, lib, npc, s.slice());
    c.run();
    return c;
  }

  /** The keywords the question now asked answers to ("*" for anything). */
  currentKeywords(): string[] {
    return keywordsFrom(this.script, this.pos);
  }

  /** Give the player's answer and run on. */
  reply(s: string): void {
    if (!this.ask || this.ended) return;
    this.ask = null;
    this.input = s.trim();
    this.print('\n\n');
    if (this.input === '') this.input = 'bye';
    else if (this.input.toLowerCase() === 'look') {
      this.print('You see ' + this.desc + '\n');
      this.pos--; // back to the ASK
    }
    if (this.declT !== 0) {
      if (this.declT === OP.VAR) this.setVar(this.declV, parseInt(this.input, 10) || 0);
      if (this.declT === OP.SVAR) this.setSvar(this.declV, this.input);
    }
    this.setSvar(VAR_INPUT, this.input);
    this.waiting = false;
    this.run();
  }

  private run(): void {
    let guard = 0;
    while (!this.waiting && !this.ended && this.pos < this.script.length) {
      if (++guard > 200000) {
        this.print('\n[The conversation is going round in circles.]\n');
        this.stop();
        break;
      }
      this.in = [];
      this.text = '';
      const c = this.script[this.pos];
      if (isPrint(c)) {
        this.addText();
        this.output = this.text;
      } else if (isCtrl(c)) {
        this.collect();
      } else this.pos++;
      this.exec();
    }
    if (this.pos >= this.script.length && !this.ended) this.stop();
    if (this.ended) {
      this.w.questFlag = this.vars[VAR_QUESTF] & 0xff;
      this.w.gargFlag = this.vars[VAR_GARGF] & 0xff;
      this.events.push({ type: 'end' });
    }
  }

  private stop(): void {
    this.ended = true;
    this.waiting = true;
  }

  private print(s: string): void {
    // "*" in what is said is where the speaker stops for the player.
    const parts = s.split('*');
    parts.forEach((p, i) => {
      if (p) {
        const last = this.events[this.events.length - 1];
        if (last?.type === 'text') last.text += p;
        else this.events.push({ type: 'text', text: p });
      }
      if (i < parts.length - 1 && this.events[this.events.length - 1]?.type !== 'pause') this.events.push({ type: 'pause' });
    });
  }

  private showPortrait(n: number): void {
    const a = n === this.npc.id ? this.npc : this.w.actor(n);
    if (!a) return;
    const statue = n >= 189 && n <= 191;
    const name = (a.met || this.w.partyContains(a.id)) && !statue ? this.npcName(n) : this.w.lookActor(a);
    this.events.push({ type: 'portrait', actor: n, name });
  }

  private npcName(n: number): string {
    if (n === this.npc.id && this.name) return this.name.slice(0, 15);
    const a = this.w.actor(n);
    return this.lib.name(a ? this.lib.scriptNum(a) : n);
  }

  private peek(o = 0): number {
    return this.script[this.pos + o] ?? 0;
  }
  private overflow(o = 0): boolean {
    return this.pos + o >= this.script.length;
  }
  private read(): number {
    return this.script[this.pos++] ?? 0;
  }
  private read2(): number {
    return this.read() | (this.read() << 8);
  }
  private read4(): number {
    return (this.read() | (this.read() << 8) | (this.read() << 16) | (this.read() << 24)) >>> 0;
  }

  private addText(): void {
    do this.text += String.fromCharCode(this.read());
    while (!this.overflow() && isPrint(this.peek()));
  }

  private addVal(v: number, d = 0): void {
    this.in.push({ v, d });
  }

  private readValue(): void {
    let v = this.read();
    let d = v;
    if (v === 0xd3) v = this.read();
    else if (v === 0xd2) v = this.read4();
    else if (v === 0xd4) v = this.read2();
    else d = 0;
    this.addVal(v, d);
  }

  private top(): Frame | undefined {
    return this.frames[this.frames.length - 1];
  }
  private get running(): boolean {
    const t = this.top();
    return !t || t.run;
  }

  /** Read one statement: its code and its arguments, evaluated where they are expressions. */
  private collect(): void {
    const c = this.peek();
    if (c === OP.JUMP) {
      this.addVal(this.read());
      this.addVal(this.read4());
      return;
    }
    if (c === OP.SIDENT) {
      this.addVal(this.read());
      this.addVal(this.read());
      this.addText();
      return;
    }
    if (c === OP.KEYWORDS || c === OP.ASKC || c === OP.SLOOK) {
      this.addVal(this.read());
      if (!this.overflow() && isPrint(this.peek())) this.addText();
      return;
    }
    let arg = 1;
    do {
      if (isPrint(this.peek()) && (this.overflow(1) || !isValop(this.peek(1)))) break;
      if (this.peek() === OP.EVAL) {
        this.pos++;
        if (this.running) this.eval(arg++);
      } else this.readValue();
    } while (!this.overflow() && !isCtrl(this.peek()));
  }

  private enter(c: number): void {
    this.frames.push({ run: this.running, breakC: 0, startC: c });
  }

  private doFrame(c: number): void {
    switch (c) {
      case OP.IF:
        this.enter(OP.IF);
        break;
      case OP.ENDIF:
        this.frames.pop();
        break;
      case OP.KEYWORDS:
        if (this.top()?.startC !== OP.KEYWORDS) this.enter(OP.KEYWORDS);
        break;
      case OP.ENDANSWER:
        this.frames.pop();
        break;
    }
    const t = this.top();
    if (t && c !== 0 && c === t.breakC) t.run = !t.run;
  }

  private exec(): void {
    this.doFrame(this.in[0]?.v ?? 0);
    if (this.running) {
      if (this.in.length) this.doCtrl();
      if (this.output) this.print(this.format(this.output));
    }
    this.in = [];
    this.text = '';
    this.output = '';
  }

  /** What is said, with its symbols filled in: $P the player's name, #3 a variable, and the like. */
  format(s: string): string {
    let out = '';
    let last = 0;
    for (let i = 0; i < s.length; ) {
      const c = s[i];
      if (c === '$' || c === '#') {
        const sym = s.slice(i, i + 2);
        const digits = /^\d+/.exec(s.slice(i + 1));
        if (sym === '$G') out += this.w.gender === 0 ? 'milord' : 'milady';
        else if (sym === '$N') out += this.name;
        else if (sym === '$P') out += this.w.playerName();
        else if (sym === '$T') out += this.w.hour() < 12 ? 'morning' : this.w.hour() <= 18 ? 'afternoon' : 'evening';
        else if (sym === '$Y') out += this.ystring;
        else if (sym === '$Z') out += this.svars[VAR_INPUT];
        else if (c === '$' && digits) out += this.svars[parseInt(digits[0], 10)] ?? '';
        else if (c === '#' && digits) {
          last = this.getVar(parseInt(digits[0], 10));
          out += String(last);
        } else out += sym;
        i += 2;
      } else if (c === '{') i++;
      else if (c === '~') {
        i += 2;
        while (i < s.length && /\d/.test(s[i])) i++;
      } else if (c === '/' || c === '\\') {
        const show = (last === 1 && c === '/') || (last !== 1 && c === '\\');
        i++;
        let n = 0;
        while (i + n < s.length && s[i + n] >= 'a' && s[i + n] <= 'z') n++;
        if (show) out += s.slice(i, i + n);
        i += n;
      } else if (c === '+') {
        // +...+ is for a version that speaks; skipped.
        i++;
        while (i < s.length && s[i] !== '+') i++;
        i++;
      } else {
        out += c;
        i++;
      }
    }
    return out;
  }

  private getVar(n: number): number {
    return n <= VAR_LAST ? this.vars[n] : 0;
  }
  private setVar(n: number, v: number): void {
    if (n <= VAR_LAST) this.vars[n] = v >>> 0;
  }
  private setSvar(n: number, s: string): void {
    if (n <= VAR_LAST) this.svars[n] = s;
  }
  private npcNum(n: number): number {
    return n !== 0xeb ? n & 0xff : this.npc.id;
  }

  private doCtrl(): void {
    // The statement's values as a stack, its code on top.
    const st: TVal[] = [];
    for (let i = this.in.length - 1; i >= 0; i--) st.push({ type: OP.VAR, val: this.in[i].v });
    const pop = (): number => st.pop()?.val ?? 0;
    const w = this.w;
    const op = pop();
    switch (op) {
      case OP.SLEEP:
        w.sleep();
        break;
      case OP.HORSE:
        pop();
        break;
      case OP.IF: {
        const t = this.top();
        if (t) {
          t.breakC = OP.ELSE;
          t.run = pop() !== 0;
        }
        break;
      }
      case OP.ENDIF:
      case OP.ELSE:
      case OP.ENDANSWER:
      case OP.SCONVERSE:
      case OP.SPREFIX:
        break;
      case OP.SETF: {
        const a = w.actor(this.npcNum(pop()));
        const f = pop();
        if (a && f <= 7) a.talkFlags |= 1 << f;
        break;
      }
      case OP.CLEARF: {
        const a = w.actor(this.npcNum(pop()));
        const f = pop();
        if (a && f <= 7) a.talkFlags &= ~(1 << f);
        break;
      }
      case OP.DECL: {
        this.dbLvar = false;
        const v0 = pop();
        const v1 = pop();
        const t = st[st.length - 1];
        if (t && (t.val === 0xb2 || t.val === 0xb4)) {
          // DB1[#2] = ... or DB1[0] = ...
          this.dbLvar = true;
          this.dbLoc = v0;
          if (t.val === 0xb2) {
            pop();
            pop();
            this.dbOffset = this.getVar(v1);
          } else {
            pop();
            this.dbOffset = v1;
          }
        }
        this.declV = v0;
        this.declT = v1;
        break;
      }
      case OP.ASSIGN: {
        const v = pop();
        if (this.dbLvar) this.setDbInteger(this.dbLoc, this.dbOffset, v);
        else if (this.declV <= VAR_LAST) {
          if (this.declT === OP.SVAR) this.setSvar(this.declV, this.rstrings[v] ?? '');
          else if (this.declT === OP.VAR) this.setVar(this.declV, v);
        }
        this.declV = this.declT = 0;
        break;
      }
      case OP.SETNAME: {
        const n = this.npcNum(pop());
        this.ystring = w.partyContains(n) ? w.partyMemberName(n) : this.npcName(n);
        this.setSvar(VAR_YSTRING, this.ystring);
        this.declV = this.declT = 0;
        break;
      }
      case OP.JUMP:
        this.pos = pop();
        this.frames = [];
        break;
      case OP.DPRINT: {
        const loc = pop();
        const s = this.dbString(loc, pop());
        if (s !== null) this.output = s;
        break;
      }
      case OP.BYE:
        this.stop();
        break;
      case OP.NEW: {
        const n = this.npcNum(pop());
        const obj = pop();
        const qual = pop();
        const qty = pop();
        if (w.actor(n)) w.invNew(n, obj, qty, qual);
        break;
      }
      case OP.DELETE: {
        const n = this.npcNum(pop());
        const obj = pop();
        const qual = pop();
        const qty = pop();
        if (w.actor(n)) w.invDelete(n, obj, qty, qual);
        break;
      }
      case OP.GIVE: {
        const obj = pop();
        const qual = pop();
        const from = this.npcNum(pop());
        const to = this.npcNum(pop());
        if (!w.actor(from)) break;
        w.invDelete(from, obj, 1, qual);
        if (w.actor(to)) w.invNew(to, obj, 1, qual);
        break;
      }
      case OP.ADDKARMA:
        w.karma = Math.min(99, w.karma + pop());
        break;
      case OP.SUBKARMA:
        w.karma = Math.max(0, w.karma - pop());
        break;
      case OP.RESURRECT:
        pop();
        break;
      case OP.HEAL: {
        const a = w.actor(this.npcNum(pop()));
        if (a) w.heal(a);
        break;
      }
      case OP.CURE: {
        const a = w.actor(this.npcNum(pop()));
        if (a) a.statusFlags &= ~0x08;
        break;
      }
      case OP.WORKTYPE: {
        const a = w.actor(this.npcNum(pop()));
        const wt = pop();
        if (a) w.setWorktype(a, wt);
        break;
      }
      case OP.INVENTORY:
        break;
      case OP.PORTRAIT:
        this.showPortrait(this.npcNum(pop()));
        break;
      case OP.WAIT:
        this.print('*');
        break;
      case OP.KEYWORDS:
        if (this.answer !== Answer.DONE) this.answer = checkKeywords(this.text, this.input) ? Answer.YES : Answer.NO;
        break;
      case OP.SIDENT:
        pop();
        this.name = this.text;
        break;
      case OP.SLOOK:
        this.desc = this.format(this.text);
        this.print('\nYou see ' + this.desc + '\n');
        break;
      case OP.ANSWER: {
        const t = this.top();
        if (t) {
          t.breakC = OP.KEYWORDS;
          t.run = this.answer === Answer.YES;
        }
        if (this.answer === Answer.YES) this.answer = Answer.DONE;
        break;
      }
      case OP.ASK:
        this.answer = Answer.NO;
        this.wait({ type: 'keyword' });
        break;
      case OP.ASKC:
        this.answer = Answer.NO;
        this.wait({ type: 'char', allowed: this.text });
        break;
      case OP.INPUTSTR:
      case OP.INPUT: {
        if (op === OP.INPUTSTR) this.answer = Answer.NO;
        this.declV = pop();
        this.declT = pop();
        this.wait(this.declT === OP.SVAR ? { type: 'text' } : { type: 'number' });
        break;
      }
      case OP.INPUTNUM:
        this.declV = pop();
        this.declT = pop();
        this.wait({ type: 'number' });
        break;
      default:
        break;
    }
  }

  private wait(ask: ConvAsk): void {
    this.ask = ask;
    this.waiting = true;
  }

  /** Work out the expression in the values from `vi` on, leaving its result in their place. */
  private eval(vi: number): void {
    const st: TVal[] = [];
    for (let v = vi; v < this.in.length; v++) {
      const { v: val, d } = this.in[v];
      st.push({ type: OP.VAR, val });
      if (isValop(val) && !d) this.evop(st);
    }
    this.in.length = vi;
    if (st.length === 0) this.addVal(0);
    else for (const t of st) this.addVal(t.val);
  }

  private evop(st: TVal[]): void {
    const popT = (): TVal => st.pop() ?? { type: 0, val: 0 };
    const pop = (): number => popT().val;
    const w = this.w;
    const out: TVal = { type: OP.VAR, val: 0 };
    const op = pop();
    let a: Actor | undefined;
    let v0: number;
    let v1: number;
    const stat = (get: (a: Actor) => number, set: (a: Actor, v: number) => void): void => {
      v1 = pop();
      a = w.actor(this.npcNum(pop()));
      if (a) {
        out.val = get(a) + v1;
        set(a, out.val);
      }
    };
    switch (op) {
      case OP.GT: v1 = pop(); v0 = pop(); out.val = v0 > v1 ? 1 : 0; break;
      case OP.GE: v1 = pop(); v0 = pop(); out.val = v0 >= v1 ? 1 : 0; break;
      case OP.LT: v1 = pop(); v0 = pop(); out.val = v0 < v1 ? 1 : 0; break;
      case OP.LE: v1 = pop(); v0 = pop(); out.val = v0 <= v1 ? 1 : 0; break;
      case OP.NE: out.val = pop() !== pop() ? 1 : 0; break;
      case OP.EQ: {
        const o1 = popT();
        const o2 = popT();
        if (o1.type === OP.VAR) out.val = o1.val === o2.val ? 1 : 0;
        else out.val = (this.rstrings[o1.val] ?? '').toLowerCase() === (this.rstrings[o2.val] ?? '').toLowerCase() ? 1 : 0;
        break;
      }
      case OP.ADD: out.val = (pop() + pop()) >>> 0; break;
      case OP.SUB: v1 = pop(); v0 = pop(); out.val = (v0 - v1) >>> 0; break;
      case OP.MUL: out.val = (pop() * pop()) >>> 0; break;
      case OP.DIV:
        v1 = pop();
        v0 = pop();
        if (v1 === 0) this.stop();
        else out.val = Math.floor(v0 / v1);
        break;
      case OP.LOR: v1 = pop(); v0 = pop(); out.val = v0 || v1 ? 1 : 0; break;
      case OP.LAND: v1 = pop(); v0 = pop(); out.val = v0 && v1 ? 1 : 0; break;
      case OP.CANCARRY:
        v0 = pop();
        if (w.actor(v0)) out.val = Math.max(0, Math.floor(w.invRoom(v0) * 10));
        break;
      case OP.WEIGHT:
        v1 = pop();
        v0 = pop();
        out.val = Math.floor(w.objWeight(v0) * v1);
        break;
      case OP.HORSED:
        a = w.actor(this.npcNum(pop()));
        out.val = a?.objN === OBJ.HORSE_WITH_RIDER ? 1 : 0;
        break;
      case OP.HASOBJ: {
        const qual = pop();
        const obj = pop();
        const n = this.npcNum(pop());
        if (w.actor(n) && w.invHas(n, obj, qual, qual !== 0)) out.val = 1;
        break;
      }
      case OP.RAND:
        v1 = pop();
        v0 = pop();
        out.val = v0 >= v1 ? v0 : v0 + w.random(v1 - v0 + 1);
        break;
      case OP.FLAG:
        v1 = pop();
        v0 = pop();
        if (v1 <= 7) {
          a = w.actor(this.npcNum(v0));
          if (a && a.talkFlags & (1 << v1)) out.val = 1;
        }
        break;
      case OP.VAR:
        out.val = this.getVar(pop());
        break;
      case OP.SVAR:
        out.val = this.rstrings.push(this.svars[pop()] ?? '') - 1;
        out.type = OP.SVAR;
        break;
      case OP.DATA:
        v1 = pop();
        v0 = pop();
        if (this.declT === OP.SVAR) {
          out.val = this.rstrings.push(this.dbString(v0, v1) ?? '') - 1;
          out.type = OP.SVAR;
        } else out.val = this.dbInteger(v0, v1);
        break;
      case OP.INDEXOF:
        v1 = pop();
        v0 = pop();
        out.val = this.findDbString(v0, this.svars[v1] ?? '');
        break;
      case OP.OBJCOUNT:
        v1 = pop();
        v0 = this.npcNum(pop());
        if (w.actor(v0)) out.val = w.invCount(v0, v1);
        break;
      case OP.INPARTY:
        out.val = w.partyContains(this.npcNum(pop())) ? 1 : 0;
        break;
      case OP.OBJINPARTY: {
        const qual = pop();
        const obj = pop();
        out.val = 0x8001;
        for (let i = 0; i < w.partySize(); i++) {
          const m = w.partyMember(i);
          if (m && w.invHas(m.id, obj, qual, false)) {
            out.val = m.id;
            break;
          }
        }
        break;
      }
      case OP.JOIN:
        a = w.actor(this.npcNum(pop()));
        if (a) {
          if (w.partyContains(a.id)) out.val = 3;
          else if (w.partySize() >= w.partyMax()) out.val = 2;
          else if (w.playerActor().id === 0) out.val = 1;
          else w.partyAdd(a);
        }
        break;
      case OP.LEAVE:
        a = w.actor(this.npcNum(pop()));
        if (a) {
          if (!w.partyContains(a.id)) out.val = 2;
          else if (w.playerActor().id === 0) out.val = 1;
          else w.partyRemove(a);
        }
        break;
      case OP.NPCNEARBY:
        a = w.actor(this.npcNum(pop()));
        if (a) out.val = a.z === this.npc.z && Math.abs(a.x - this.npc.x) <= 8 && Math.abs(a.y - this.npc.y) <= 8 ? 1 : 0;
        break;
      case OP.WOUNDED:
        a = w.actor(this.npcNum(pop()));
        if (a && a.hp < a.maxHp) out.val = 1;
        break;
      case OP.POISONED:
        a = w.actor(this.npcNum(pop()));
        if (a && a.statusFlags & 0x08) out.val = 1;
        break;
      case OP.NPC:
        pop();
        out.val = w.partyMember(pop())?.id ?? 0;
        break;
      case OP.EXP: stat((a) => a.exp, (a, v) => (a.exp = v)); break;
      case OP.LVL: stat((a) => a.level, (a, v) => (a.level = v)); break;
      case OP.STR: stat((a) => a.strength, (a, v) => (a.strength = v)); break;
      case OP.INT: stat((a) => a.intelligence, (a, v) => (a.intelligence = v)); break;
      case OP.DEX: stat((a) => a.dex, (a, v) => (a.dex = v)); break;
      default:
        break;
    }
    st.push(out);
  }

  /** Entry `i` of the list of strings at `loc`. */
  private dbString(loc: number, i: number): string | null {
    const db = this.script;
    let p = loc;
    for (let e = 0; e < i; e++) {
      if (db[p] === OP.ENDDATA || p >= db.length) return null;
      while (p < db.length && isPrint(db[p++]));
    }
    let s = '';
    do s += String.fromCharCode(db[p] ?? 0);
    while (++p < db.length && isPrint(db[p]));
    return s;
  }

  private dbInteger(loc: number, i: number): number {
    const p = loc + i * 2;
    return p + 1 < this.script.length ? this.script[p] | (this.script[p + 1] << 8) : 0;
  }

  private setDbInteger(loc: number, i: number, v: number): void {
    const p = loc + i * 2;
    if (p + 1 < this.script.length) {
      this.script[p] = v & 0xff;
      this.script[p + 1] = (v >> 8) & 0xff;
    }
  }

  private findDbString(loc: number, s: string): number {
    const db = this.script;
    let p = loc;
    let i = 0;
    while (p < db.length && db[p] !== OP.ENDDATA) {
      if (isPrint(db[p])) {
        let item = '';
        do item += String.fromCharCode(db[p]);
        while (++p < db.length && isPrint(db[p]));
        p++;
        if (checkKeywords(item.slice(0, 4), s)) return i;
      } else p++;
      i++;
    }
    return i;
  }
}

/** Whether what was said answers to one of the keywords: each is matched against as many letters as it has. */
export function checkKeywords(keys: string, said: string): boolean {
  if (keys === '*') return true;
  const s = said.toLowerCase();
  return keys.split(',').some((k) => k.toLowerCase() === s.slice(0, k.length));
}

/** The keywords a script answers to from `pos` on, up to the end of that question's answers. */
export function keywordsFrom(s: Uint8Array, pos: number): string[] {
  const out: string[] = [];
  for (let i = pos; i < s.length && i < pos + 8000; i++) {
    if (s[i] === OP.ENDANSWER) break;
    if (s[i] !== OP.KEYWORDS) continue;
    let j = i + 1;
    let text = '';
    while (j < s.length && isPrint(s[j])) text += String.fromCharCode(s[j++]);
    if (text && (s[j] === OP.ANSWER || s[j] === OP.KEYWORDS)) {
      for (const k of text.split(',')) if (k) out.push(k.toLowerCase());
      i = j - 1;
    }
  }
  return out;
}
