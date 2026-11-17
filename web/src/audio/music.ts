/**
 * music.ts - Ultima 6's own music, played as the original does it (SoundManager.cpp, Party::update_music): a song from
 * the group the moment calls for - aboard a boat the hornpipe, in a fight the battle song, below ground the dungeon's,
 * on the gargoyles' land theirs, and otherwise one of four, another when it ends. Its notes are the game's .m files
 * through the player (u6m.ts) into the FM synthesiser (opl.ts), 60 ticks a second.
 */
import type { Game } from '../game/game.ts';
import { createOpl, type OplChip } from './opl.ts';
import { U6Music } from './u6m.ts';

const GROUPS: Record<string, string[]> = {
  random: ['brit.m', 'forest.m', 'stones.m', 'ultima.m'],
  combat: ['engage.m'],
  boat: ['hornpipe.m'],
  gargoyle: ['gargoyle.m'],
  dungeon: ['dungeon.m'],
};
const KEPT = 'nuvie.music';

export class Music {
  private ctx: AudioContext | null = null;
  private chip: OplChip | null = null;
  private song: U6Music | null = null;
  private group = '';
  private tickLeft = 0;
  private gain: GainNode | null = null;
  private starting: Promise<void> | null = null;
  enabled: boolean;

  constructor(private readonly game: Game) {
    let on = true;
    try {
      on = localStorage.getItem(KEPT) !== 'off';
    } catch {
      // Private browsing: music on.
    }
    this.enabled = on;
  }

  /** Whether this copy has music (Ultima 6 does). */
  get available(): boolean {
    return this.game.kind === 'u6' && this.game.files.has('brit.m');
  }

  /** The page's sound, made at the first touch (browsers allow it only then); effects play through it too. */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Start the sound (browsers allow it only after a touch): the context always, the music where there is some. */
  start(): Promise<void> {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return Promise.resolve();
      this.ctx = new Ctx();
    }
    void this.ctx.resume();
    if (!this.available || !this.enabled) return Promise.resolve();
    const ctx = this.ctx;
    this.starting ??= (async () => {
      this.chip = await createOpl(ctx.sampleRate);
      const node = ctx.createScriptProcessor(4096, 0, 2);
      node.onaudioprocess = (e) => this.fill(e.outputBuffer);
      this.gain = ctx.createGain();
      this.gain.gain.value = 0.6;
      node.connect(this.gain).connect(ctx.destination);
      this.update();
    })().catch(() => {
      this.starting = null;
    });
    return this.starting;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem(KEPT, on ? 'on' : 'off');
    } catch {
      // Not kept.
    }
    if (on) void this.start();
    if (this.gain) this.gain.gain.value = on ? 0.6 : 0;
  }

  /** The group the moment calls for (Party::update_music). */
  private wanted(): string {
    const g = this.game;
    if (g.vehicle) return 'boat';
    if (g.combat.fighting) return 'combat';
    const z = g.player.z;
    return z === 0 ? 'random' : z === 5 ? 'gargoyle' : 'dungeon';
  }

  /** After each turn: change song if the moment has changed. */
  update(): void {
    if (!this.chip) return;
    const want = this.wanted();
    if (want !== this.group) this.play(want);
  }

  private play(group: string): void {
    const names = GROUPS[group];
    const name = names[Math.floor(Math.random() * names.length)];
    const file = this.game.files.get(name);
    if (!file || !this.chip) return;
    this.group = group;
    this.song = new U6Music(file, this.chip);
    this.tickLeft = 0;
  }

  private fill(out: AudioBuffer): void {
    const L = out.getChannelData(0);
    const R = out.getChannelData(1);
    const chip = this.chip;
    if (!chip || !this.song) {
      L.fill(0);
      R.fill(0);
      return;
    }
    const perTick = out.sampleRate / 60;
    for (let i = 0; i < L.length; ) {
      if (this.tickLeft <= 0) {
        if (!this.song.update()) {
          // A song of the land ends: another.
          if (this.group === 'random') this.play('random');
          else this.song.songEnd = false;
        }
        this.tickLeft += perTick;
      }
      const n = Math.min(512, L.length - i, Math.ceil(this.tickLeft));
      const s = chip.generate(n);
      for (let k = 0; k < n; k++) {
        L[i + k] = s[k * 2] / 32768;
        R[i + k] = s[k * 2 + 1] / 32768;
      }
      i += n;
      this.tickLeft -= n;
    }
  }

  stop(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.chip = null;
  }
}
