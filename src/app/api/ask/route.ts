import { NextResponse } from 'next/server';
import openai from '@/lib/openai';

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Prompt invalide.' }, { status: 400 });
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: "Tu es un moteur de recherche intelligent. Sois clair, précis, et trouve la meilleure réponse possible." },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
    });

    const response = completion.choices[0].message.content;
    return NextResponse.json({ result: response });
  } catch (error) {
    console.error('Erreur OpenAI :', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
