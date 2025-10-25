// lib/prompts/deal_breaker.ts
// Deal Breakers — Minimal Prompt List v1.0
// Contient uniquement les 11 mini-prompts bruts, dans l’ordre exact.

export const DEAL_BREAKER_PROMPTS: string[] = [
  `Ask the user: "What gender should your ideal partner be?" The answer must be exactly one of: "man", "woman", "non_binary", "any".`,

  `Ask the user: "What religion should your ideal partner have?" The answer must be exactly one of: "muslim", "christian", "jewish", "hindu", "buddhist", "none", "other".`,

  `Ask the user: "Which languages must your ideal partner speak?" The answer must be an array of 1–3 items, each a capitalized language name (e.g., "English"), with no duplicates.`,

  `Ask the user: "In which countries may your ideal partner live?" The answer must be an array of country names in English Title Case, with no duplicates.`,

  `Ask the user: "Are there specific cities your ideal partner should live in?" If not important, the answer must be exactly null. Otherwise, the answer must be an array of city names in English Title Case, with no duplicates.`,

  `Ask the user: "What height do you prefer for a partner?" The answer must be exactly one of: "short", "average", "tall".`,

  `Ask the user: "What body type do you prefer for a partner?" The answer must be exactly one of: "slim", "average", "athletic", "muscular", "curvy", "broad".`,

  `Ask the user: "What is your height?" The answer must be exactly one of: "short", "average", "tall".`,

  `Ask the user: "What is your body type?" The answer must be exactly one of: "slim", "average", "athletic", "muscular", "curvy", "broad".`,

  `Ask the user: "What is your current age?" The answer must be an integer between 18 and 99 (no decimals, no text).`,

  `Ask the user: "What is your ideal partner's age range?" The answer must be either "min-max" or "min to max" with both numbers between 18 and 99.`
];
