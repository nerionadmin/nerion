import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { text } = await req.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Texte manquant.' }, { status: 400 });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Clé API ElevenLabs manquante.' }, { status: 500 });
    }

    const voiceId = 'EXAVITQu4vr4xnSDxMaL'; // Rachel par défaut

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json({ error }, { status: response.status });
    }

    const audioBuffer = await response.arrayBuffer();

    return new NextResponse(Buffer.from(audioBuffer), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': 'inline; filename="output.mp3"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Erreur ElevenLabs :', error);
    return NextResponse.json({ error: 'Erreur serveur ElevenLabs' }, { status: 500 });
  }
}
