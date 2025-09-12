// lib/prompts/ecr_r.ts
// ECR-R (Fraley, Waller, & Brennan, 2000) — 36 items; Likert 1–7
// Subscales: Anxiety (1–18), Avoidance (19–36)
// Reverse-keyed: Anxiety → 9, 11; Avoidance → 20, 22, 26–31, 33–36. Source: ECR-R questionnaire. 

export type EcrItem = {
  index: number;       // 1..36
  key: string;         // "q1".."q36"
  text: string;        // exact statement text (to show / send as stimulus)
  isReversed: boolean; // true for reverse-scored items
};

export const ECR_R_TOTAL = 36 as const;

export const ECR_R_QUESTIONS: readonly EcrItem[] = [
  // Anxiety (1–18)
  { index: 1,  key: "q1",  text: "I'm afraid that I will lose my partner's love.", isReversed: false },
  { index: 2,  key: "q2",  text: "I often worry that my partner will not want to stay with me.", isReversed: false },
  { index: 3,  key: "q3",  text: "I often worry that my partner doesn't really love me.", isReversed: false },
  { index: 4,  key: "q4",  text: "I worry that romantic partners won't care about me as much as I care about them.", isReversed: false },
  { index: 5,  key: "q5",  text: "I often wish that my partner's feelings for me were as strong as my feelings for him or her.", isReversed: false },
  { index: 6,  key: "q6",  text: "I worry a lot about my relationships.", isReversed: false },
  { index: 7,  key: "q7",  text: "When my partner is out of sight, I worry that he or she might become interested in someone else.", isReversed: false },
  { index: 8,  key: "q8",  text: "When I show my feelings for romantic partners, I'm afraid they will not feel the same about me.", isReversed: false },
  { index: 9,  key: "q9",  text: "I rarely worry about my partner leaving me.", isReversed: true  },
  { index: 10, key: "q10", text: "My romantic partner makes me doubt myself.", isReversed: false },
  { index: 11, key: "q11", text: "I do not often worry about being abandoned.", isReversed: true  },
  { index: 12, key: "q12", text: "I find that my partner(s) don't want to get as close as I would like.", isReversed: false },
  { index: 13, key: "q13", text: "Sometimes romantic partners change their feelings about me for no apparent reason.", isReversed: false },
  { index: 14, key: "q14", text: "My desire to be very close sometimes scares people away.", isReversed: false },
  { index: 15, key: "q15", text: "I'm afraid that once a romantic partner gets to know me, he or she won't like who I really am.", isReversed: false },
  { index: 16, key: "q16", text: "It makes me mad that I don't get the affection and support I need from my partner.", isReversed: false },
  { index: 17, key: "q17", text: "I worry that I won't measure up to other people.", isReversed: false },
  { index: 18, key: "q18", text: "My partner only seems to notice me when I'm angry.", isReversed: false },

  // Avoidance (19–36)
  { index: 19, key: "q19", text: "I prefer not to show a partner how I feel deep down.", isReversed: false },
  { index: 20, key: "q20", text: "I feel comfortable sharing my private thoughts and feelings with my partner.", isReversed: true  },
  { index: 21, key: "q21", text: "I find it difficult to allow myself to depend on romantic partners.", isReversed: false },
  { index: 22, key: "q22", text: "I am very comfortable being close to romantic partners.", isReversed: true  },
  { index: 23, key: "q23", text: "I don't feel comfortable opening up to romantic partners.", isReversed: false },
  { index: 24, key: "q24", text: "I prefer not to be too close to romantic partners.", isReversed: false },
  { index: 25, key: "q25", text: "I get uncomfortable when a romantic partner wants to be very close.", isReversed: false },
  { index: 26, key: "q26", text: "I find it relatively easy to get close to my partner.", isReversed: true  },
  { index: 27, key: "q27", text: "It's not difficult for me to get close to my partner.", isReversed: true  },
  { index: 28, key: "q28", text: "I usually discuss my problems and concerns with my partner.", isReversed: true  },
  { index: 29, key: "q29", text: "It helps to turn to my romantic partner in times of need.", isReversed: true  },
  { index: 30, key: "q30", text: "I tell my partner just about everything.", isReversed: true  },
  { index: 31, key: "q31", text: "I talk things over with my partner.", isReversed: true  },
  { index: 32, key: "q32", text: "I am nervous when partners get too close to me.", isReversed: false },
  { index: 33, key: "q33", text: "I feel comfortable depending on romantic partners.", isReversed: true  },
  { index: 34, key: "q34", text: "I find it easy to depend on romantic partners.", isReversed: true  },
  { index: 35, key: "q35", text: "It's easy for me to be affectionate with my partner.", isReversed: true  },
  { index: 36, key: "q36", text: "My partner really understands me and my needs.", isReversed: true  },
] as const;

// Sanity checks at module load (helps catch editing mistakes).
if (ECR_R_QUESTIONS.length !== ECR_R_TOTAL) {
  throw new Error(`ecr_r.ts → expected ${ECR_R_TOTAL} questions, got ${ECR_R_QUESTIONS.length}`);
}
for (let i = 0; i < ECR_R_TOTAL; i++) {
  const q = ECR_R_QUESTIONS[i];
  const expectedIndex = i + 1;
  const expectedKey = `q${expectedIndex}`;
  if (q.index !== expectedIndex || q.key !== expectedKey || !q.text) {
    throw new Error(`ecr_r.ts → malformed entry at position ${expectedIndex} (index/key/text mismatch)`);
  }
}

// Accessor: get the full question object (1..36).
export function getEcrRQuestion(n: number): EcrItem {
  if (!Number.isInteger(n) || n < 1 || n > ECR_R_TOTAL) {
    throw new Error(`ecr_r.ts → Question index out of range: ${n}`);
  }
  return ECR_R_QUESTIONS[n - 1];
}

// Helper: is this the last item?
export function isLastEcrRQuestion(n: number): boolean {
  return n === ECR_R_TOTAL;
}
