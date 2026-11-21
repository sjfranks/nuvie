/**
 * Tests on a real copy of Ultima 6, where there is one in gamedata/ultima6/ (it is never committed); skipped without.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameFiles } from '../src/files/gamefiles.ts';
import { Game } from '../src/game/game.ts';
import { SPELLS } from '../src/game/u6combat.ts';
import { MD_STATS, mdBit } from '../src/game/mdse.ts';
import { interview } from '../src/ui/freud.ts';

const GAMES = [
  ['Ultima 6', 'ultima6', 199],
  ['Savage Empire', 'savage', 40],
  ['Martian Dreams', 'martian', 40],
] as const;

for (const [title, folder, people] of GAMES) {
const DIR = join(import.meta.dirname, '../gamedata', folder);
const have = existsSync(join(DIR, 'MAP')) || existsSync(join(DIR, 'map'));

function load(): GameFiles {
  const files: GameFiles = new Map();
  const walk = (d: string, save: boolean): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p, true);
      else if (!(save && files.has(n.toLowerCase()))) files.set(n.toLowerCase(), new Uint8Array(readFileSync(p)));
    }
  };
  walk(DIR, false);
  return files;
}

describe.skipIf(!have)(`a real copy of ${title}`, () => {
  it('loads a new game', () => {
    const g = new Game(load());
    const p = g.player;
    console.log(g.kind, 'player', g.playerName(), p.x, p.y, p.z, 'obj', p.objN, g.date(), g.time(), 'party', g.party.map((m) => m.name + ':' + m.actor.id));
    console.log('objects on map', g.objects.all().length, 'ground', g.tiles.look(g.map.tileNum(p.x, p.y, p.z), 0));
    expect(g.party.length).toBeGreaterThan(0);
    expect(g.objects.all().length).toBeGreaterThan(5000);
    expect(g.map.isPassable(p.x, p.y, p.z)).toBe(true);
    for (let i = 0; i < 200; i++) g.pass();
    const s = JSON.parse(JSON.stringify(g.save()));
    const h = new Game(load(), s);
    expect(h.objects.all().length).toBe(g.objects.all().length);
  });

  it.runIf(folder === 'ultima6')('hatches the opening gargoyles, and fights to the death', () => {
    const g = new Game(load());
    g.combat.mode = true; // the party in combat mode
    const gargoyles = g.actors.list.filter((a) => a.id >= 203 && a.objN === 363);
    expect(gargoyles.length).toBe(3);
    expect(gargoyles.every((a) => g.combat.hostile(a))).toBe(true);
    // A troll beside the party is fought until it falls, and leaves gold.
    const p = g.player;
    const troll = g.combat.spawn(371, p.x + 2, p.y, p.z, 0, 8)!;
    g.log = [];
    for (const a of gargoyles) Object.assign(a, { objN: 0, visible: false }); // the gargoyles keep out of it
    for (let i = 0; i < 300 && troll.objN !== 0; i++) {
      if (g.attackAt(troll.x, troll.y)) continue;
      // Out of reach (it may flee): after it.
      const way = g.pathTo(troll.x, troll.y, true);
      if (way?.length) g.move(way[0][0], way[0][1]);
      else g.pass();
    }
    const text = g.log.map((l) => l.text).join('\n');
    expect(text).toContain('Troll killed!');
    expect(g.party.length).toBe(4);
  });

  it.runIf(folder === 'ultima6')('takes turns in a fight by movement points, and hands companions under command to the player', () => {
    const g = new Game(load());
    g.combat.mode = true; // the party in combat mode
    for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    const p = g.player;
    const troll = g.combat.spawn(371, p.x + 6, p.y, p.z, 0, 8)!;
    for (const m of g.party.slice(1)) m.actor.combatMode = 0x3; // front
    // A quick Avatar and a slow troll: the Avatar acts more often.
    p.dex = 30;
    troll.dex = 6;
    const acts = new Map<number, number>();
    const c = g.combat as unknown as { perform: (a: { id: number }) => void };
    const perform = c.perform.bind(g.combat);
    c.perform = (a: { id: number }) => {
      acts.set(a.id, (acts.get(a.id) ?? 0) + 1);
      perform(a);
    };
    let mine = 0;
    for (let i = 0; i < 20 && troll.alive && troll.objN; i++) {
      g.pass();
      mine++;
    }
    expect(acts.get(troll.id) ?? 0).toBeLessThan(mine);
    expect(acts.get(troll.id) ?? 0).toBeGreaterThan(0);
    // The companions fight by themselves at the front.
    expect(g.party.slice(1).some((m) => (acts.get(m.actor.id) ?? 0) > 0)).toBe(true);
    // Dupre under command: his turn comes to the player.
    const dupre = g.party[1].actor;
    dupre.combatMode = 0x2;
    let handed = false;
    for (let i = 0; i < 12 && !handed; i++) {
      g.pass();
      handed = g.player === dupre;
    }
    expect(handed).toBe(true);
    expect(g.log.some((l) => l.text.endsWith("'s turn."))).toBe(true);
    g.pass();
  });

  it.runIf(folder === 'ultima6')('fights a band of trolls with the party in each way of fighting', () => {
    const g = new Game(load());
    g.combat.mode = true; // the party in combat mode
    for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    const p = g.player;
    const trolls = [0, 1, 2, 3].map((i) => g.combat.spawn(371, p.x + 5, p.y - 2 + i, p.z, 0, [3, 4, 5, 6][i])!).filter(Boolean);
    expect(trolls.length).toBeGreaterThan(1);
    const modes = [0x4, 0x5, 0x6, 0x7, 0x8];
    g.party.slice(1).forEach((m, i) => (m.actor.combatMode = modes[i % modes.length]));
    const start = new Map(g.party.map((m) => [m.actor.id, `${m.actor.x},${m.actor.y}`]));
    for (let i = 0; i < 80 && trolls.some((t) => t.alive && t.objN); i++) {
      const t = trolls.find((x) => x.alive && x.objN);
      if (t && g.player === g.party[0].actor && g.attackAt(t.x, t.y)) continue;
      g.pass();
    }
    // The companions moved of their own accord, and the fight went on without fault.
    expect(g.party.slice(1).some((m) => start.get(m.actor.id) !== `${m.actor.x},${m.actor.y}`)).toBe(true);
    expect(g.log.some((l) => /killed!/.test(l.text))).toBe(true);
  });

  it.runIf(folder === 'ultima6')('goes on alone as one of the party, and gathers them again', () => {
    const g = new Game(load());
    for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    const dupre = g.party[1].actor;
    const others = g.party.filter((m) => m.actor !== dupre).map((m) => [m.actor, m.actor.x, m.actor.y] as const);
    expect(g.goSolo(dupre)).toBe(true);
    expect(g.player).toBe(dupre);
    // Dupre walks; the rest stay where they are.
    let walked = 0;
    for (const [dx, dy] of [[0, 1], [0, 1], [0, 1], [1, 0], [-1, 0], [0, -1], [0, -1]]) if (g.move(dx, dy)) walked++;
    expect(walked).toBeGreaterThan(0);
    for (const [a, x, y] of others) expect([a.x, a.y]).toEqual([x, y]);
    // Kept across a save.
    const back = new Game(load(), JSON.parse(JSON.stringify(g.save())));
    expect(back.player.id).toBe(dupre.id);
    // Too far from the leader to gather; then near enough.
    const leader = g.party[0].actor;
    const [ox, oy] = [dupre.x, dupre.y];
    dupre.x = leader.x + 9;
    expect(g.partyMode()).toBe(false);
    expect(g.log.at(-1)!.text).toBe('Not everyone is here.');
    [dupre.x, dupre.y] = [ox, oy];
    expect(g.partyMode()).toBe(true);
    expect(g.player).toBe(leader);
  });

  it.runIf(folder === 'ultima6')('walks the party in each formation, falling into place behind the leader', () => {
    const g = new Game(load());
    for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    const p = g.player;
    // Open ground, well away from the castle.
    let spot: [number, number] | null = null;
    for (let r = 20; r < 200 && !spot; r += 3) for (const [x, y] of [[p.x + r, p.y], [p.x, p.y + r]]) {
      let ok = !spot;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) ok &&= g.map.isPassable(x + dx, y + dy, 0);
      if (ok) spot = [x, y];
    }
    expect(spot).toBeTruthy();
    for (const f of ['standard', 'column', 'row', 'delta', 'file'] as const) {
      g.relocate(spot![0], spot![1], 0);
      g.formation = f;
      for (let i = 0; i < 5; i++) g.move(0, -1);
      for (let i = 1; i < g.party.length; i++) {
        const a = g.party[i].actor;
        // Nuvie's following keeps each beside someone ahead of them in the formation.
        if (f !== 'file') {
          const beside = g.party.slice(0, i).some((m) => Math.max(Math.abs(m.actor.x - a.x), Math.abs(m.actor.y - a.y)) <= 1);
          expect([f, i, beside]).toEqual([f, i, true]);
        }
        expect(Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y))).toBeLessThanOrEqual(4);
      }
      // Turning, the party wheels round behind.
      for (let i = 0; i < 4; i++) g.move(1, 0);
      for (let i = 1; i < g.party.length; i++) expect(Math.max(Math.abs(g.party[i].actor.x - p.x), Math.abs(g.party[i].actor.y - p.y))).toBeLessThanOrEqual(4);
    }
    // Through the castle's doors and halls, in the standard formation, the party keeps together.
    const h = new Game(load());
    for (const a of h.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    const q = h.player;
    let goal: [number, number] = [q.x, q.y];
    for (const [dx, dy] of [[0, 24], [0, 18], [12, 12], [-12, 12], [16, 0], [-16, 0], [0, -16]]) {
      const w = h.pathTo(q.x + dx, q.y + dy, true);
      if (w && w.length >= 12) {
        goal = [q.x + dx, q.y + dy];
        break;
      }
    }
    const from = [q.x, q.y];
    let worst = 0;
    for (let i = 0; i < 80 && (q.x !== goal[0] || q.y !== goal[1]); i++) {
      const way = h.pathTo(goal[0], goal[1], true);
      if (!way?.length) break;
      h.move(way[0][0], way[0][1]);
      for (const m of h.party) worst = Math.max(worst, Math.max(Math.abs(m.actor.x - q.x), Math.abs(m.actor.y - q.y)));
    }
    expect(Math.abs(q.y - from[1]) + Math.abs(q.x - from[0])).toBeGreaterThan(10);
    expect(worst).toBeLessThanOrEqual(4);
  });

  it.runIf(folder === 'ultima6')('puts people to bed at night, lying in their beds, and gets them up in the morning', () => {
    const g = new Game(load());
    const internal = g as unknown as { updateSchedules: () => void };
    g.clock.hour = 23;
    internal.updateSchedules();
    const abed = g.actors.list.filter((a) => a.objN === 146 && a.worktype === 0x91 && [[0, 0], [1, 0], [0, 1], [1, 1]].some(([dx, dy]) => g.objects.list(a.x + dx, a.y + dy, a.z)?.some((o) => o.objN === 163)));
    expect(abed.length).toBeGreaterThan(5);
    expect(abed.every((a) => a.statusFlags & 0x04)).toBe(true);
    g.clock.hour = 9;
    internal.updateSchedules();
    expect(abed.filter((a) => a.objN === 146).length).toBe(0);
    expect(abed.every((a) => a.objN === a.baseObjN)).toBe(true);
  });

  it.runIf(folder === 'ultima6')('lets Sherry the mouse through a mousehole', () => {
    const g = new Game(load());
    for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    const sherry = g.actors.list.find((a) => a.objN === 354 && a.id < 203)!;
    expect(sherry).toBeTruthy();
    const hole = g.objects.all().find((o) => o.objN === 213 && !g.map.isPassable(o.x, o.y, o.z) &&
      [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => g.canStand(o.x + dx, o.y + dy, o.z)))!;
    expect(hole).toBeTruthy();
    expect(g.passableFor(sherry, hole.x, hole.y, hole.z)).toBe(true);
    expect(g.passableFor(g.player, hole.x, hole.y, hole.z)).toBe(false);
    // In the party, alone, she walks into it.
    g.partyAdd(sherry);
    const [dx, dy] = [[0, 1], [0, -1], [1, 0], [-1, 0]].find(([x, y]) => g.canStand(hole.x + x, hole.y + y, hole.z))!;
    g.relocate(hole.x + dx, hole.y + dy, hole.z);
    g.goSolo(sherry);
    [sherry.x, sherry.y] = [hole.x + dx, hole.y + dy];
    expect(g.move(-dx, -dy)).toBe(true);
    expect([sherry.x, sherry.y]).toEqual([hole.x, hole.y]);
  });

  it.runIf(folder === 'ultima6')('begins combat when the party is set upon, and at the player\'s word', () => {
    const g = new Game(load());
    for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    expect(g.combat.mode).toBe(false);
    const p = g.player;
    const acts = new Map<number, number>();
    const c = g.combat as unknown as { perform: (a: { id: number }) => void };
    const perform = c.perform.bind(g.combat);
    c.perform = (a: { id: number }) => {
      acts.set(a.id, (acts.get(a.id) ?? 0) + 1);
      perform(a);
    };
    // Broken off with no foe about, the companions follow and take no turns of their own.
    for (let i = 0; i < 4; i++) g.pass();
    expect(g.party.slice(1).every((m) => !acts.has(m.actor.id))).toBe(true);
    // A troll comes on and strikes: combat mode begins of itself, and the companions fight.
    const troll = g.combat.spawn(371, p.x + 2, p.y, p.z, 0, 8)!;
    for (let i = 0; i < 20 && !g.combat.mode; i++) g.pass();
    expect(acts.get(troll.id) ?? 0).toBeGreaterThan(0);
    expect(g.combat.mode).toBe(true);
    expect(g.log.some((l) => l.text === 'Begin combat!')).toBe(true);
    for (let i = 0; i < 6; i++) g.pass();
    expect(g.party.slice(1).some((m) => acts.has(m.actor.id))).toBe(true);
    // Broken off, and begun again, at the player's word.
    expect(g.combat.toggle()).toBe(false);
    expect(g.log.at(-1)!.text).toBe('Break off combat!');
    expect(g.combat.toggle()).toBe(true);
    expect(g.log.at(-1)!.text).toBe('Begin combat!');
  });

  it.runIf(folder === 'ultima6')('hatches the throne room gargoyles only at a new game\'s start', () => {
    const g = new Game(load());
    const gargs = () => g.actors.list.filter((a) => a.id >= 203 && a.objN === 363 && a.alive && a.visible);
    expect(gargs().length).toBe(3);
    const egg = g.objects.all().find((o) => o.objN === 335 && o.x === 307 && o.y === 350 && o.z === 0);
    expect(egg).toBeUndefined();
    // Gone, then away and back: no more come.
    for (const a of gargs()) Object.assign(a, { objN: 0, visible: false });
    const [x, y] = [g.player.x, g.player.y];
    g.relocate(x + 40, y, 0);
    g.relocate(x + 12, y, 0);
    g.relocate(x, y, 0);
    expect(gargs().length).toBe(0);
    // A game saved before this, egg and all, loses the egg when loaded.
    const old = new Game(load());
    const state = JSON.parse(JSON.stringify(old.save()));
    state.objs.push([335, 0, 0x62, 307, 350, 0, 100, 2, 0, 0], [363, 0, 0, 0, 0, 0, 3, 0, 1, state.objs.length]);
    for (const a of old.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    const back = new Game(load(), state);
    expect(back.objects.all().some((o) => o.objN === 335 && o.x === 307 && o.y === 350)).toBe(false);
  });

  it.runIf(folder === 'ultima6')('burns torches down, heals by the regeneration ring, keeps the cloak\'s storm, and staggers when drunk', () => {
    const g = new Game(load());
    for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    const p = g.player;
    for (const o of g.objects.inventories[p.id]) if (o.loc === 'readied' && [3, 4].includes(g.readySlot(o) ?? -1)) o.loc = 'inv';
    // A torch from a stack of three is readied and lit; two stay.
    const torches = g.objects.create(90, 3, 0);
    g.objects.toInventory(torches, p.id);
    g.useObj(torches);
    const lit = g.objects.inventories[p.id].find((o) => o.objN === 90 && o.loc === 'readied')!;
    expect([lit.frameN, lit.quality, torches.qty]).toEqual([1, 200, 2]);
    expect(g.log.at(-1)!.text).toBe('Torch is lit.');
    // It burns down, and out.
    lit.quality = 3;
    for (let i = 0; i < 40 && lit.loc !== 'none'; i++) g.upkeep(1);
    expect(lit.loc).toBe('none');
    expect(g.log.some((l) => l.text === 'A torch burned out.')).toBe(true);
    // Another, lit and then taken from the hand, is spent.
    g.useObj(torches);
    const lit2 = g.objects.inventories[p.id].find((o) => o.objN === 90 && o.loc === 'readied')!;
    g.unready(lit2);
    expect(lit2.loc).toBe('none');
    // The regeneration ring heals.
    const ring = g.objects.create(257, 1, 0);
    g.objects.toInventory(ring, p.id);
    g.ready(ring, p);
    p.hp = 10;
    g.upkeep(5);
    expect(p.hp).toBe(15);
    // The storm cloak's storm goes on while it is worn.
    const cloak = g.objects.create(81, 1, 0);
    g.objects.toInventory(cloak, p.id);
    for (const o of g.objects.inventories[p.id]) if (o.loc === 'readied' && g.readySlot(o) === g.readySlot(cloak)) o.loc = 'inv';
    g.ready(cloak, p);
    g.stormTurns = 0;
    g.upkeep(1);
    expect(g.stormTurns).toBeGreaterThan(0);
    // Four drinks, and the Avatar stumbles.
    for (let i = 0; i < 4; i++) {
      const wine = g.objects.create(115, 1, 0);
      g.objects.toInventory(wine, p.id);
      g.usecode.use(wine);
    }
    expect(g.alcohol).toBe(4);
    for (let i = 0; i < 20; i++) g.move(0, 1);
    expect(g.log.some((l) => l.text === 'Hic!')).toBe(true);
    // Sober again after some hours.
    g.advance(60 * 4);
    expect(g.alcohol).toBe(0);
  });

  it.runIf(folder === 'ultima6')('casts spells from a readied book, using magic points and reagents', () => {
    const g = new Game(load());
    const avatar = g.player;
    const spell = (name: string) => SPELLS.find((s) => s.name === name)!;
    expect(g.magic.cannot(avatar, spell('Light'))).toBe('No spellbook is readied.');
    const book = g.objects.create(57, 0, 0);
    g.objects.toInventory(book, avatar.id);
    expect(g.ready(book, avatar)).toBe(true);
    const page = g.objects.create(58, 0, 255); // every spell
    g.objects.toContainer(page, book);
    expect(g.magic.known(avatar).length).toBe(80);
    expect(g.magic.cannot(avatar, spell('Magic Arrow'))).toBe('No reagents.');
    for (const r of [65, 66, 67, 68, 69, 70, 71, 72]) g.invNew(avatar.id, r, 10, 0);
    avatar.level = 8;
    avatar.magic = 30;
    for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    const troll = g.combat.spawn(371, avatar.x + 2, avatar.y, avatar.z, 0, 8)!;
    g.log = [];
    g.castSpell(avatar, spell('Magic Arrow'), troll.x, troll.y);
    expect(avatar.magic).toBe(28);
    expect(g.invCount(avatar.id, 65)).toBe(9); // black pearl (and sulfurous ash)
    g.castSpell(avatar, spell('Light'));
    expect(g.lightTurns).toBeGreaterThan(90);
    avatar.hp = 10;
    g.castSpell(avatar, spell('Great Heal'), avatar.x, avatar.y);
    expect(avatar.hp).toBe(avatar.maxHp);
    g.castSpell(avatar, spell('Create Food'));
    g.castSpell(avatar, spell('Kill'), troll.x, troll.y);
    console.log(g.log.map((l) => l.text).join(' | '));
    expect(g.log.some((l) => /Create \d+ food/.test(l.text))).toBe(true);
  });

  it.runIf(folder === 'ultima6')('casts every spell without fault', () => {
    const g = new Game(load());
    const avatar = g.player;
    const book = g.objects.create(57, 0, 0);
    g.objects.toInventory(book, avatar.id);
    g.ready(book, avatar);
    g.objects.toContainer(g.objects.create(58, 0, 255), book);
    avatar.level = 8;
    for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    const ported: string[] = [];
    for (const sp of SPELLS) {
      for (const r of [65, 66, 67, 68, 69, 70, 71, 72]) if (g.invCount(avatar.id, r) < 2) g.invNew(avatar.id, r, 5, 0);
      avatar.magic = 99;
      avatar.hp = avatar.maxHp;
      if (g.player !== avatar) break;
      const troll = g.combat.spawn(371, avatar.x + 2, avatar.y, avatar.z, 0, 8);
      g.log = [];
      const aim = g.magic.aim(sp);
      expect(() => {
        g.castSpell(avatar, sp, aim === 'none' ? undefined : troll?.x, aim === 'none' ? undefined : troll?.y);
        if (g.askChoice) g.askChoice.then(0);
        if (g.converse) g.converse = null;
      }).not.toThrow();
      g.stormTurns = 0;
      g.eclipseTurns = 0;
      g.scry = null;
      if (!g.log.some((l) => l.text.includes('not yet ported'))) ported.push(sp.name);
      if (troll && troll.objN) Object.assign(troll, { objN: 0, visible: false });
      for (const a of g.actors.list) if (a.id >= 203) Object.assign(a, { objN: 0, visible: false });
      g.peer = false;
    }
    console.log(ported.length, 'spells ported');
    expect(ported.length).toBe(SPELLS.length);
  });

  it.runIf(folder === 'ultima6')('lays fields that burn and sleep, and travels by gate', () => {
    const g = new Game(load());
    for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    const avatar = g.player;
    const book = g.objects.create(57, 0, 0);
    g.objects.toInventory(book, avatar.id);
    g.ready(book, avatar);
    g.objects.toContainer(g.objects.create(58, 0, 255), book);
    avatar.level = 8;
    const prep = (): void => {
      for (const r of [65, 66, 67, 68, 69, 70, 71, 72]) if (g.invCount(avatar.id, r) < 2) g.invNew(avatar.id, r, 5, 0);
      avatar.magic = 99;
    };
    const spell = (n: string) => SPELLS.find((s) => s.name === n)!;
    let x = avatar.x + 2;
    while (!g.canStand(x, avatar.y, avatar.z)) x++;
    const troll = g.combat.spawn(371, x, avatar.y, avatar.z, 1, 0)!; // a neutral troll that stands still
    troll.hp = 200;
    const hp = troll.hp;
    prep();
    g.castSpell(avatar, spell('Fire Field'), troll.x, troll.y);
    expect((g.objects.list(troll.x, troll.y, troll.z) ?? []).some((o) => o.objN === 317)).toBe(true);
    expect(troll.hp).toBeLessThan(hp);
    prep();
    g.castSpell(avatar, spell('Dispel Field'), troll.x, troll.y);
    expect((g.objects.list(troll.x, troll.y, troll.z) ?? []).some((o) => o.objN === 317)).toBe(false);
    prep();
    troll.hp = 60;
    g.castSpell(avatar, spell('Sleep Field'), troll.x, troll.y);
    expect(troll.statusFlags & 0x04).toBeTruthy();
    prep();
    g.castSpell(avatar, spell('Negate Magic'));
    prep();
    g.castSpell(avatar, spell('Light'));
    expect(g.log.at(-1)!.text).toBe('No magic at this time!');
    g.stormTurns = 0;
    prep();
    g.castSpell(avatar, spell('Gate Travel'));
    g.askChoice!.then(4);
    expect([avatar.x, avatar.y, avatar.z]).toEqual(g.moonstones[4]);
  });

  it.runIf(folder === 'ultima6')('meets monsters that cast their spells', () => {
    const g = new Game(load());
    for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    const p = g.player;
    let x = p.x + 3;
    while (!g.canStand(x, p.y, p.z)) x++;
    const mage = g.combat.spawn(378, x, p.y, p.z, 2, 8)!; // evil, assaulting
    expect(g.objects.inventories[mage.id].filter((o) => o.objN === 336).length).toBe(8);
    const said: string[] = [];
    const say = g.say.bind(g);
    g.say = ((w: never, t: string) => (said.push(t), say(w, t))) as typeof g.say;
    for (let i = 0; i < 60 && mage.alive && !said.some((t) => / casts /.test(t)); i++) {
      for (const m of g.party) m.actor.hp = m.actor.maxHp;
      mage.hp = 50;
      g.pass();
    }
    console.log('mage:', said.filter((t) => t !== 'Pass.').slice(0, 8));
    expect(said.some((t) => /^Mage casts /.test(t))).toBe(true);
  });

  it.runIf(folder === 'ultima6')('makes a balloon from its plans, flies it on the wind, and lands', () => {
    const g = new Game(load());
    for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    const p = g.player;
    // Out of the castle, onto open ground.
    let spot: [number, number] | null = null;
    for (let r = 20; r < 200 && !spot; r += 3) for (const [x, y] of [[p.x + r, p.y], [p.x, p.y + r]]) {
      let ok = !spot;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) ok &&= g.canStand(x + dx, y + dy, 0);
      if (ok) spot = [x, y];
    }
    g.relocate(spot![0], spot![1], 0);
    const plans = g.objects.create(270, 1, 0);
    g.objects.toInventory(plans, 1);
    g.useObj(plans);
    expect(g.log.some((l) => l.text === 'Missing a balloon basket.')).toBe(true);
    for (const n of [421, 422, 147, 284]) g.objects.toInventory(g.objects.create(n, 1, 0), 1);
    g.useObj(plans);
    const balloon = (g.objects.list(p.x, p.y, 0) ?? []).find((o) => o.objN === 420)!;
    expect(balloon).toBeTruthy();
    g.get(p.x, p.y, balloon);
    expect(balloon.loc).toBe('inv');
    g.useObj(balloon);
    expect(balloon.objN).toBe(423);
    g.useObj(balloon);
    expect(g.vehicle?.objN).toBe(423);
    (g as unknown as { windMinutes: number }).windMinutes = 999;
    g.setWind([1, 0]);
    const x0 = p.x;
    g.move(0, 1); // the wind decides, not the party
    g.pass();
    expect([p.x - x0, g.vehicle!.x - x0]).toEqual([2, 2]);
    g.setWind([0, 0]);
    expect(g.move(1, 0)).toBe(false);
    g.use(p.x, p.y);
    expect(g.vehicle).toBeNull();
    expect(g.objects.all().some((o) => o.objN === 420 && Math.abs(o.x - p.x) <= 1 && Math.abs(o.y - p.y) <= 1)).toBe(true);
  });

  it.runIf(folder === 'ultima6')('wears magic things, fires a charged staff, and wishes at a fountain', () => {
    const g = new Game(load());
    for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    const p = g.player;
    const give = (n: number, q = 0) => {
      const o = g.objects.create(n, 1, q);
      g.objects.toInventory(o, p.id);
      return o;
    };
    // The amulet of submission will not come off.
    const amulet = give(76);
    expect(g.ready(amulet, p)).toBe(true);
    g.unready(amulet);
    expect(amulet.loc).toBe('readied');
    // An invisibility ring hides its wearer while worn.
    const ring = give(258);
    g.ready(ring, p);
    expect(p.objFlags & 2).toBe(2);
    g.unready(ring);
    expect(p.objFlags & 2).toBe(0);
    // The storm cloak stills magic.
    const cloak = give(81);
    for (const r of g.objects.inventories[p.id]) if (r.loc === 'readied' && g.readySlot(r) === g.readySlot(cloak)) g.unready(r);
    g.ready(cloak, p);
    expect(g.stormTurns).toBe(20);
    g.unready(cloak);
    expect(g.stormTurns).toBe(0);
    // A staff charged with Light lets it loose.
    for (const r of g.objects.inventories[p.id]) if (r.loc === 'readied' && (g.readySlot(r) === 3 || g.readySlot(r) === 4)) g.unready(r);
    const staff = give(78);
    staff.container = [g.objects.create(336, 1, 9)];
    g.useObj(staff);
    expect(g.log.at(-1)!.text).toBe('Not readied.');
    g.ready(staff, p);
    const light = g.lightTurns;
    g.useObj(staff);
    expect(staff.container.length).toBe(0);
    expect(g.lightTurns).toBeGreaterThan(light);
    // A fountain grants food, now and then.
    const fountain = g.objects.create(234, 1, 0);
    const before = g.objects.inventories[p.id].filter((o) => o.objN === 129).length;
    let got = 0;
    for (let i = 0; i < 40; i++) {
      g.usecode.use(fountain);
      g.askChoice!.then(0);
      g.askText!.then('mutton');
      got = g.objects.inventories[p.id].filter((o) => o.objN === 129).length - before;
    }
    expect(got).toBeGreaterThan(0);
  });

  it.runIf(folder === 'ultima6')('springs a trap set in a chest when it is opened', () => {
    const g = new Game(load());
    for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    const p = g.player;
    const chest = g.objects.create(98, 1, 0);
    chest.frameN = 1;
    g.objects.toContainer(g.objects.create(337, 0, 0), chest);
    g.objects.toInventory(chest, p.id);
    g.useObj(chest);
    expect(chest.container!.some((k) => k.objN === 337)).toBe(false);
    expect(g.log.some((l) => ['Acid!', 'Poison!', 'Bomb!', 'Gas!'].includes(l.text))).toBe(true);
  });

  it.runIf(folder === 'ultima6')('draws a silver serpent whole, its body following its head', () => {
    const g = new Game(load());
    const s = g.combat.spawn(413, 0x133 + 40, 0x160 + 40, 0, 2, 0)!;
    const chain = () => [{ x: s.x, y: s.y, frame: -1 }, ...s.parts()];
    const whole = () => chain().every((c, i, l) => i === 0 || Math.abs(c.x - l[i - 1].x) + Math.abs(c.y - l[i - 1].y) === 1);
    expect(s.parts().length).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < 30; i++) {
      g.combat.step(s, s.x + (i % 7 < 4 ? 5 : 0), s.y + (i % 7 < 4 ? 0 : 5));
      expect(whole()).toBe(true);
      expect(s.parts().at(-1)!.frame % 2).toBe(1); // a tail
      expect(s.parts().slice(0, -1).every((c) => c.frame >= 8 && c.frame <= 13)).toBe(true);
    }
    expect(g.actors.at(s.parts()[2].x, s.parts()[2].y, 0)).toBe(s);
  });

  it.runIf(folder === 'ultima6')('makes the Avatar anew, as the gypsy would', () => {
    const g = new Game(load());
    expect(g.fresh).toBe(true);
    expect(g.avatarFace(0)).not.toBeNull();
    expect(g.avatarFace(11)).not.toBeNull();
    g.createHero({ name: 'Iolanthe', female: true, face: 2, str: 19, dex: 18, int: 22 });
    const a = g.player;
    expect([g.playerName(), g.gender, a.strength, a.dex, a.intelligence, a.magic, a.level]).toEqual(['Iolanthe', 1, 19, 18, 22, 44, 3]);
    expect(g.portrait(a)).toEqual(g.avatarFace(2));
    const back = new Game(load(), g.save());
    expect([back.playerName(), back.gender, back.player.intelligence, back.fresh]).toEqual(['Iolanthe', 1, 22, false]);
    expect(back.portrait(back.player)).toEqual(g.avatarFace(2));
  });

  it.runIf(folder === 'martian')('looks closer, attacks with each weapon, divides, talks to things, and lights the lamps', () => {
    const g = new Game(load());
    const p = g.player;
    const lookAt = (o: { x: number; y: number }) => {
      g.log = [];
      g.look(o.x, o.y);
      return g.log.map((l) => l.text).join(' ');
    };
    const free = [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2], [3, 0]].find(([dx, dy]) => !g.actors.at(p.x + dx, p.y + dy, p.z))!;
    const place = (objN: number, q = 0, qty = 1) => {
      const o = g.objects.create(objN, qty, q);
      [o.x, o.y, o.z] = [p.x + free[0], p.y + free[1], p.z];
      for (const n of [...(g.objects.list(o.x, o.y, o.z) ?? [])]) g.objects.unlink(n);
      g.objects.add(o);
      return o;
    };
    g.clock.hour = 15;
    g.clock.minute = 7;
    expect(lookAt(place(91))).toMatch(/3:07 P\.M\./);
    expect(lookAt(place(268, 4, 3))).toMatch(/3 loads of coal/);
    expect(lookAt(place(240, 1, 5))).toMatch(/Rifle.*5 charges/);
    expect(lookAt(place(172, 12))).toMatch(/Olympus Mons/);
    expect(lookAt(place(179, 128 + 64))).toMatch(/rusted/i);
    // Two weapons readied: an attack with each.
    for (const o of g.objects.inventories[p.id]) if (o.loc === 'readied') o.loc = 'inv';
    const guns = [g.objects.create(43, 1, 0), g.objects.create(43, 1, 0)];
    for (const w of guns) {
      g.objects.toInventory(w, p.id);
      w.loc = 'readied';
    }
    const foe = g.actors.list.find((a) => a.objN !== 0 && !a.inParty && a.id > 20)!;
    Object.assign(foe, { x: p.x + 1, y: p.y + 1, z: p.z, visible: true, hp: 200 });
    g.log = [];
    g.combat.attackWithEach(p, foe);
    expect(g.log.filter((l) => /^Attack with/.test(l.text)).length).toBe(2);
    // Talking to oneself.
    g.log = [];
    g.talk(p.x, p.y);
    expect(g.log.at(-1)!.text).toMatch(/insane/i);
    // A creature that divides when hurt.
    const splitter = [...MD_STATS.keys()].find((n) => mdBit(MD_STATS.get(n), 6));
    if (splitter !== undefined) {
      const spot = [[3, 3], [-3, 3], [3, -3], [-3, -3]].find(([dx, dy]) => g.canStand(p.x + dx, p.y + dy, p.z) && g.canStand(p.x + dx + 1, p.y + dy + 1, p.z))!;
      const c = g.combat.spawn(splitter, p.x + spot[0], p.y + spot[1], p.z, 0, 8)!;
      c.hp = 50;
      const before = g.actors.list.filter((a) => a.objN === splitter && a.alive && a.visible).length;
      for (let i = 0; i < 10; i++) (g.combat as unknown as { hit: (a: unknown, d: number) => number }).hit(c, 1);
      expect(g.actors.list.filter((a) => a.objN === splitter && a.alive && a.visible).length).toBeGreaterThan(before);
      expect(g.log.some((l) => / divides!$/.test(l.text))).toBe(true);
    }
    // Lamp posts light at night once the power is on.
    const lamp = place(228);
    lamp.frameN = 3;
    g.actors.get(0x73)!.talkFlags |= 1 << 4;
    g.clock.hour = 20;
    g.mdUse.hourly();
    expect(lamp.frameN).toBe(7);
  });

  it.runIf(folder === 'martian')('fights by Martian Dreams\' rules: guns, rounds, wounds', () => {
    const g = new Game(load());
    g.combat.mode = true; // the party in combat mode
    const p = g.player;
    const nellie = g.party.find((m) => m.name === 'Nellie Bly')!.actor;
    const gun = g.objects.inventories[nellie.id].find((o) => o.objN === 41)!;
    expect(g.readiable(gun)).toBe(true);
    expect(g.ready(gun, nellie)).toBe(true);
    expect(g.combat.reach(nellie)).toBe(4);
    const rounds = (): number => g.objects.inventories[nellie.id].filter((o) => o.objN === 57).reduce((n, o) => n + o.qty, 0);
    const before = rounds();
    const spot = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].find(([dx, dy]) => g.canStand(p.x + dx, p.y + dy, p.z))!;
    const rat = g.combat.spawn(387, p.x + spot[0], p.y + spot[1], p.z, 0, 8)!;
    expect(g.combat.hostile(rat)).toBe(true);
    const said: string[] = [];
    const say = g.say.bind(g);
    g.say = ((w: never, t: string) => (said.push(t), say(w, t))) as typeof g.say;
    for (let i = 0; i < 40 && rat.objN; i++) g.attackAt(rat.x, rat.y) || g.pass();
    console.log('md fight:', said.filter((t) => t !== 'Pass.').slice(0, 12));
    expect(said.some((t) => /Bushrat (killed|.*wounded|critical)/.test(t))).toBe(true);
    expect(rounds()).toBeLessThanOrEqual(before);
  });

  it.runIf(folder === 'martian')('uses Martian Dreams\' things as usecode.lua has them', () => {
    const g = new Game(load());
    const p = g.player;
    const kinds = [...new Set(g.objects.all().filter((o) => g.mdUse.handles(o)).map((o) => o.objN))];
    expect(kinds.length).toBeGreaterThan(40);
    for (const n of kinds) {
      const o = g.objects.all().find((q) => q.objN === n)!;
      if (o.loc === 'map') g.relocate(o.x, o.y + 1, o.z);
      expect(() => {
        g.useObj(o);
        if (g.askWhere) g.askWhere.then(p.x, p.y - 1);
        g.converse = null;
      }).not.toThrow();
    }
    // A rusted door, and lamp oil on it.
    const door = g.objects.all().find((o) => (o.objN === 179 || o.objN === 152) && o.quality & 0x80 && o.loc === 'map')!;
    expect(door).toBeTruthy();
    const oil = g.objects.create(124, 1, 0);
    g.objects.toInventory(oil, p.id);
    g.relocate(door.x, door.y + 1, door.z);
    g.useObj(oil);
    g.askWhere!.then(door.x, door.y);
    expect(door.quality & 0x80).toBe(0);
    expect(g.log.some((l) => l.text === 'The door is unstuck!' || /unstuck/.test(l.text))).toBe(true);
    // A book from mdtext.lzc.
    const book = g.objects.all().find((o) => o.objN === 148 && o.quality > 0)!;
    g.relocate(book.x, book.y + 1, book.z);
    g.useObj(book);
    expect(g.log.at(-1)!.text.length).toBeGreaterThan(40);
  });

  it.runIf(folder === 'martian')('camps in the tent: rests, heals, and dreams of the obelisks', () => {
    const g = new Game(load());
    for (const a of g.actors.list) if (a.id >= 224) Object.assign(a, { objN: 0, visible: false });
    const p = g.player;
    g.mdUse.tent(null);
    expect(g.log.at(-1)!.text).toBe('The ground is not flat enough.');
    let spot: number[] | null = null;
    for (let r = 3; r < 60 && !spot; r++) for (const [x, y] of [[p.x + r, p.y], [p.x - r, p.y], [p.x, p.y + r], [p.x, p.y - r]]) {
      let ok = !spot;
      for (let yy = y - 2; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) ok &&= g.canStand(xx, yy, 0);
      if (ok && !g.actors.list.some((a) => a.objN && a.visible && !a.inParty && Math.abs(a.x - x) < 7 && Math.abs(a.y - y) < 7)) spot = [x, y];
    }
    g.relocate(spot![0], spot![1], 0);
    p.hp = 10;
    p.exp = 1000;
    const level = p.level;
    const str = p.strength;
    g.mdUse.tent(null);
    expect(g.askChoice!.label).toMatch(/^Rest until (sunset|sunrise)\?$/);
    g.askChoice!.then(0);
    expect(p.hp).toBeGreaterThan(10);
    expect(p.level).toBe(level + 1);
    g.askChoice!.then(2); // the sword
    expect(p.strength).toBe(Math.min(30, str + 1));
  });

  it.runIf(folder === 'martian')('digs, and shovels ore into a wheelbarrow and a rail car', () => {
    const g = new Game(load());
    const p = g.player;
    const shovel = g.objects.create(66, 1, 0);
    g.objects.toInventory(shovel, p.id);
    // Somewhere with diggable ground beside open squares.
    let at: number[] | null = null;
    for (let r = 2; r < 80 && !at; r++) for (const [x, y] of [[p.x + r, p.y], [p.x - r, p.y], [p.x, p.y + r], [p.x, p.y - r]]) {
      const t = g.map.tileNum(x + 1, y, 0);
      if (!at && g.canStand(x, y, 0) && g.canStand(x, y + 1, 0) && !g.objects.get(x + 1, y, 0) && ((t >= 32 && t <= 36) || (t >= 40 && t <= 63))) at = [x, y];
    }
    g.relocate(at![0], at![1], 0);
    g.useObj(shovel);
    g.askWhere!.then(p.x + 1, p.y);
    expect((g.objects.list(p.x + 1, p.y, 0) ?? []).some((o) => o.objN === 257)).toBe(true);
    expect(g.objects.all().some((o) => o.objN === 258 && Math.abs(o.x - p.x) <= 1 && Math.abs(o.y - p.y) <= 1)).toBe(true);
    // Rocks into a barrow, the barrow into a rail car.
    const put = (n: number, x: number, y: number): ReturnType<typeof g.objects.create> => {
      const o = g.objects.create(n, n === 268 || n === 410 ? 0 : 1, 0);
      [o.x, o.y, o.z] = [x, y, 0];
      g.objects.add(o);
      return o;
    };
    for (const m of g.party.slice(1)) m.actor.visible = false; // out of the way
    const rocks = put(442, p.x - 1, p.y);
    const barrow = put(268, p.x, p.y - 1);
    const car = put(410, p.x - 1, p.y - 1);
    g.useObj(shovel);
    g.askWhere!.then(rocks.x, rocks.y);
    g.askWhere!.then(barrow.x, barrow.y);
    expect([barrow.qty, barrow.quality, rocks.loc]).toEqual([1, 2, 'none']);
    g.useObj(shovel);
    g.askWhere!.then(barrow.x, barrow.y);
    g.askWhere!.then(car.x, car.y);
    expect([barrow.qty, car.qty, car.quality]).toEqual([0, 1, 2]);
  });

  it.runIf(folder === 'savage')('picks corn, digs clay and shapes a pot', () => {
    const g = new Game(load());
    const stalk = g.objects.all().find((o) => o.objN === 61 && o.loc === 'map')!;
    g.relocate(stalk.x, stalk.y + 1, stalk.z);
    g.useObj(stalk);
    const stick = g.objects.create(131, 1, 0);
    g.objects.toInventory(stick, g.player.id);
    g.useObj(stick);
    g.useObj(g.objects.inventories[g.player.id].find((o) => o.objN === 192)!);
    expect(g.log.slice(-3).map((l) => l.text)).toEqual(['You got some corn from the plant.', 'You get some clay.', 'You shaped a small, soft pot from the clay.']);
    expect(g.objects.inventories[g.player.id].some((o) => o.objN === 132)).toBe(true);
  });

  it.runIf(folder === 'savage')('searches a pouch, basket or pot looked at, tipping out what it holds', () => {
    const g = new Game(load());
    const pouch = g.objects.all().find((o) => [182, 183, 184].includes(o.objN) && o.loc === 'map' && o.container?.length && g.objects.get(o.x, o.y, o.z) === o)!;
    expect(pouch).toBeTruthy();
    const inside = [...pouch.container!];
    g.look(pouch.x, pouch.y);
    expect(g.log.at(-1)!.text).toMatch(/^Searching here, you find .+\.$/);
    expect(pouch.container!.length).toBe(0);
    for (const c of inside) expect([c.loc, c.x, c.y]).toEqual(['map', pouch.x, pouch.y]);
    // Empty now, it has nothing more to give.
    g.search(pouch);
    expect(g.log.at(-1)!.text).toBe('Searching here, you find nothing.');
    // A container can be filled again.
    expect(g.objects.isContainer(183)).toBe(true);
  });

  it.runIf(folder === 'savage')('pulls a branch from a tree and fishes by water', () => {
    const g = new Game(load());
    const tree = g.objects.all().find((o) => o.objN >= 263 && o.objN <= 266 && o.loc === 'map' && g.canStand(o.x, o.y + 1, o.z))!;
    expect(tree).toBeTruthy();
    g.relocate(tree.x, tree.y + 1, tree.z);
    g.useObj(tree);
    expect(g.log.at(-1)!.text).toBe('You pulled a branch from the tree.');
    const pole = g.objects.create(212, 1, 0);
    g.objects.toInventory(pole, g.player.id);
    let shore: [number, number] | null = null;
    const p = g.player;
    for (let r = 1; r < 120 && !shore; r++) for (let dx = -r; dx <= r && !shore; dx++) for (const dy of [-r, r]) {
      const x = p.x + dx;
      const y = p.y + dy;
      if (g.canStand(x, y, p.z) && [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([a, b]) => g.map.isWater(x + a, y + b, p.z))) shore = [x, y];
    }
    expect(shore).toBeTruthy();
    g.relocate(shore![0], shore![1], p.z);
    for (let i = 0; i < 60 && !g.objects.inventories[p.id].some((o) => o.objN === 213); i++) g.useObj(pole);
    expect(g.objects.inventories[p.id].some((o) => o.objN === 213)).toBe(true);
  });

  it.runIf(folder === 'martian')('pushes a wheelbarrow, drills rock, and runs the conveyor', () => {
    const g = new Game(load());
    const p = g.player;
    const hide = (): void => {
      for (const m of g.party.slice(1)) m.actor.visible = false;
    };
    let pushedOk = false;
    for (const b of g.objects.all().filter((o) => o.objN === 268)) {
      const d = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => g.canStand(b.x - dx, b.y - dy, b.z) && g.canStand(b.x + dx, b.y + dy, b.z));
      if (!d) continue;
      g.relocate(b.x - d[0], b.y - d[1], b.z);
      hide();
      const [bx, by] = [b.x, b.y];
      expect(g.move(d[0], d[1])).toBe(true);
      expect([b.x, b.y]).toEqual([bx + d[0], by + d[1]]);
      expect([p.x, p.y]).toEqual([bx, by]);
      pushedOk = true;
      break;
    }
    expect(pushedOk).toBe(true);
    // A drill facing rock (tiles 0xf0 to 0xfb) leaves a pile of rocks beside it.
    const drill = g.objects.all().find((o) => o.objN === 441)!;
    const ahead = drill.frameN === 1 ? [drill.x - 1, drill.y] : drill.frameN === 3 ? [drill.x, drill.y - 1] : drill.frameN === 4 ? [drill.x, drill.y + 1] : [drill.x + 1, drill.y];
    g.relocate(drill.x, drill.y + 1, drill.z);
    const piles = (): number => g.objects.all().filter((o) => o.objN >= 442 && o.objN <= 444 && Math.abs(o.x - drill.x) <= 1 && Math.abs(o.y - drill.y) <= 1).length;
    const before = piles();
    g.useObj(drill);
    const t = g.map.tileNum(ahead[0], ahead[1], drill.z);
    if (t >= 0xf0 && t <= 0xfb) expect(piles()).toBe(before + 1);
    else expect(g.log.length).toBeGreaterThan(0);
    // The belt carries coal east while the power runs.
    const coal = g.objects.create(447, 1, 0);
    [coal.x, coal.y, coal.z] = [0x3a, 0x63, 5];
    g.objects.add(coal);
    g.actors.get(0x73)!.talkFlags |= 1 << 2;
    g.relocate(0x3a, 0x65, 5);
    g.pass();
    expect(coal.x).toBe(0x3b);
  });

  it.runIf(folder === 'martian')('goes down stairs and through mine mouths to where they lead', () => {
    const g = new Game(load());
    const p = g.player;
    const ENT = [[0x43, 0x51, 1], [0x80, 0x8d, 0], [0x76, 0xf2, 3], [0x7a, 0x0c, 3], [0x9a, 0x41, 4], [0x2b2, 0x1cc, 0], [0x73, 0x40, 4],
      [0x29d, 0x1ce, 0], [0xb3, 0xe1, 4], [0x27b, 0x1f1, 0], [0xc3, 0x70, 1], [0xcb, 0x1d1, 0], [0x24, 0xf1, 1], [0x31a, 0x232, 0],
      [0x5c, 0xf1, 1], [0x34c, 0x25a, 0], [0x7c, 0x28, 4], [0x13e, 0x118, 0], [0x0a, 0x61, 5], [0x3b7, 0x1c4, 0], [0x5c, 0xb1, 5],
      [0x3dc, 0x1dd, 0], [0x5e, 0x29, 4], [0x227, 0x1ab, 0]];
    let tried = 0;
    for (const e of g.objects.all().filter((o) => [175, 163, 180, 178].includes(o.objN) && o.quality > 0 && o.loc === 'map')) {
      const from = [[0, 1], [0, -1], [1, 0], [-1, 0]].find(([dx, dy]) => g.canStand(e.x + dx, e.y + dy, e.z));
      if (!from || !g.map.isPassable(e.x, e.y, e.z)) continue;
      g.relocate(e.x + from[0], e.y + from[1], e.z);
      g.move(-from[0], -from[1]);
      expect([p.x, p.y, p.z]).toEqual(ENT[e.quality - 1]);
      if (++tried >= 4) break;
    }
    expect(tried).toBeGreaterThan(0);
  });

  it.runIf(folder === 'martian')('dreams in the dream machine, travels the dream, and wakes', () => {
    const g = new Game(load());
    const p = g.player;
    g.relocate(68, 168, 0);
    [p.x, p.y] = [68, 167]; // in the machine's seat
    const carried = g.objects.inventories[p.id].length;
    const panel = g.objects.all().find((o) => o.objN === 458 && o.x === 69 && o.y === 166)!;
    g.useObj(panel);
    expect([p.x, p.y, p.z]).toEqual([0x93, 0x34, 2]);
    expect(g.party.length).toBe(1);
    expect(g.objects.inventories[p.id].length).toBe(0);
    // A dream saved and loaded is still a dream.
    const back = new Game(load(), g.save());
    expect(back.mdUse.dream?.companions.length).toBe(2);
    // A teleporter in the dream.
    const t = g.objects.all().find((o) => o.objN === 461 && o.x === 145 && o.y === 49 && o.z === 2)!;
    [p.x, p.y] = [t.x, t.y + 1];
    g.move(0, -1);
    expect([p.x, p.y]).toEqual([t.quality, t.qty]);
    g.mdUse.wake();
    expect([p.x, p.y, p.z]).toEqual([68, 167, 0]);
    expect(g.party.length).toBe(3);
    expect(g.objects.inventories[p.id].length).toBe(carried);
    expect(g.clock.hour).toBe(8);
  });

  it.runIf(folder === 'martian')('makes the Avatar from Freud\'s interview', () => {
    const g = new Game(load());
    expect(g.fresh).toBe(true);
    const it2 = interview(g.sceneText('scenetxt.lzc', 5), (lo) => lo);
    let r = it2.next('');
    let asked = 0;
    while (!r.done) {
      if (r.value.ask !== 'go') asked++;
      r = it2.next(r.value.ask === 'name' ? 'Nellie' : 'b');
    }
    expect(asked).toBeGreaterThanOrEqual(5);
    g.createHero({ ...r.value, face: 0 });
    const a = g.player;
    expect([g.playerName(), g.gender, a.objN, a.level]).toEqual(['Nellie', 1, 344, 4]);
    expect(a.hp).toBe(a.strength * 2 + 96);
  });

  it.runIf(folder === 'ultima6')('leaves thrown daggers where they land, and a wrecked ship as a raft', () => {
    const g = new Game(load());
    for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    const p = g.player;
    // A dagger thrown at a troll three squares off lands by it, there to be picked up.
    const spot = [[3, 0], [-3, 0], [0, 3], [0, -3]].find(([dx, dy]) => g.canStand(p.x + dx, p.y + dy, p.z) && g.combat.clearLine(p.x, p.y, p.x + dx, p.y + dy, p.z))!;
    const troll = g.combat.spawn(371, p.x + spot[0], p.y + spot[1], p.z, 0, 0xe)!;
    for (const o of g.objects.inventories[p.id]) if (o.loc === 'readied') o.loc = 'inv';
    const daggers = g.objects.create(38, 1, 0);
    g.objects.toInventory(daggers, p.id);
    g.ready(daggers, p);
    g.combat.attack(p, troll);
    expect(g.objects.inventories[p.id].some((o) => o.objN === 38)).toBe(false);
    expect(g.objects.all().some((o) => o.objN === 38 && Math.max(Math.abs(o.x - troll.x), Math.abs(o.y - troll.y)) <= 3)).toBe(true);
    // The party's ship, its hull gone, breaks up and leaves them on a raft.
    let sea: [number, number] | null = null;
    for (let y = 0; y < 1024 && !sea; y += 7) for (let x = 0; x < 1024 && !sea; x += 7) {
      if ([-2, -1, 0, 1, 2].every((d) => g.map.isWater(x + d, y, 0) && g.map.isWater(x, y + d, 0))) sea = [x, y];
    }
    expect(sea).toBeTruthy();
    const v = g.actors.get(0)!;
    Object.assign(v, { objN: 412, baseObjN: 412, frameN: 0, x: sea![0], y: sea![1], z: 0, hp: 5, visible: true });
    v.setDirection(0);
    (g.combat as unknown as { hit: (a: unknown, d: number) => number }).hit(v, 50);
    expect(v.objN).toBe(415);
    expect(v.hp).toBe(10);
    expect(g.log.some((l) => l.text.includes('clings to a raft'))).toBe(true);
  });

  it.runIf(folder === 'ultima6')('boards a skiff, sails it, goes ashore; rides a horse', () => {
    const g = new Game(load());
    for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    // A skiff afloat with land beside it.
    const skiff = g.objects.all().find((o) => o.objN === 414 && o.quality === 0 && g.map.tile(o.x, o.y, o.z).water &&
      [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => g.canStand(o.x + dx, o.y + dy, o.z) && !g.map.tile(o.x + dx, o.y + dy, o.z).water))!;
    expect(skiff).toBeDefined();
    const [sx, sy, sz] = [skiff.x, skiff.y, skiff.z];
    const shore = [[-1, 0], [1, 0], [0, -1], [0, 1]].find(([dx, dy]) => g.canStand(sx + dx, sy + dy, sz) && !g.map.tile(sx + dx, sy + dy, sz).water)!;
    g.relocate(sx + shore[0], sy + shore[1], sz);
    g.useObj(skiff);
    expect(g.vehicle?.objN).toBe(414);
    expect(g.player.visible).toBe(false);
    // Sail somewhere and back (any square of water).
    const water = [[-1, 0], [1, 0], [0, -1], [0, 1]].find(([dx, dy]) => g.afloat(g.vehicle!, sx + dx, sy + dy));
    if (water) {
      expect(g.move(water[0], water[1])).toBe(true);
      expect(g.player.x).toBe(sx + water[0]);
      g.move(-water[0], -water[1]);
    }
    g.use(sx + shore[0], sy + shore[1]);
    expect(g.vehicle).toBeNull();
    expect(g.player.visible).toBe(true);
    expect(g.objects.list(sx, sy, sz)?.some((o) => o.objN === 414)).toBe(true);
    // A roaming horse beside the Avatar.
    const p = g.player;
    const spot = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => g.canStand(p.x + dx, p.y + dy, p.z))!;
    const horse = g.combat.spawn(430, p.x + spot[0], p.y + spot[1], p.z, 1, 0xc)!;
    g.use(horse.x, horse.y);
    expect(p.objN).toBe(431);
    g.use(p.x, p.y);
    expect(p.objN).toBe(410);
    expect(g.actors.list.some((a) => a.objN === 430 && a.id >= 203)).toBe(true);
  });

  it.runIf(folder === 'ultima6')('shows blue moongates while a moon is up, and goes through one', () => {
    const g = new Game(load());
    for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    g.clock.day = 4; // Trammel is up at noon
    g.clock.hour = 12;
    g.updateMoongates();
    const gates = g.objects.all().filter((o) => o.objN === 85 && o.z === 0);
    expect(gates.length).toBeGreaterThanOrEqual(7);
    const gate = gates.find((o) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.canStand(o.x + dx, o.y + dy, 0)))!;
    const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => g.canStand(gate.x + dx, gate.y + dy, 0))!;
    g.relocate(gate.x + dx, gate.y + dy, 0);
    g.move(-dx, -dy);
    const p = g.player;
    expect(g.moonstones.some(([x, y, z]) => p.x === x && p.y === y && p.z === z)).toBe(true);
  });

  it.runIf(folder === 'ultima6')('works the castle gate: its lever lifts the portcullis, its crank lowers the drawbridge', () => {
    const g = new Game(load());
    for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    const lever = g.objects.list(303, 383, 0)!.find((o) => o.objN === 268)!;
    const doorway = g.objects.all().find((o) => o.objN === 301 && o.z === 0 && o.quality === lever.quality)!;
    const shut = (): boolean => (g.objects.list(doorway.x, doorway.y, 0) ?? []).some((o) => o.objN === 310);
    const was = shut();
    g.relocate(304, 383, 0);
    g.use(303, 383);
    expect(shut()).toBe(!was);
    expect(g.log.at(-1)!.text).toContain('you hear a noise');
    expect(g.map.isPassable(doorway.x, doorway.y, 0)).toBe(was);
    g.use(303, 383);
    expect(shut()).toBe(was);
    // The crank beside it.
    const crank = g.objects.list(303, 384, 0)!.find((o) => o.objN === 288)!;
    const bridge = (): number => g.objects.all().filter((o) => o.objN === 269).length;
    const before = bridge();
    g.useObj(crank);
    const msg = g.log.at(-1)!.text;
    expect(msg).toMatch(/drawbridge/);
    g.useObj(crank);
    expect(bridge()).toBe(before);
    console.log('crank:', msg, before, 'bridge pieces');
  });

  it.runIf(folder === 'ultima6')('uses one of every kind of thing it knows without fault', () => {
    const g = new Game(load());
    for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    const p = g.player;
    const kinds = [268, 174, 288, 64, 63, 122, 145, 164, 206, 253, 236, 419, 233, 234, 181, 182, 264, 104, 103, 275, 93, 159, 235, 123, 153, 156, 157, 158, 296, 212, 169, 77, 96, 115, 128, 129, 131, 184, 242, 243, 244, 245, 246, 247, 248, 249, 73, 97, 62, 155, 57, 221, 223];
    for (const objN of kinds) {
      const o = g.objects.create(objN, 1, 0);
      [o.x, o.y, o.z] = [p.x + 1, p.y, p.z];
      g.objects.add(o);
      g.log = [];
      expect(() => {
        g.useObj(o);
        if (g.askWhere) g.askWhere.then(p.x + 1, p.y);
        if (g.askText) g.askText.then('xyzzy');
      }).not.toThrow();
      expect(g.log.some((l) => l.text === 'Not usable.') ? objN : 0).toBe(0);
      if (o.loc === 'map') g.objects.unlink(o);
      g.peer = false;
      g.won = false;
      g.scry = null;
      g.openBook = false;
    }
  });

  it.runIf(folder === 'ultima6')('rests only in the wilderness, and heals those who eat', () => {
    const g = new Game(load());
    for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    g.rest(2);
    expect(g.log.at(-1)!.text).toMatch(/^Rest - /);
    // Out to open grass, away from everyone.
    const p = g.player;
    let spot: [number, number] | null = null;
    for (let r = 20; r < 200 && !spot; r += 3) {
      for (const [x, y] of [[p.x + r, p.y], [p.x - r, p.y], [p.x, p.y + r], [p.x, p.y - r]]) {
        if (spot) break;
        let ok = true;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) ok &&= g.map.isPassable(x + dx, y + dy, 0);
        if (ok && !g.actors.list.some((a) => a.visible && a.objN && !a.inParty && a.z === 0 && Math.max(Math.abs(a.x - x), Math.abs(a.y - y)) <= 8)) spot = [x, y];
      }
    }
    g.relocate(spot![0], spot![1], 0);
    for (const m of g.party) m.actor.x = p.x, m.actor.y = p.y;
    (g as unknown as { inTown: () => boolean }).inTown = () => false;
    const hurt = g.party[0].actor;
    hurt.hp = 3;
    g.objects.toInventory(g.objects.create(129, 0, 5), hurt.id); // meat
    const mins = (): number => ((g.clock.day * 24 + g.clock.hour) * 60) + g.clock.minute;
    const t = mins();
    g.rest(4);
    console.log('rest:', g.log.slice(-6).map((l) => l.text));
    expect(g.log.some((l) => l.text === 'Mealtime!')).toBe(true);
    expect(mins() - t).toBeGreaterThanOrEqual(240);
    expect(hurt.hp).toBeGreaterThan(3);
  });

  it.runIf(folder === 'ultima6')('lifts a shrine force field with its rune and mantra', () => {
    const g = new Game(load());
    const field = g.objects.all().find((o) => o.objN === 51 && o.quality === 0)!;
    expect(field).toBeTruthy();
    g.relocate(field.x, field.y + 1, field.z);
    const rune = g.objects.create(242, 0, 0);
    g.objects.toInventory(rune, 1);
    g.useObj(rune);
    g.askText!.then('mu');
    expect(g.log.at(-1)!.text).toBe('Wrong mantra!');
    g.useObj(rune);
    g.askText!.then('ahm');
    expect(g.log.at(-1)!.text).toBe('Done!');
    expect(field.loc).not.toBe('map');
  });

  it.runIf(folder === 'ultima6')('blows a door open with a lit powder keg', () => {
    const g = new Game(load());
    const door = g.objects.all().find((o) => o.objN >= 297 && o.objN <= 300 && o.z === 0 && o.frameN <= 12)!;
    const keg = g.objects.create(223, 0, 0);
    [keg.x, keg.y, keg.z] = [door.x + 1, door.y, 0];
    g.objects.add(keg);
    g.useObj(keg);
    expect(keg.frameN).toBe(1);
    for (let i = 0; i < 4; i++) g.pass();
    expect(g.log.some((l) => l.text === 'Boom!')).toBe(true);
    expect(g.log.some((l) => l.text === 'The door is blown up!')).toBe(true);
  });

  it.runIf(folder === 'ultima6')('opens a red moongate with the orb, and goes through it', () => {
    const g = new Game(load());
    for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
    const orb = g.objects.inventories[1].find((o) => o.objN === 87)!;
    g.useObj(orb);
    expect(g.log.at(-1)!.text).toContain("can't figure out");
    g.actors.get(5)!.talkFlags |= 0x20; // Lord British has told of it
    // Walk to open floor first.
    const p = g.player;
    let spot: [number, number] | null = null;
    for (let dy = -6; dy <= 6 && !spot; dy++) for (let dx = -6; dx <= 6 && !spot; dx++) {
      const x = p.x + dx;
      const y = p.y + dy;
      if (g.canStand(x, y, 0) && g.canStand(x - 2, y - 2, 0) && g.canStand(x - 1, y - 1, 0)) spot = [x, y];
    }
    g.relocate(spot![0], spot![1], 0);
    g.useObj(orb);
    expect(g.askWhere).not.toBeNull();
    g.askWhere!.then(p.x - 2, p.y - 2); // the place for 0x383, 0x1f3
    expect(g.log.at(-1)!.text).toBe('A red moongate appears.');
    const way = g.pathTo(p.x - 2, p.y - 2)!;
    for (const [dx, dy] of way) g.move(dx, dy);
    expect([p.x, p.y, p.z]).toEqual([0x383, 0x1f3, 0]);
  });

  it.runIf(folder === 'ultima6')('readies and unreadies what the party carries', () => {
    const g = new Game(load());
    const dupre = g.party[1].actor;
    const inv = g.objects.inventories[dupre.id];
    const sword = inv.find((o) => o.objN === 43)!;
    expect(sword.loc).toBe('readied');
    g.unready(sword);
    expect(sword.loc).toBe('inv');
    expect(g.ready(sword, dupre)).toBe(true);
    // A second weapon held in both hands will not go on beside it.
    const halberd = g.objects.create(47, 0, 0);
    g.objects.toInventory(halberd, dupre.id);
    expect(g.ready(halberd, dupre)).toBe(false);
    expect(g.ready(g.objects.create(55, 5, 0), dupre)).toBe(false); // arrows
    console.log('Dupre readied:', inv.filter((o) => o.loc === 'readied').map((o) => g.objects.look(o)));
  });

  it('answers the copy protection\'s questions from the manual, every one', () => {
    const who = { ultima6: 5, martian: 16, savage: 33 }[folder];
    const right = { ultima6: /correct/i, martian: /pleased with your answers/i, savage: /memory has returned/i }[folder];
    const wrong = /not the correct answer|not fully returned|not studied|incorrect|wrong/i;
    const asked = new Set<string>();
    let tries = 0;
    for (; tries < 60; tries++) {
      const g = new Game(load());
      for (const a of g.actors.list) if (a.objN === 363) Object.assign(a, { objN: 0, visible: false });
      const a = g.actors.list.find((x) => g.lib.scriptNum(x) === who && x.objN !== 0);
      if (!a) break;
      // Martian Dreams asks when the hatch is pried open (use_prybar_on_hatch).
      if (folder === 'martian') a.talkFlags |= 1 << 2;
      g.talkTo(a);
      for (let i = 0; i < 80 && g.converse; i++) {
        const ask = g.asking();
        if (g.paused) g.continueTalk();
        else if (ask) {
          if (ask.type === 'char') g.reply('y');
          else if (ask.type === 'keyword') g.reply('bye');
          else g.reply('Avatar');
        } else break;
      }
      const text = g.log.map((l) => l.text).join('\n');
      const answered = g.log.filter((l) => l.text === '(The answer, from the manual:)').length;
      if (answered === 0) continue;
      expect(text).toMatch(right);
      expect(text).not.toMatch(wrong);
      for (let i = 0; i < g.log.length; i++) if (g.log[i].text === '(The answer, from the manual:)') asked.add(g.log[i + 1].text);
      if (asked.size >= ({ ultima6: 10, martian: 9, savage: 9 }[folder])) break;
    }
    console.log(folder, 'answers given', [...asked].join(', '), 'in', tries + 1, 'conversations');
    expect(asked.size).toBeGreaterThan(0);
  });

  it('holds a conversation with everyone who has one, without the interpreter failing', () => {
    const g = new Game(load());
    let talked = 0;
    const odd: string[] = [];
    for (const a of g.actors.list) {
      if (a === g.player || !g.lib.script(g.lib.scriptNum(a))) continue;
      a.statusFlags &= ~0x04;
      g.log = [];
      g.talkTo(a);
      if (!g.converse) continue;
      talked++;
      // Ask what there is to ask, then leave.
      for (let n = 0; n < 40 && g.converse; n++) {
        if (g.paused) g.continueTalk();
        else {
          const ask = g.asking();
          const opts = g.sayOptions();
          if (!ask) break;
          const pick = opts[n] ?? opts[opts.length - 1];
          g.reply(ask.type === 'number' ? '1' : ask.type === 'char' ? ask.allowed[0] ?? 'n' : pick ? pick.say : 'bye');
        }
      }
      if (g.converse) {
        for (let n = 0; n < 30 && g.converse; n++) (g.paused ? g.continueTalk() : g.reply(g.asking()?.type === 'char' ? 'n' : 'bye'));
      }
      const text = g.log.map((l) => l.text).join('');
      // A few story scenes will not let go until the right thing is asked; that is the script, not the interpreter.
      if (g.converse && !g.log.some((l) => l.kind === 'npc')) odd.push(`${a.id}: said nothing`);
      if (/\[|[\x00-\x09\x0b-\x1f\x7f-\xff]/.test(text)) odd.push(`${a.id}: ${JSON.stringify(text.match(/.{0,30}(\[|[\x00-\x09\x0b-\x1f\x7f-\xff]).{0,30}/)?.[0])}`);
      g.converse = null;
      g.paused = false;
    }
    console.log('talked with', talked, 'odd:', odd.length, odd.slice(0, 25));
    expect(odd).toEqual([]);
    expect(talked).toBeGreaterThanOrEqual(people);
  });
});
}
