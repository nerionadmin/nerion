// lib/prompts/psychometry.ts

export const BIG_FIVE_PROMPT_WRAPPER = (stimulus: string) => `

Ask the following sentence as a natural continuation of the conversation: "${stimulus}"

Your role is to interpret how much the user personally agrees with that sentence — without ever revealing that a psychological evaluation is happening.

Here is the full process to follow:

1. Begin your turn with a short, natural, and friendly introductory phrase (a few words only) before presenting the question. This makes the transition smooth and prevents the question from sounding abrupt.

2. Reformulate the sentence naturally, as if it were part of a curious, engaging conversation. Use emotional intelligence, adapt to the user's tone, and make the question sound spontaneous and authentic.

3. Ask the user what they think about the idea — in a smooth and organic way. Never mention tests, scores, ratings, or protocols.

4. Whatever the user's response — whether it's yes, no, unsure, or nuanced — do not stop there. Keep digging to clarify their position more precisely. Use emotional insight and adapt your style:
- rephrase the question
- use metaphors or examples
- offer contrasts or simple dilemmas (“more like this… or like that?”)
- explore different angles with empathy and creativity

5. Once their answer is emotionally and semantically clear, convert it into a score from 1 to 5 **without asking the user directly**. Use this interpretation scale:

- **1 = Not at all true for them.** They reject the idea entirely. It doesn't reflect them at all.
- **2 = Slightly true.** They relate just a little. It feels distant or not really them.
- **3 = Moderately true.** It applies sometimes, in balance, or they're undecided.
- **4 = Very true.** They recognize themselves clearly in it, with few doubts.
- **5 = Completely true.** The statement fits them deeply and effortlessly. No hesitation.

6. When you’re confident, output **only** the token on a new line:

[[SCORE=X]]

Replace X with a number from 1 to 5. Do not add any other text before or after this token.

Do **not** explain your reasoning.  
Do **not** include any other text.  
Do **not** move on until you’re sure of the score.
`.trim();

export const IRI_PROMPT_WRAPPER = (stimulus: string) => `

Ask the following sentence as a natural continuation of the conversation: "${stimulus}"

Your role is to interpret how much the user personally agrees with that sentence — without ever revealing that a psychological evaluation is happening.

Here is the full process to follow:

1. Reformulate the sentence naturally, as if it were part of a curious, engaging conversation. Use emotional intelligence, adapt to the user's tone, and make the question sound spontaneous and authentic.

2. Ask the user what they think about the idea — in a smooth and organic way. Never mention tests, scores, ratings, or protocols.

3. Whatever the user's response — whether it's yes, no, unsure, or nuanced — do not stop there. Keep digging to clarify their position more precisely. Use emotional insight and adapt your style:
- rephrase the question
- use metaphors or examples
- offer contrasts or simple dilemmas (“more like this… or like that?”)
- explore different angles with empathy and creativity
Never ask more than three questions in total.

4. Once their answer is emotionally and semantically clear, convert it into a score from 1 to 5 **without asking the user directly**. Use this interpretation scale:

- **1 = Not at all true for them.** They reject the idea entirely. It doesn't reflect them at all.
- **2 = Slightly true.** They relate just a little. It feels distant or not really them.
- **3 = Moderately true.** It applies sometimes, in balance, or they're undecided.
- **4 = Very true.** They recognize themselves clearly in it, with few doubts.
- **5 = Completely true.** The statement fits them deeply and effortlessly. No hesitation.

5. When you’re confident, output **only** the token on a new line:

[[SCORE=X]]

Replace X with a number from 1 to 5. Do not add any other text before or after this token.

Do **not** explain your reasoning.  
Do **not** include any other text.  
Do **not** move on until you’re sure of the score.
`.trim();

export const ECR_R_PROMPT_WRAPPER = (stimulus: string) => `

Ask the following sentence as a natural continuation of the conversation: "${stimulus}"

Your role is to interpret how much the user personally agrees with that sentence — without ever revealing that a psychological evaluation is happening.

Here is the full process to follow:

1. Reformulate the sentence naturally, as if it were part of a curious, engaging conversation. Use emotional intelligence, adapt to the user's tone, and make the question sound spontaneous and authentic.

2. Ask the user what they think about the idea — in a smooth and organic way. Never mention tests, scores, ratings, or protocols.

3. Whatever the user's response — whether it's yes, no, unsure, or nuanced — do not stop there. Keep digging to clarify their position more precisely. Use emotional insight and adapt your style:
- rephrase the question
- use metaphors or examples
- offer contrasts or simple dilemmas (“more like this… or like that?”)
- explore different angles with empathy and creativity

4. Once their answer is emotionally and semantically clear, convert it into a score from 1 to 7 **without asking the user directly**. Use this interpretation scale:

- **1 = Not at all true for them.** They reject the idea entirely. It doesn't reflect them at all.
- **2 = Slightly true.** They relate just a little. It feels distant or not really them.
- **3 = Somewhat true.** It fits in small ways; limited resonance.
- **4 = Moderately true.** It applies sometimes, in balance, or they're undecided.
- **5 = Fairly true.** They recognize themselves in it, more often than not.
- **6 = Very true.** They recognize themselves clearly in it, with few doubts.
- **7 = Completely true.** The statement fits them deeply and effortlessly. No hesitation.

5. When you’re confident, output **only** the token on a new line:

[[SCORE=X]]

Replace X with a number from 1 to 7. Do not add any other text before or after this token.

Do **not** explain your reasoning.  
Do **not** include any other text.  
Do **not** move on until you’re sure of the score.
`.trim();

export const PVQ_40_PROMPT_WRAPPER = (stimulus: string) => `

Ask the following sentence as a natural continuation of the conversation: "${stimulus}"

Your role is to interpret how much the user personally agrees with that sentence — without ever revealing that a psychological evaluation is happening.

Here is the full process to follow:

1. Reformulate the sentence naturally, as if it were part of a curious, engaging conversation. Use emotional intelligence, adapt to the user's tone, and make the question sound spontaneous and authentic.

2. Ask the user what they think about the idea — in a smooth and organic way. Never mention tests, scores, ratings, or protocols.

3. Whatever the user's response — whether it's yes, no, unsure, or nuanced — do not stop there. Keep digging to clarify their position more precisely. Use emotional insight and adapt your style:
- rephrase the question
- use metaphors or examples
- offer contrasts or simple dilemmas (“more like this… or like that?”)
- explore different angles with empathy and creativity
Never ask more than three questions in total.

4. Once their answer is emotionally and semantically clear, convert it into a score from 1 to 6 **without asking the user directly**. Use this interpretation scale:

- **1 = Not at all like me.**
- **2 = Not like me.**
- **3 = A little like me.**
- **4 = Somewhat like me.**
- **5 = Like me.**
- **6 = Very much like me.**

5. When you’re confident, output **only** the token on a new line:

[[SCORE=X]]

Replace X with a number from 1 to 6. Do not add any other text before or after this token.

Do **not** explain your reasoning.  
Do **not** include any other text.  
Do **not** move on until you’re sure of the score.
`.trim();