import { NextResponse } from 'next/server';
import openai from '@/lib/openai';
import { getMemory, setMemory } from '@/lib/upstash';

type Message = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();

    if (!prompt || typeof prompt !== 'string') {
      return NextResponse.json({ error: 'Prompt invalide.' }, { status: 400 });
    }

    // 🧠 Récupère l'historique complet depuis Upstash
    const previous = await getMemory('chat-history');
    let history: Message[] = [];

    if (previous) {
      try {
        const parsed = JSON.parse(previous);
        if (Array.isArray(parsed)) {
          history = parsed.filter(
            (msg): msg is Message =>
              msg &&
              typeof msg === 'object' &&
              typeof msg.role === 'string' &&
              typeof msg.content === 'string' &&
              ['system', 'user', 'assistant'].includes(msg.role)
          );
        } else {
          console.warn('Historique non valide, réinitialisation.');
        }
      } catch (e) {
        console.warn('Erreur de parsing, historique réinitialisé.');
      }
    }

    // 👨‍💻 Ajoute le nouveau prompt
    history.push({ role: 'user', content: prompt });

    // 🧠 Construit les messages à envoyer à OpenAI
    const messages: Message[] = [
      {
        role: 'system',
        content:
          "Tu es un miroir intelligent de l'utilisateur. Tu retiens tout ce qu’il partage de personnel (prénom, âge, goûts, émotions, souvenirs, intentions, etc.), tu t’adaptes à sa personnalité, son ton, ses croyances, son style, son humour. Ne redis jamais que tu es une IA. Parle avec naturel, chaleur ou froideur selon lui. Chaque interaction t’imprègne un peu plus de lui.",
      },
      ...history,
    ];

    // 🔍 Appel OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages,
      temperature: 0.7,
    });

    const response = completion.choices[0].message.content ?? '';

    // 💾 Sauvegarde la réponse
    history.push({ role: 'assistant', content: response });
    await setMemory('chat-history', JSON.stringify(history));

    return NextResponse.json({ result: response });
  } catch (error) {
    console.error('Erreur OpenAI :', error);
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 });
  }
}
