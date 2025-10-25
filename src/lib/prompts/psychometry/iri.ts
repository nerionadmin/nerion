// lib/prompts/iri.ts
// Interpersonal Reactivity Index (IRI) — 28 items (Davis, 1980/1983)
// Structure alignée avec tls_15.ts / cqs.ts : QUESTIONS[] + TOTAL + getQuestion + sanity check
// Barème via wrapper (0–4) ; ici uniquement les items + isReversed flag et helpers Supabase

import { SupabaseClient } from "@supabase/supabase-js";

export type IRISubscale = "PT" | "FS" | "EC" | "PD";

export type IRIItem = {
  index: number;         // 1..28
  key: `q${number}`;     // "q1".."q28"
  text: string;          // énoncé officiel
  subscale: IRISubscale; // PT | FS | EC | PD
  isReversed: boolean;   // true pour les items marqués (–) dans l’IRI
};

// --- Clés typées q1..q28 (TS-safe, plus besoin de @ts-expect-error) ---
type IRIIndex = 1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20|21|22|23|24|25|26|27|28;
type IRIKey = `q${IRIIndex}`;

export type IRIRow = {
  user_id: string;
  is_complete?: boolean;
} & Partial<Record<IRIKey, number | null | undefined>>;

export const IRI_TOTAL = 28 as const;

export const IRI_QUESTIONS: readonly IRIItem[] = [
  // q1–q7
  { index: 1,  key: "q1",  text: "I daydream and fantasize, with some regularity, about things that might happen to me.", subscale: "FS", isReversed: false },
  { index: 2,  key: "q2",  text: "I often have tender, concerned feelings for people less fortunate than me.",            subscale: "EC", isReversed: false },
  { index: 3,  key: "q3",  text: "I sometimes find it difficult to see things from the \"other guy's\" point of view.",   subscale: "PT", isReversed: true  }, // (–)
  { index: 4,  key: "q4",  text: "Sometimes I don't feel very sorry for other people when they are having problems.",     subscale: "EC", isReversed: true  }, // (–)
  { index: 5,  key: "q5",  text: "I really get involved with the feelings of the characters in a novel.",                 subscale: "FS", isReversed: false },
  { index: 6,  key: "q6",  text: "In emergency situations, I feel apprehensive and ill-at-ease.",                         subscale: "PD", isReversed: false },
  { index: 7,  key: "q7",  text: "I am usually objective when I watch a movie or play, and I don't often get completely caught up in it.", subscale: "FS", isReversed: true }, // (–)

  // q8–q14
  { index: 8,  key: "q8",  text: "I try to look at everybody's side of a disagreement before I make a decision.",         subscale: "PT", isReversed: false },
  { index: 9,  key: "q9",  text: "When I see someone being taken advantage of, I feel kind of protective towards them.",  subscale: "EC", isReversed: false },
  { index: 10, key: "q10", text: "I sometimes feel helpless when I am in the middle of a very emotional situation.",      subscale: "PD", isReversed: false },
  { index: 11, key: "q11", text: "I sometimes try to understand my friends better by imagining how things look from their perspective.", subscale: "PT", isReversed: false },
  { index: 12, key: "q12", text: "Becoming extremely involved in a good book or movie is somewhat rare for me.",          subscale: "FS", isReversed: true  }, // (–)
  { index: 13, key: "q13", text: "When I see someone get hurt, I tend to remain calm.",                                   subscale: "PD", isReversed: true  }, // (–)
  { index: 14, key: "q14", text: "Other people's misfortunes do not usually disturb me a great deal.",                    subscale: "EC", isReversed: true  }, // (–)

  // q15–q21
  { index: 15, key: "q15", text: "If I'm sure I'm right about something, I don't waste much time listening to other people's arguments.", subscale: "PT", isReversed: true }, // (–)
  { index: 16, key: "q16", text: "After seeing a play or movie, I have felt as though I were one of the characters.",     subscale: "FS", isReversed: false },
  { index: 17, key: "q17", text: "Being in a tense emotional situation scares me.",                                       subscale: "PD", isReversed: false },
  { index: 18, key: "q18", text: "When I see someone being treated unfairly, I sometimes don't feel very much pity for them.", subscale: "EC", isReversed: true }, // (–)
  { index: 19, key: "q19", text: "I am usually pretty effective in dealing with emergencies.",                            subscale: "PD", isReversed: true  }, // (–)
  { index: 20, key: "q20", text: "I am often quite touched by things that I see happen.",                                 subscale: "EC", isReversed: false },
  { index: 21, key: "q21", text: "I believe that there are two sides to every question and try to look at them both.",    subscale: "PT", isReversed: false },

  // q22–q28
  { index: 22, key: "q22", text: "I would describe myself as a pretty soft-hearted person.",                              subscale: "EC", isReversed: false },
  { index: 23, key: "q23", text: "When I watch a good movie, I can very easily put myself in the place of a leading character.", subscale: "FS", isReversed: false },
  { index: 24, key: "q24", text: "I tend to lose control during emergencies.",                                            subscale: "PD", isReversed: false },
  { index: 25, key: "q25", text: "When I'm upset at someone, I usually try to 'put myself in his shoes' for a while.",    subscale: "PT", isReversed: false },
  { index: 26, key: "q26", text: "When I am reading an interesting story or novel, I imagine how I would feel if the events in the story were happening to me.", subscale: "FS", isReversed: false },
  { index: 27, key: "q27", text: "When I see someone who badly needs help in an emergency, I go to pieces.",              subscale: "PD", isReversed: false },
  { index: 28, key: "q28", text: "Before criticizing somebody, I try to imagine how I would feel if I were in their place.", subscale: "PT", isReversed: false },
] as const;

// Accessors
export function getIRIQuestion(n: number): IRIItem {
  if (!Number.isInteger(n) || n < 1 || n > IRI_TOTAL) {
    throw new Error(`iri.ts → Question index out of range: ${n}`);
  }
  return IRI_QUESTIONS[n - 1];
}

export function isLastIRIQuestion(n: number): boolean {
  return n === IRI_TOTAL;
}

// Sanity check — garantit l’alignement index/key/texte
if (IRI_QUESTIONS.length !== IRI_TOTAL) {
  throw new Error(`iri.ts → expected ${IRI_TOTAL} items, got ${IRI_QUESTIONS.length}`);
}
for (let i = 0; i < IRI_TOTAL; i++) {
  const q = IRI_QUESTIONS[i];
  const expectedIndex = i + 1;
  const expectedKey = `q${expectedIndex}`;
  if (q.index !== expectedIndex || q.key !== expectedKey || !q.text) {
    throw new Error(`iri.ts → malformed entry at position ${expectedIndex}`);
  }
}

// ➕ Helpers Supabase (comme Big Five)
export async function ensureIRIRow(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from("iri")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) {
    await supabase.from("iri").insert({ user_id: userId });
  }
}

export async function getIRIRow(
  supabase: SupabaseClient,
  userId: string
): Promise<IRIRow | null> {
  const { data, error } = await supabase
    .from("iri")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as IRIRow) ?? null;
}

// ✅ Trouve la première question non remplie (null/undefined) — sans @ts-expect-error
export function findCurrentIndexIRI(row: IRIRow | null): number {
  for (let i = 1; i <= 28; i++) {
    const key = `q${i}` as IRIKey;
    if (!row || row[key] == null) return i;
  }
  return 29; // test terminé
}
