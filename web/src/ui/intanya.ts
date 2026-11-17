/**
 * intanya.ts - Savage Empire's character creation (data/scripts/se/intro.lua, create_new_character): the shaman
 * Intanya's three questions, each answer adding to strength, dexterity or intelligence and choosing the next question.
 * And the ending's words (se/lang/en/game.lua, ending.lua).
 */

export const INTRO = [
  'You are in a dirt-floored hut... and a tribesman with wise eyes stares down at you. You feel as though you are floating. You cannot move your limbs. It is like a dream... yet you sense it is not a dream.',
  'The man speaks: "Yes, warrior, you can hear. You see Intanya, shaman and healer. Intanya will heal you... but to concoct his healing potion, he must ask you questions."',
  '"In order to heal your spirit, Intanya must know your spirit, so you must answer with truthful words." "Intanya will speak of deeds and choices; you must answer with the choices you would make."',
];
export const ASK_NAME = '"First, though, Intanya must know the warrior\'s name, for there is much power in names. What does the warrior call himself?"';

/** create_questions_text: each question's lines. */
export const QUESTIONS = [
  'Your chief has told you to guard the village while a battle rages nearby. Your chief fights in the battle. Will you (a) obey the word of your chief, or (b) join your fellow warriors in the fight?',
  'You fight a warrior you hate, and knock his spear from his hands. Another blow and he will be dead. Will you (a) let him surrender, and spare him if he does, or (b) slay him where he stands?',
  'One warrior borrows another\'s spear and fails to return it. Days later, he mislays his own spear and you find it. Do you (a) return it to him, or (b) give it to the warrior who is owed the spear?',
  'You have sworn to protect your chief at any cost. Yet you see him foully murder a warrior of his own tribe. The murdered man\'s brother asks you what you saw. Will you (a) keep your oath and protect your king, or (b) tell the truth of the matter?',
  'A huge, powerful warrior stands against you and demands you give him your food. Will you (a) throw his demand in his teeth and attack him, or (b) give him your food, since it is clear he is hungry?',
  'Your chief gives you a pouch of gems to take to another; he has not counted them. On the path to the other village, you find a lamed warrior who cannot hunt. He could trade you a few of your gems for food, and they will not be missed. Will you (a) deliver the gems as you were charged, or (b) give the warrior a gem?',
];
/** Which stat (0 strength, 1 dexterity, 2 intelligence) each answer feeds. */
const A = [2, 1, 1, 0, 0, 2];
const B = [0, 0, 2, 2, 1, 1];

/** The questions as asked: the first at random, the next by what the last answer fed. */
export class Intanya {
  stats: [number, number, number];
  q: number;
  asked = 0;

  constructor(private readonly rand: (lo: number, hi: number) => number) {
    this.stats = [16 + rand(0, 2), 16 + rand(0, 2), 16 + rand(0, 2)];
    this.q = rand(0, 2);
  }

  get done(): boolean {
    return this.asked >= 3;
  }

  answer(a: boolean): void {
    const stat = (a ? A : B)[this.q];
    this.stats[stat] += 3 + this.rand(0, 2);
    const ord = this.asked;
    const q = this.q;
    if (stat === 0) this.q = ord === 0 ? 2 : q === 0 ? 4 : 3;
    else if (stat === 1) this.q = ord === 0 ? 0 : q === 2 ? 4 : 5;
    else this.q = ord === 0 ? 1 : q === 0 ? 5 : 3;
    this.asked++;
  }
}

/** ending.lua's words, in order. */
export const SE_ENDING = [
  'Members of all the tribes come for the feast... the largest and most important feast ever held in the Valley of Eodon.',
  'Kurak sits beside Yolaru, Pindiro beside Barako, Haakur beside Sakkhra, and peace is sworn between the tribes.',
  'You know this peace isn\'t for you.  Soon enough, you will hear the call to action again.  But tonight, there is time for music and dance, friendship and love.',
  'At dawn, your past catches up with you... and your future beckons.  A vision of Lord British appears before you.',
  '"You have done well," he says.  "But now I must take you where you are needed.  For the sake of the friends you leave behind, I am sorry.  Prepare yourself."',
  'You say farewell to Aiela.  "Aiela does not know your world.  Take her there," she pleads.  "Teach her of your world."',
  'You shake your head.  "My world would strangle you.  You must stay.  My heart remains with you.  But my duty is elsewhere... with him."',
  'Tears roll down her cheeks.  "Abandon duty, and you will not be warrior Aiela loves.  Choose duty, and you must leave.  Either way, Aiela loses all... Farewell."',
  'You say farewell to Tristia.  "I must go with Lord British," you say.  "My duty lies with him, though it breaks my heart."',
  'Tristia laughs sweetly.  "Tristia does not mind," she says.  "Tristia has found another love: handsome Botorok.  Botorok is so much better than you.  Go with your chief.  Go."',
  'You are joined by Spector\'s former assistant, Fritz, who came out of hiding to fight the Myrmidex, and bears their scars.',
  'The moongate appears, summoned by the shade of Lord British.  Jimmy, Spector and Fritz gather their belongings...',
  'But Rafkin does not.  "I\'m staying, my friend," he says, "Someone must.  I will stay here... and hope other scientists come.  Farewell."',
  'Saddened, you follow your friends and allies into the moongate, leaving the Valley of Eodon.  Perhaps someday you will return to those you have left behind.',
];
