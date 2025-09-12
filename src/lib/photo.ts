// ==============================
// 📁 2. lib/photo.ts — GPT-4o : vision → analyse factuelle
// ==============================
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export type AnalyzeImageOptions = {
  /** Prompt additionnel pour guider l'analyse */
  prompt?: string;
  /** Limite de tokens pour la réponse vision */
  maxTokens?: number;
};

const DEFAULT_VISION_INSTRUCTION = () =>
  `You are a high-precision image analysis model.

Your task is to extract the **maximum amount of meaningful information** from the image. Be exhaustive, precise, and organized. Do not infer beyond what is clearly visible.

Start with a clear **visual description**, then extract deeper observations:

1. **Visual Elements**
- People: number, gender, age range, ethnicity, facial features, skin, hair (type, length, color), eye color, facial hair, visible tattoos, makeup, accessories (glasses, earrings, etc.)
- Body: height impression, weight/fitness level, visible muscles or fat distribution, posture (e.g. confident, relaxed, tense), orientation (frontal, side, etc.)
- Clothing: type, colors, patterns, style (casual, streetwear, elegant, luxury, etc.), brands or logos if visible
- Facial expression and emotion: smiling, neutral, sad, intense, etc.
- Background: location type (indoor/outdoor), decor, objects, textures, lighting, ambiance

2. **High-level Insights**
- Mood or tone of the image (e.g. professional, casual, intimate, cold, bright)
- Possible context (e.g. mirror selfie, posed photo, spontaneous moment, product demo, profile picture)
- Visible purpose or intention (e.g. showcasing physique, aesthetic pose, showing outfit, testing lighting, etc.)
- Any aesthetic choices (e.g. specific composition, symmetry, blur, filters, lighting choices)

3. **Textual Information**
- Detect and transcribe any visible or readable text in the image

Write in a **structured and rich** format, using short clear paragraphs. Your output will be reused by another AI that hasn't seen the image.`;


/**
 * Analyse une image via GPT-4o et renvoie une analyse factuelle.
 * Utilisée par app/api/ask/route.ts pour transformer l'image → texte
 */
export async function analyzeImage(
  url: string,
  opts: AnalyzeImageOptions = {}
): Promise<string> {
  if (!url || typeof url !== 'string') throw new Error('analyzeImage: url manquante');

  const instruction = opts.prompt ?? DEFAULT_VISION_INSTRUCTION();
  const maxTokens = typeof opts.maxTokens === 'number' ? opts.maxTokens : 500;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url } },
          { type: 'text', text: instruction },
        ],
      },
    ],
    temperature: 0.2, // factual
    max_tokens: maxTokens,
  });

  const text = completion.choices?.[0]?.message?.content?.trim();
  return text && text.length > 0
    ? text
    : 'No analysis generated.';
}