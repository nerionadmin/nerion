// lib/prompts/big_five.ts
// BFI-18 (2024) — exact item phrasing with stem ellipsis
// Format strict: "…someone who …."

export type BigFiveItem = {
  index: number;       // 1..18
  key: string;         // "q1".."q18"
  text: string;        // exact statement text (to show / send as stimulus)
  isReversed: boolean; // true for reverse-scored items
};

export const BIG_FIVE_TOTAL = 18 as const;

export const BIG_FIVE_QUESTIONS: readonly BigFiveItem[] = [
  // Extraversion (E)
  { index: 1,  key: "q1",  text: "…someone who is talkative.",                                          isReversed: false },
  { index: 2,  key: "q2",  text: "…someone who is reserved.",                                           isReversed: true  },
  { index: 3,  key: "q3",  text: "…someone who tends to be quiet.",                                     isReversed: true  },

  // Conscientiousness (C)
  { index: 4,  key: "q4",  text: "…someone who does a thorough job.",                                   isReversed: false },
  { index: 5,  key: "q5",  text: "…someone who perseveres until the task is finished.",                 isReversed: false },
  { index: 6,  key: "q6",  text: "…someone who tends to be disorganized.",                              isReversed: true  },

  // Neuroticism (N)
  { index: 7,  key: "q7",  text: "…someone who worries a lot.",                                         isReversed: false },
  { index: 8,  key: "q8",  text: "…someone who is relaxed, handles stress well.",                       isReversed: true  },
  { index: 9,  key: "q9",  text: "…someone who is emotionally stable, not easily upset.",               isReversed: true  },

  // Agreeableness (A)
  { index: 10, key: "q10", text: "…someone who has a forgiving nature.",                                isReversed: false },
  { index: 11, key: "q11", text: "…someone who is considerate and kind to almost everyone.",            isReversed: false },
  { index: 12, key: "q12", text: "…someone who likes to cooperate with others.",                        isReversed: false },

  // Openness to Experience (O)
  { index: 13, key: "q13", text: "…someone who is original, comes up with new ideas.",                  isReversed: false },
  { index: 14, key: "q14", text: "…someone who is inventive.",                                          isReversed: false },
  { index: 15, key: "q15", text: "…someone who values artistic, aesthetic experiences.",                isReversed: false },
  { index: 16, key: "q16", text: "…someone who likes to reflect, play with ideas.",                     isReversed: false },
  { index: 17, key: "q17", text: "…someone who has few artistic interests.",                            isReversed: true  },
  { index: 18, key: "q18", text: "…someone who is sophisticated in art, music, or literature.",         isReversed: false },
] as const;

// Sanity checks at module load (helps catch editing mistakes).
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

// Accessor: get the full question object (1..18).
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
