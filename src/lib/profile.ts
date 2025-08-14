export type UserProfile = {
  prénom?: string;
  âge?: number;
  goûts?: string[];
  émotions?: string[];
  traits?: string[];
  croyances?: string[];
  objectifs?: string[];
  souvenirs?: string[];
  pensées?: string[];
  [key: string]: unknown; // ✅ remplacement de `any` par `unknown`
};

export function extractProfileData(prompt: string): Partial<UserProfile> {
  const extracted: Partial<UserProfile> = {};

  // Prénom
  const nameMatch = prompt.match(/je m'appelle\s+([A-Za-zÀ-ÖØ-öø-ÿ]+)/i);
  if (nameMatch) {
    extracted.prénom = nameMatch[1];
  }

  // Âge
  const ageMatch = prompt.match(/(je suis né|je suis née|je suis né\(e\)?) en (\d{4})/i);
  if (ageMatch) {
    const birthYear = parseInt(ageMatch[2], 10);
    const currentYear = new Date().getFullYear();
    const age = currentYear - birthYear;
    if (age > 0 && age < 150) {
      extracted.âge = age;
    }
  }

  // Goûts
  const goûtsMatches = [...prompt.matchAll(/j'aime\s+(l[eai]?s?)?\s*([a-zÀ-ÖØ-öø-ÿ]+)/gi)];
  if (goûtsMatches.length) {
    extracted.goûts = goûtsMatches.map((m) => m[2]);
  }

  // Émotions
  const émotionMatch = prompt.match(/je suis (triste|heureux|stressé|anxieux|déprimé|énervé|fatigué|motivé|serein|perdu|amoureux)/i);
  if (émotionMatch) {
    extracted.émotions = [émotionMatch[1]];
  }

  // Pensées profondes
  if (prompt.toLowerCase().includes("je pense que") || prompt.toLowerCase().includes("j’ai toujours pensé que")) {
    extracted.pensées = [prompt];
  }

  return extracted;
}
