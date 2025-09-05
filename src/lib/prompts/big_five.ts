// lib/prompts/big_five.ts
// Refactor: object-based questions with manual reverse tagging.
// - Set `isReversed: true` manually for any reverse-scored item.
// - `getBigFiveQuestion(n)` returns the full question object.
// - Only `question.text` should be sent to GPT (never the flags/metadata).

export type BigFiveItem = {
  index: number;     // 1..120
  key: string;       // "q1".."q120"
  text: string;      // question text (as shown to the user / GPT stimulus)
  isReversed: boolean; // default false; set to true manually where needed
};

export const BIG_FIVE_TOTAL = 120 as const;

export const BIG_FIVE_QUESTIONS: readonly BigFiveItem[] = [
  { index: 1, key: "q1", text: "Worry about things.", isReversed: false },
  { index: 2, key: "q2", text: "Make friends easily.", isReversed: false },
  { index: 3, key: "q3", text: "Have a vivid imagination.", isReversed: false },
  { index: 4, key: "q4", text: "Trust others.", isReversed: false },
  { index: 5, key: "q5", text: "Complete tasks successfully.", isReversed: false },
  { index: 6, key: "q6", text: "Get angry easily.", isReversed: false },
  { index: 7, key: "q7", text: "Love large parties.", isReversed: false },
  { index: 8, key: "q8", text: "Believe in the importance of art.", isReversed: false },
  { index: 9, key: "q9", text: "Use others for my own ends.", isReversed: true },
  { index: 10, key: "q10", text: "Like to tidy up.", isReversed: false },
  { index: 11, key: "q11", text: "Often feel blue.", isReversed: false },
  { index: 12, key: "q12", text: "Take charge.", isReversed: false },
  { index: 13, key: "q13", text: "Experience my emotions intensely.", isReversed: false },
  { index: 14, key: "q14", text: "Love to help others.", isReversed: false },
  { index: 15, key: "q15", text: "Keep my promises.", isReversed: false },
  { index: 16, key: "q16", text: "Find it difficult to approach others.", isReversed: false },
  { index: 17, key: "q17", text: "Am always busy.", isReversed: false },
  { index: 18, key: "q18", text: "Prefer variety to routine.", isReversed: false },
  { index: 19, key: "q19", text: "Love a good fight.", isReversed: true },
  { index: 20, key: "q20", text: "Work hard.", isReversed: false },
  { index: 21, key: "q21", text: "Go on binges.", isReversed: false },
  { index: 22, key: "q22", text: "Love excitement.", isReversed: false },
  { index: 23, key: "q23", text: "Love to read challenging material.", isReversed: false },
  { index: 24, key: "q24", text: "Believe that I am better than others.", isReversed: true },
  { index: 25, key: "q25", text: "Am always prepared.", isReversed: false },
  { index: 26, key: "q26", text: "Panic easily.", isReversed: false },
  { index: 27, key: "q27", text: "Radiate joy.", isReversed: false },
  { index: 28, key: "q28", text: "Tend to vote for liberal (progressive) political candidates.", isReversed: false },
  { index: 29, key: "q29", text: "Sympathize with the homeless.", isReversed: false },
  { index: 30, key: "q30", text: "Jump into things without thinking.", isReversed: true },
  { index: 31, key: "q31", text: "Fear for the worst.", isReversed: false },
  { index: 32, key: "q32", text: "Feel comfortable around people.", isReversed: false },
  { index: 33, key: "q33", text: "Enjoy wild flights of fantasy.", isReversed: false },
  { index: 34, key: "q34", text: "Believe that others have good intentions.", isReversed: false },
  { index: 35, key: "q35", text: "Excel in what I do.", isReversed: false },
  { index: 36, key: "q36", text: "Get irritated easily.", isReversed: false },
  { index: 37, key: "q37", text: "Talk to a lot of different people at parties.", isReversed: false },
  { index: 38, key: "q38", text: "See beauty in things that others might not notice.", isReversed: false },
  { index: 39, key: "q39", text: "Cheat to get ahead.", isReversed: true },
  { index: 40, key: "q40", text: "Often forget to put things back in their proper place.", isReversed: true },
  { index: 41, key: "q41", text: "Dislike myself.", isReversed: false },
  { index: 42, key: "q42", text: "Try to lead others.", isReversed: false },
  { index: 43, key: "q43", text: "Feel others' emotions.", isReversed: false },
  { index: 44, key: "q44", text: "Am concerned about others.", isReversed: false },
  { index: 45, key: "q45", text: "Tell the truth.", isReversed: false },
  { index: 46, key: "q46", text: "Am afraid to draw attention to myself.", isReversed: false },
  { index: 47, key: "q47", text: "Am always on the go.", isReversed: false },
  { index: 48, key: "q48", text: "Prefer to stick with things that I know.", isReversed: true },
  { index: 49, key: "q49", text: "Yell at people.", isReversed: true },
  { index: 50, key: "q50", text: "Do more than what's expected of me.", isReversed: false },
  { index: 51, key: "q51", text: "Rarely overindulge.", isReversed: true },
  { index: 52, key: "q52", text: "Seek adventure.", isReversed: false },
  { index: 53, key: "q53", text: "Avoid philosophical discussions.", isReversed: true },
  { index: 54, key: "q54", text: "Think highly of myself.", isReversed: true },
  { index: 55, key: "q55", text: "Carry out my plans.", isReversed: false },
  { index: 56, key: "q56", text: "Become overwhelmed by events.", isReversed: false },
  { index: 57, key: "q57", text: "Have a lot of fun.", isReversed: false },
  { index: 58, key: "q58", text: "Believe that there is no absolute right or wrong.", isReversed: false },
  { index: 59, key: "q59", text: "Feel sympathy for those who are worse off than myself.", isReversed: false },
  { index: 60, key: "q60", text: "Make rash decisions.", isReversed: true },
  { index: 61, key: "q61", text: "Am afraid of many things.", isReversed: false },
  { index: 62, key: "q62", text: "Avoid contact with others.", isReversed: true },
  { index: 63, key: "q63", text: "Love to daydream.", isReversed: false },
  { index: 64, key: "q64", text: "Trust what people say.", isReversed: false },
  { index: 65, key: "q65", text: "Handle tasks smoothly.", isReversed: false },
  { index: 66, key: "q66", text: "Lose my temper.", isReversed: false },
  { index: 67, key: "q67", text: "Prefer to be alone.", isReversed: true },
  { index: 68, key: "q68", text: "Do not like poetry.", isReversed: true },
  { index: 69, key: "q69", text: "Take advantage of others.", isReversed: true },
  { index: 70, key: "q70", text: "Leave a mess in my room.", isReversed: true },
  { index: 71, key: "q71", text: "Am often down in the dumps.", isReversed: false },
  { index: 72, key: "q72", text: "Take control of things.", isReversed: false },
  { index: 73, key: "q73", text: "Rarely notice my emotional reactions.", isReversed: true },
  { index: 74, key: "q74", text: "Am indifferent to the feelings of others.", isReversed: true },
  { index: 75, key: "q75", text: "Break rules.", isReversed: true },
  { index: 76, key: "q76", text: "Only feel comfortable with friends.", isReversed: false },
  { index: 77, key: "q77", text: "Do a lot in my spare time.", isReversed: false },
  { index: 78, key: "q78", text: "Dislike changes.", isReversed: true },
  { index: 79, key: "q79", text: "Insult people.", isReversed: true },
  { index: 80, key: "q80", text: "Do just enough work to get by.", isReversed: true },
  { index: 81, key: "q81", text: "Easily resist temptations.", isReversed: true },
  { index: 82, key: "q82", text: "Enjoy being reckless.", isReversed: false },
  { index: 83, key: "q83", text: "Have difficulty understanding abstract ideas.", isReversed: true },
  { index: 84, key: "q84", text: "Have a high opinion of myself.", isReversed: true },
  { index: 85, key: "q85", text: "Waste my time.", isReversed: true },
  { index: 86, key: "q86", text: "Feel that I'm unable to deal with things.", isReversed: false },
  { index: 87, key: "q87", text: "Love life.", isReversed: false },
  { index: 88, key: "q88", text: "Tend to vote for conservative political candidates.", isReversed: true },
  { index: 89, key: "q89", text: "Am not interested in other people's problems.", isReversed: true },
  { index: 90, key: "q90", text: "Rush into things.", isReversed: true },
  { index: 91, key: "q91", text: "Get stressed out easily.", isReversed: false },
  { index: 92, key: "q92", text: "Keep others at a distance.", isReversed: true },
  { index: 93, key: "q93", text: "Like to get lost in thought.", isReversed: false },
  { index: 94, key: "q94", text: "Distrust people.", isReversed: true },
  { index: 95, key: "q95", text: "Know how to get things done.", isReversed: false },
  { index: 96, key: "q96", text: "Am not easily annoyed.", isReversed: true },
  { index: 97, key: "q97", text: "Avoid crowds.", isReversed: true },
  { index: 98, key: "q98", text: "Do not enjoy going to art museums.", isReversed: true },
  { index: 99, key: "q99", text: "Obstruct others' plans.", isReversed: true },
  { index: 100, key: "q100", text: "Leave my belongings around.", isReversed: true },
  { index: 101, key: "q101", text: "Feel comfortable with myself.", isReversed: true },
  { index: 102, key: "q102", text: "Wait for others to lead the way.", isReversed: true },
  { index: 103, key: "q103", text: "Don't understand people who get emotional.", isReversed: true },
  { index: 104, key: "q104", text: "Take no time for others.", isReversed: true },
  { index: 105, key: "q105", text: "Break my promises.", isReversed: true },
  { index: 106, key: "q106", text: "Am not bothered by difficult social situations.", isReversed: true },
  { index: 107, key: "q107", text: "Like to take it easy.", isReversed: true },
  { index: 108, key: "q108", text: "Am attached to conventional ways.", isReversed: true },
  { index: 109, key: "q109", text: "Get back at others.", isReversed: true },
  { index: 110, key: "q110", text: "Put little time and effort into my work.", isReversed: true },
  { index: 111, key: "q111", text: "Am able to control my cravings.", isReversed: true },
  { index: 112, key: "q112", text: "Act wild and crazy.", isReversed: false },
  { index: 113, key: "q113", text: "Am not interested in theoretical discussions.", isReversed: true },
  { index: 114, key: "q114", text: "Boast about my virtues.", isReversed: true },
  { index: 115, key: "q115", text: "Have difficulty starting tasks.", isReversed: true },
  { index: 116, key: "q116", text: "Remain calm under pressure.", isReversed: true },
  { index: 117, key: "q117", text: "Look at the bright side of life.", isReversed: false },
  { index: 118, key: "q118", text: "Believe that we should be tough on crime.", isReversed: true },
  { index: 119, key: "q119", text: "Try not to think about the needy.", isReversed: true },
  { index: 120, key: "q120", text: "Act without thinking.", isReversed: true },
] as const;

// Sanity checks at module load (helps catch any editing mistakes).
if (BIG_FIVE_QUESTIONS.length !== BIG_FIVE_TOTAL) {
  throw new Error(`big_five.ts → expected ${BIG_FIVE_TOTAL} questions, got ${BIG_FIVE_QUESTIONS.length}`);
}
for (let i = 0; i < BIG_FIVE_TOTAL; i++) {
  const q = BIG_FIVE_QUESTIONS[i];
  const expectedIndex = i + 1;
  const expectedKey = `q${expectedIndex}`;
  if (q.index !== expectedIndex || q.key !== expectedKey || !q.text) {
    throw new Error(`big_five.ts → malformed entry at position ${expectedIndex} (index/key/text mismatch)`);
  }
}

// Accessor: get the full question object (1..120).
export function getBigFiveQuestion(n: number): BigFiveItem {
  if (!Number.isInteger(n) || n < 1 || n > BIG_FIVE_TOTAL) {
    throw new Error(`big_five.ts → Question index out of range: ${n}`);
  }
  return BIG_FIVE_QUESTIONS[n - 1];
}

// Helper: is this the last item?
export function isLastBigFiveQuestion(n: number): boolean {
  return n === BIG_FIVE_TOTAL;
}
