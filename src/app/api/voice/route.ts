import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body: unknown = await req.json();
    const { text } = body as { text?: string };

    // ✅ Validation robuste
    if (!text || typeof text !== 'string' || !text.trim()) {
      return NextResponse.json({ error: 'Texte manquant.' }, { status: 400 });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Clé API ElevenLabs manquante.' }, { status: 500 });
    }

    const voiceId = 'EXAVITQu4vr4xnSDxMaL'; // Rachel par défaut

    // ✅ Timeout pour éviter les requêtes qui pendent
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s
    let response: Response;

    try {
      response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg', // ✅ s'assure qu'on reçoit bien du MP3
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text: text.trim(),
          model_id: 'eleven_multilingual_v2',
          // ✅ Format plus léger pour accélérer l’arrivée des premiers octets
          output_format: 'mp3_22050_32',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.8,
            // use_speaker_boost: true, // optionnel
          },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error('Erreur ElevenLabs upstream:', response.status, detail);
      return NextResponse.json(
        { error: 'Erreur API ElevenLabs', status: response.status, detail },
        { status: response.status }
      );
    }

    const audioBuffer = await response.arrayBuffer();

    return new NextResponse(Buffer.from(audioBuffer), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Disposition': 'inline; filename="output.mp3"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: unknown) {
    // ✅ Gestion claire d'un éventuel timeout
    if (isAbortError(error)) {
      return NextResponse.json({ error: 'Timeout API ElevenLabs' }, { status: 504 });
    }
    console.error('Erreur ElevenLabs :', error);
    return NextResponse.json({ error: 'Erreur serveur ElevenLabs' }, { status: 500 });
  }
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: string }).name === 'AbortError'
  );
}
