// lib/prompts/pvq_40.ts
// Portrait Values Questionnaire (PVQ-40) — masculine version
// Exact item phrasing copied verbatim from the provided PDF.
// Scoring (value → item indices) is documented in the questionnaire table.
// Note: The PVQ does not specify reverse-keyed items in this form.
// For a feminine version, replace pronouns he/him → she/her (per PDF note).

export type PvqItem = {
  index: number;       // 1..40
  key: string;         // "q1".."q40"
  text: string;        // exact statement text (to show / send as stimulus)
  isReversed: boolean; // PVQ-40: no reverse-keyed items → always false
};

export const PVQ_TOTAL = 40 as const;

export const PVQ_QUESTIONS: readonly PvqItem[] = [
  { index: 1,  key: "q1",  text: "Thinking up new ideas and being creative is important to him. He likes to do things in his own original way.", isReversed: false },
  { index: 2,  key: "q2",  text: "It is important to him to be rich. He wants to have a lot of money and expensive things.", isReversed: false },
  { index: 3,  key: "q3",  text: "He thinks it is important that every person in the world be treated equally. He believes everyone should have equal opportunities in life.", isReversed: false },
  { index: 4,  key: "q4",  text: "It’s very important to him to show his abilities. He wants people to admire what he does.", isReversed: false },
  { index: 5,  key: "q5",  text: "It is important to him to live in secure surroundings. He avoids anything that might endanger his safety.", isReversed: false },
  { index: 6,  key: "q6",  text: "He thinks it is important to do lots of different things in life. He always looks for new things to try.", isReversed: false },
  { index: 7,  key: "q7",  text: "He believes that people should do what they’re told. He thinks people should follow rules at all times‚ even when no one is watching.", isReversed: false },
  { index: 8,  key: "q8",  text: "It is important to him to listen to people who are different from him. Even when he disagrees with them‚ he still wants to understand them.", isReversed: false },
  { index: 9,  key: "q9",  text: "He thinks it’s important not to ask for more than what you have. He believes that people should be satisfied with what they have.", isReversed: false },
  { index: 10, key: "q10", text: "He seeks every chance he can to have fun. It is important to him to do things that give him pleasure.", isReversed: false },
  { index: 11, key: "q11", text: "It is important to him to make his own decisions about what he does. He likes to be free to plan and to choose his activities for himself.", isReversed: false },

  { index: 12, key: "q12", text: "It’s very important to him to help the people around him. He wants to care for their well-being.", isReversed: false },
  { index: 13, key: "q13", text: "Being very successful is important to him. He likes to impress other people.", isReversed: false },
  { index: 14, key: "q14", text: "It is very important to him that his country be safe. He thinks the state must be on watch against threats from within and without.", isReversed: false },
  { index: 15, key: "q15", text: "He likes to take risks. He is always looking for adventures.", isReversed: false },
  { index: 16, key: "q16", text: "It is important to him to always behave properly. He wants to avoid doing anything people would say is wrong.", isReversed: false },
  { index: 17, key: "q17", text: "It is important to him to be in charge and tell others what to do. He wants people to do what he says.", isReversed: false },
  { index: 18, key: "q18", text: "It is important to him to be loyal to his friends. He wants to devote himself to people close to him.", isReversed: false },
  { index: 19, key: "q19", text: "He strongly believes that people should care for nature.", isReversed: false },
  { index: 20, key: "q20", text: "Religious belief is important to him. He tries hard to do what his religion requires.", isReversed: false },
  { index: 21, key: "q21", text: "It is important to him that things be organized and clean. He really does not like things to be a mess.", isReversed: false },
  { index: 22, key: "q22", text: "He thinks it’s important to be interested in things. He likes to be curious and to try to understand all sorts of things.", isReversed: false },
  { index: 23, key: "q23", text: "He believes all the world’s people should live in harmony. Promoting peace among all groups in the world is important to him.", isReversed: false },
  { index: 24, key: "q24", text: "He thinks it is important to be ambitious. He wants to show how capable he is.", isReversed: false },
  { index: 25, key: "q25", text: "He thinks it is best to do things in traditional ways. It is important to him to keep up the customs he has learned.", isReversed: false },
  { index: 26, key: "q26", text: "Enjoying life’s pleasures is important to him. He likes to spoil himself.", isReversed: false },
  { index: 27, key: "q27", text: "It is important to him to respond to the needs of others. He tries to support those he knows.", isReversed: false },
  { index: 28, key: "q28", text: "He believes he should always show respect to his parents and to older people. It is important to him to be obedient.", isReversed: false },
  { index: 29, key: "q29", text: "He wants everyone to be treated justly‚ even people he doesn’t know. It is important to him to protect the weak in society.", isReversed: false },
  { index: 30, key: "q30", text: "He likes surprises. It is important to him to have an exciting life.", isReversed: false },

  { index: 31, key: "q31", text: "He tries hard to avoid getting sick. Staying healthy is very important to him.", isReversed: false },
  { index: 32, key: "q32", text: "Getting ahead in life is important to him. He strives to do better than others.", isReversed: false },
  { index: 33, key: "q33", text: "Forgiving people who have hurt him is important to him. He tries to see what is good in them and not to hold a grudge.", isReversed: false },
  { index: 34, key: "q34", text: "It is important to him to be independent. He likes to rely on himself.", isReversed: false },
  { index: 35, key: "q35", text: "Having a stable government is important to him. He is concerned that the social order be protected.", isReversed: false },
  { index: 36, key: "q36", text: "It is important to him to be polite to other people all the time. He tries never to disturb or irritate others.", isReversed: false },
  { index: 37, key: "q37", text: "He really wants to enjoy life. Having a good time is very important to him.", isReversed: false },
  { index: 38, key: "q38", text: "It is important to him to be humble and modest. He tries not to draw attention to himself.", isReversed: false },
  { index: 39, key: "q39", text: "He always wants to be the one who makes the decisions. He likes to be the leader.", isReversed: false },
  { index: 40, key: "q40", text: "It is important to him to adapt to nature and to fit into it. He believes that people should not change nature.", isReversed: false },
] as const;

// Sanity checks at module load (helps catch editing mistakes).
if (PVQ_QUESTIONS.length !== PVQ_TOTAL) {
  throw new Error(`pvq_40.ts → expected ${PVQ_TOTAL} questions, got ${PVQ_QUESTIONS.length}`);
}
for (let i = 0; i < PVQ_TOTAL; i++) {
  const q = PVQ_QUESTIONS[i];
  const expectedIndex = i + 1;
  const expectedKey = `q${expectedIndex}`;
  if (q.index !== expectedIndex || q.key !== expectedKey || !q.text) {
    throw new Error(`pvq_40.ts → malformed entry at position ${expectedIndex} (index/key/text mismatch)`);
  }
}

// Accessor: get the full question object (1..40).
export function getPvqQuestion(n: number): PvqItem {
  if (!Number.isInteger(n) || n < 1 || n > PVQ_TOTAL) {
    throw new Error(`pvq_40.ts → Question index out of range: ${n}`);
  }
  return PVQ_QUESTIONS[n - 1];
}

// Helper: is this the last item?
export function isLastPvqQuestion(n: number): boolean {
  return n === PVQ_TOTAL;
}
