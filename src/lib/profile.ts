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
  [key: string]: any;
};

export function extractProfileData(prompt: string): Partial<UserProfile> {
  const extracted: Partial<UserProfile> = {};

  // Prénom
  const nameMatch = prompt.match(/je m'appelle\s+([A-Za-zÀ-ÖØ-öø-ÿ]+)/i);
  if (nameMatch) {
    extracted.prénom = nameMatch[1];
  }

  // Âge
  const ageMatch = prompt.match(/(je suis né|je suis née|je suis né(e)?) en (\d{4})/i);
  if (ageMatch) {
    const birthYear = parseInt(ageMatch[2], 10);
    const currentYear = new Date().getFullYear();
    const age = currentYear - birthYear;
    if (age > 0 && age < 150) extracted.âge = age;
  }

  // Goûts
  if (prompt.match(/j'aime/i)) {
    const goûts = [...prompt.matchAll(/j'aime\s+(l[eai]?s?)?\s*([a-zÀ-ÖØ-öø-ÿ]+)/gi)].map((m) => m[2]);
    if (goûts.length) extracted.goûts = goûts;
  }

  // Émotions
  if (prompt.match(/je suis (triste|heureux|stressé|anxieux|déprimé|énervé|fatigué|motivé|serein|perdu|amoureux)/i)) {
    const match = prompt.match(/je suis ([a-z]+)/i);
    if (match) {
      extracted.émotions = [match[1]];
    }
  }

  // Pensées profondes
  if (prompt.toLowerCase().includes("je pense que") || prompt.toLowerCase().includes("j’ai toujours pensé que")) {
    extracted.pensées = [prompt];
  }

  return extracted;
}
