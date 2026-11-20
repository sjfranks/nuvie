/**
 * partyfollow.ts - the party following its leader, as Nuvie's Party::follow and PartyPathFinder have it: each member
 * has a place in the formation, turned to the way the leader faces; on a first pass each keeps beside someone ahead
 * of them in the formation and steps towards their place (trying round about when blocked, and shoving aside a member
 * further back who is in the way); on a second each catches up - forward the way the leader went, or sideways after
 * a diagonal step. One left behind makes for the leader.
 */
import type { Actor } from './actors.ts';
import type { Game } from './game.ts';
import { wrap } from './map.ts';

/** The eight ways round a square, clockwise from the north-west (DirFinder's neighbours). */
const AROUND: [number, number][] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];

const sgn = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0);

/** DirFinder::get_adjacent_dir: a way turned by some eighths. */
function turn(dx: number, dy: number, by: number): [number, number] {
  const i = AROUND.findIndex(([x, y]) => x === dx && y === dy);
  if (i < 0) return [dx, dy];
  return AROUND[(((i + by) % 8) + 8) % 8];
}

/** DirFinder::get_turn_towards_dir: which way to turn from one way to face another (-1, 0 or 1). */
function turnTowards(ox: number, oy: number, tx: number, ty: number): number {
  const o = Math.max(0, AROUND.findIndex(([x, y]) => x === sgn(ox) && y === sgn(oy)));
  const t = Math.max(0, AROUND.findIndex(([x, y]) => x === sgn(tx) && y === sgn(ty)));
  let r = t - o;
  if (r > 4) r = -(8 - r);
  return Math.max(-1, Math.min(1, r));
}

export class PartyFollow {
  /** Where the leader stood before the step just taken. */
  private prevX = 0;
  private prevY = 0;
  /** Members shoved aside this turn: they move no more until the next. */
  private spent = new Set<Actor>();

  constructor(private readonly g: Game) {}

  private get members(): Actor[] {
    return this.g.party.map((m) => m.actor);
  }

  private get leader(): Actor {
    return this.g.party[0].actor;
  }

  private dist(ax: number, ay: number, bx: number, by: number): number {
    return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  }

  private target(p: number): [number, number] {
    return this.g.formationSpot(p);
  }

  /** PartyPathFinder::is_contiguous: beside someone ahead of this one in the formation. */
  private contiguous(p: number, x = this.members[p].x, y = this.members[p].y): boolean {
    for (let q = 0; q < p; q++) {
      const a = this.members[q];
      if (this.dist(x, y, a.x, a.y) <= 1) return true;
    }
    return false;
  }

  private atTarget(p: number): boolean {
    const [tx, ty] = this.target(p);
    const a = this.members[p];
    return a.x === tx && a.y === ty;
  }

  private targetDir(p: number): [number, number] {
    const [tx, ty] = this.target(p);
    const a = this.members[p];
    return [sgn(tx - a.x), sgn(ty - a.y)];
  }

  private forwardDir(): [number, number] {
    return [[0, -1], [1, 0], [0, 1], [-1, 0]][this.leader.direction & 3] as [number, number];
  }

  private leaderMoved(): boolean {
    return this.leader.x !== this.prevX || this.leader.y !== this.prevY;
  }

  private leaderMovedDiagonally(): boolean {
    return this.prevX !== this.leader.x && this.prevY !== this.leader.y;
  }

  /** The leader is now further from this one than from their place. */
  private leaderMovedAway(p: number): boolean {
    const l = this.leader;
    const a = this.members[p];
    const [tx, ty] = this.target(p);
    return this.dist(l.x, l.y, a.x, a.y) > this.dist(l.x, l.y, tx, ty);
  }

  /** The place lies the way the leader faces. */
  private behindTarget(p: number): boolean {
    const a = this.members[p];
    const [tx, ty] = this.target(p);
    const d = this.leader.direction & 3;
    return (d === 0 && ty - a.y < 0) || (d === 2 && ty - a.y > 0) || (d === 1 && tx - a.x > 0) || (d === 3 && tx - a.x < 0);
  }

  /** Actor::move for a follower: onto a square they may stand on, nobody there. */
  private step(a: Actor, x: number, y: number, dx: number, dy: number): boolean {
    const g = this.g;
    if (!g.passableFor(a, x, y, a.z) || g.actors.at(wrap(x, a.z), wrap(y, a.z), a.z)) return false;
    a.x = wrap(x, a.z);
    a.y = wrap(y, a.z);
    a.setDirection(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : dy < 0 ? 0 : a.direction);
    return true;
  }

  /** PartyPathFinder::move_member: a step, if it keeps them beside someone ahead (or that does not matter). */
  private moveMember(p: number, dx: number, dy: number, ignorePosition = false, canBump = true): boolean {
    if (dx === 0 && dy === 0) return true;
    const a = this.members[p];
    const x = a.x + dx;
    const y = a.y + dy;
    if (!this.contiguous(p, x, y) && !ignorePosition) return false;
    if (this.step(a, x, y, dx, dy)) return true;
    // Blocked by one further back in the party: shove them aside, and go.
    const there = this.g.actors.at(wrap(x, a.z), wrap(y, a.z), a.z);
    const q = there ? this.members.indexOf(there) : -1;
    if (!canBump || q < p) return false;
    if (this.bump(q, p) && this.step(a, x, y, dx, dy)) return true;
    return false;
  }

  /** PartyPathFinder::bump_member: one in the way moves aside, nearest their own place, or changes places. */
  private bump(q: number, p: number): boolean {
    const b = this.members[q];
    if (this.spent.has(b)) return false;
    const a = this.members[p];
    let [tx, ty] = this.target(q);
    if (tx === b.x && ty === b.y) [tx, ty] = [this.leader.x, this.leader.y];
    // The squares round them, nearest the place first; those with one of the party on go last.
    const near = AROUND.map(([dx, dy]) => [b.x + dx, b.y + dy] as [number, number]).sort((s, t) => {
      const ps = this.members.some((m) => m.x === s[0] && m.y === s[1]) ? 1 : 0;
      const pt = this.members.some((m) => m.x === t[0] && m.y === t[1]) ? 1 : 0;
      return ps - pt || this.dist(s[0], s[1], tx, ty) - this.dist(t[0], t[1], tx, ty);
    });
    for (const [x, y] of near) {
      if (x === a.x && y === a.y) {
        // Change places (Actor::push, ACTOR_PUSH_HERE).
        [a.x, a.y, b.x, b.y] = [b.x, b.y, a.x, a.y];
        this.spent.add(b);
        return true;
      }
      if (this.step(b, x, y, x - b.x, y - b.y)) {
        this.spent.add(b);
        return true;
      }
    }
    return false;
  }

  /** try_moving_to_target: towards the place, else either way round, the one across the leader's way first. */
  private toTarget(p: number): boolean {
    const [rx, ry] = this.targetDir(p);
    if (this.moveMember(p, rx, ry, false, false)) return true;
    const [lx, ly] = this.forwardDir();
    let [x2, y2] = turn(rx, ry, -1);
    let [x3, y3] = turn(rx, ry, 1);
    if (!(Math.abs(x2) === Math.abs(ly) && Math.abs(y2) === Math.abs(lx))) {
      [x2, y2] = turn(x2, y2, 2);
      [x3, y3] = turn(x3, y3, -2);
    }
    return this.moveMember(p, x2, y2) || this.moveMember(p, x3, y3);
  }

  /** try_all_directions: every way, towards the leader first and turning towards the place. */
  private allDirections(p: number, tx: number, ty: number): boolean {
    const a = this.members[p];
    const l = this.leader;
    let [dx, dy] = [sgn(l.x - a.x), sgn(l.y - a.y)];
    if (dx === 0 && dy === 0) [dx, dy] = [0, -1];
    const rot = turnTowards(dx, dy, tx - a.x, ty - a.y) || 1;
    const [rx, ry] = this.target(p);
    for (let i = 0; i < 8; i++) {
      if (this.dist(a.x + dx, a.y + dy, rx, ry) === 1 && this.moveMember(p, dx, dy)) return true;
      [dx, dy] = turn(dx, dy, rot);
    }
    const toPlace = this.dist(rx, ry, l.x, l.y);
    const now = this.dist(a.x, a.y, l.x, l.y);
    for (let i = 0; i < 8; i++) {
      const d = this.dist(a.x + dx, a.y + dy, l.x, l.y);
      if ((d <= toPlace || d <= now) && this.moveMember(p, dx, dy)) return true;
      [dx, dy] = turn(dx, dy, rot);
    }
    if (!this.contiguous(p)) {
      for (let i = 0; i < 8; i++) {
        if (this.moveMember(p, dx, dy)) return true;
        [dx, dy] = turn(dx, dy, rot);
      }
    }
    return false;
  }

  /** follow_passA: keep together, and towards the place. */
  private passA(p: number): boolean {
    const together = this.contiguous(p);
    let again = false;
    const [rx, ry] = this.targetDir(p);
    if (together) {
      if (this.atTarget(p)) return true;
      if (!this.leaderMoved() && !this.toTarget(p)) again = true;
      else if (this.leaderMoved() && this.leaderMovedAway(p) && !this.toTarget(p) && this.behindTarget(p)) again = true;
    } else if (!this.moveMember(p, rx, ry)) again = true;
    if (again) {
      const [tx, ty] = this.target(p);
      if (!this.allDirections(p, tx, ty)) {
        if (together) return false;
        if (!this.moveMember(p, rx, ry, true)) return false;
      }
    }
    return true;
  }

  /** follow_passB: catch up - forward, or sideways after a diagonal step. */
  private passB(p: number): void {
    if (this.contiguous(p)) {
      if (this.atTarget(p)) return;
      if (this.leaderMovedAway(p)) {
        if (this.leaderMoved() && this.behindTarget(p)) {
          const [fx, fy] = this.forwardDir();
          this.moveMember(p, fx, fy);
        }
        if (this.leaderMovedDiagonally()) {
          const [rx, ry] = this.targetDir(p);
          if (!this.moveMember(p, rx, 0)) this.moveMember(p, 0, ry);
        }
      }
    } else {
      const [fx, fy] = this.forwardDir();
      if (!this.moveMember(p, fx, fy)) {
        const a = this.members[p];
        this.allDirections(p, a.x + fx, a.y + fy);
      }
    }
  }

  /** One left behind makes for the leader (seek_leader), over anything but walls; far behind, they catch up at once. */
  private seek(p: number): void {
    const a = this.members[p];
    const l = this.leader;
    if (this.dist(a.x, a.y, l.x, l.y) > 8) {
      // Out of reach of a step at a time (round a corner, through a door shut behind): beside the leader.
      for (const [dx, dy] of AROUND) {
        if (this.step(a, l.x + dx, l.y + dy, dx, dy)) return;
      }
      return;
    }
    let [dx, dy] = [sgn(l.x - a.x), sgn(l.y - a.y)];
    for (const by of [0, -1, 2]) {
      [dx, dy] = turn(dx, dy, by);
      if (this.moveMember(p, dx, dy, true, true)) return;
    }
  }

  /** Party::follow: the leader has stepped by (dx, dy); the rest follow. */
  follow(dx: number, dy: number): void {
    const n = this.members.length;
    if (n < 2) return;
    this.prevX = this.leader.x - dx;
    this.prevY = this.leader.y - dy;
    this.spent.clear();
    const again: boolean[] = [];
    for (let p = 1; p < n; p++) {
      const a = this.members[p];
      if (a.z !== this.leader.z || this.spent.has(a)) continue;
      again[p] = !this.passA(p);
    }
    for (let p = 1; p < n; p++) {
      const a = this.members[p];
      if (a.z !== this.leader.z || this.spent.has(a)) continue;
      if (again[p]) this.passA(p);
      this.passB(p);
      if (!this.contiguous(p)) this.seek(p);
    }
  }
}
