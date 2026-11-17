# Nuvie Web

A TypeScript port of the Nuvie engine - Ultima VI, Martian Dreams and The Savage Empire - for a phone held upright
(or sideways) and for any browser. Like Nuvie, it
plays **your own copy** of the game and ships none of it: on the first screen, choose the game's folder, its files or
a .zip, and they are kept in the browser (IndexedDB) and never leave the device.

**Try the demo world** on the first screen needs no game at all: a small island made for this port (its own tiles,
people and words), written out in the game's file formats so the whole engine runs on it. The tests use it too.

```sh
cd web
npm install
npm run dev      # http://localhost:5173/  (?demo starts the demo world, ?demo&new starts it afresh)
npm test         # the engine's tests, on the demo world
npm run build    # a static site in dist/
```

## The look

With your copy of the game the interface takes its look from the game's own files at run time: its 8-pixel typeface
(`u6.ch`, made into a font) at one size throughout, its parchment and burnt edge (`paper.bmp`, cut into frames for the
map, the pane and every sheet), its scroll's ink and red keywords, and its command icons on the buttons. None of it
is in this repository; the demo world uses the same colours with a plain frame.

**Night** is a modern take, not the original's black that closes in square by square: a soft blue dusk over the map,
deeper underground, with smooth pools of light round the party, and warm firelight from lamps, braziers and torches.
Sunset and sunrise glow orange.

## The screen

- **Upright**: the map fills the width at the top and takes the taps; under it one pane, the **Log** or the
  **Party**, with tabs beside it to choose (the Log tab is marked when there is news); at the foot, the commands.
- **Sideways**: the map at the left, the pane and the commands beside it.
- **Hold to walk**: hold a finger on the map and the party walks towards it, round walls, for as long as it stays
  down; slide it to steer, lift it to stop. Held, the party walks into no one - talking and fighting are a tap's.
- **Tap to walk**: a tap walks there, round what is in the way, the way marked as it goes. A tap on a person walks up
  and talks; on a door, ladder, sign or chest, walks up and uses it. Walking into a shut door opens it. Tap the party
  to pass a turn or pick up what is underfoot.
- **Fighting**: tap a foe to walk up and attack it - from as far as the weapon reaches, a bow from across a room -
  or choose **Attack** and tap. The rest of the party fights by itself; blows land with the game's own hit
  sparks, and arrows and thrown weapons fly. Monsters hatch from the game's eggs as the party travels.
- **Magic**: **Cast** opens the spellbook of whoever has one readied: their magic points and reagents, and their
  spells by circle with the words of power. A spell aimed at someone or somewhere asks for a tap on the map.
- **Look, Talk, Use, Get**: choose one (the game's own icons), then tap where. **Pass** lets a turn go by; the
  last button opens the journal.
- **Talking**: the speaker's face shows over the map (which shrinks to give the words room), and the foot becomes a
  menu of what can be said: Name and
  Job, the words this person has dropped (shown in gold in what they say), Bye - or Yes and No where that is the
  question - with a box to type anything else. Where the speaker stops, **Continue** goes on.
- **Party**: tap a member for their numbers and what they carry; tap a thing to use it, drop it or hand it on.
- **Journal**: everyone spoken with, what each said to each thing asked, the words they answer to, and every sign
  and book read.
- The game saves itself as you play. A keyboard works too: arrows walk, space passes, L/T/U/G choose a command.

## What is ported, and what is not

Ported from the C++ (each file's header names its source):

| Here | From |
|---|---|
| `src/files/lzw.ts`, `lib.ts` | `files/U6Lzw.cpp`, `files/U6Lib_n.cpp` |
| `src/game/tiles.ts` | `TileManager.cpp`, `Look.cpp` |
| `src/game/map.ts`, `objects.ts` | `Map.cpp`, `Obj.cpp`, `ObjManager.cpp` |
| `src/game/actors.ts`, `u6tables.ts` | `actors/Actor*.cpp`, `U6ActorTypes.h`, `U6objects.h` (`npm run tables` regenerates) |
| `src/game/converse.ts` | `Converse.cpp`, `ConverseInterpret.cpp` |
| `src/game/game.ts` | parts of `Game.cpp`, `Event.cpp`, `Player.cpp`, `Party.cpp`, `SaveGame.cpp`, `usecode/U6UseCode.cpp` |
| `src/game/combat.ts`, `u6combat.ts` | `data/scripts/u6/actor.lua` (attack, hit, damage, death, targets, monster set-up; `npm run tables` regenerates), `EggManager.cpp`, the temporary actors of `ActorManager.cpp` |
| `src/game/magic.ts` | `Magic.cpp`, `data/scripts/u6/magic.lua` and `magic/circle_*/*.lua` |
| `src/ui/mapview.ts` | `MapWindow.cpp` (drawing order, line of sight, wall reshaping), `GamePalette.cpp` |

Working: loading a new game or an original saved game; the map, objects, animated tiles and cycling colours; line
of sight; walking with a party following; schedules (people go about their day); looking; the whole conversation
interpreter; doors, keys, ladders, caves, secret doors, passthroughs, containers, signs and books, food; getting,
dropping and giving; saving.

**Martian Dreams and The Savage Empire** load too, from the same screen (the game is told by its files): their map,
people, schedules, conversations, faces (`mdfaces.lzc`, `faces.lzc`), palette, and their own 8-pixel font
(`system.lzc`), with Martian Dreams' doors. They have no parchment picture, so they take the plain frame. Their Lua
usecode (most of what using things does in them) and the scenes behind their faces are not ported.

**Combat** follows Ultima VI's rules as Nuvie's Lua has them: the hit roll (dexterity, or strength for clubs and
maces, against the foe's dexterity), weapon damage less a roll against readied armour, half damage for the creatures
that take it, poison, experience for evil foes slain, bodies that hold what was carried, ammunition, missile walls,
and death - the Avatar wakes in Lord British's castle with the fallen raised. Simplified: each fighter acts once a
turn (not by movement points), monsters that cast fight bare-handed, and thrown weapons are not lost.

**Magic** has Magic.cpp's checks - a readied spellbook holding the spell, a level and magic points as high as its
circle, a reagent of each kind - and magic points come back each hour. 55 of the 80 spells are ported from their Lua:
the healing, harming and killing spells, the winds and storms, sleep, poison, paralysis, charm, curse, protection,
invisibility, fear and confusion, Light, Infravision, X-ray and Peer (the land seen from above), locking and
unlocking, Vanish and Reappear, Conjure, Insect Swarm and Summon, Time Stop, Tremor, Help and Resurrect. The rest
(fields, Gate Travel, Wizard Eye, Enchant, Clone, Armageddon and the like) cost their reagents but say they are not
yet ported. Their effects wear off as in the original, poison bites now and then, and the charmed fight for the
party. Torches can be lit and held, and Light and torches widen the party's
light at night.

**The Orb of the Moons** works as in Ultima VI once Lord British has told of it: use it from the Avatar's sheet,
tap a square near the party, and a red moongate opens there that leads where that square says; step in.

**Boats and horses**: tap a ship, skiff or raft beside the party to board it (a ship whose deed the party holds);
tap water to sail, and land beside the boat to go ashore. Ships keep to open water and must have room to turn.
Tap a roaming horse to ride it, and the rider to get down.

Not ported yet: the remaining spells, most of Nuvie's other Lua scripts, balloons, the blue moongates of the
moons, sound and music, the intro and ending, most other usecode, and the largest creatures (dragons, hydras, the
silver serpent, which draw as one tile).

`tests/real.test.ts` runs on your copies put in `web/gamedata/ultima6/`, `savage/` and `martian/` (git-ignored).
For each it loads a new game, saves and restores it, and talks with everyone who has a conversation (199 people in
Ultima VI, 68 in Savage Empire, 99 in Martian Dreams). For Ultima VI it also hatches the opening gargoyles, fights a
troll to the death, readies and unreadies, casts spells, and goes through a red moongate.

Licensed as Nuvie is: GPL 2 or later.
