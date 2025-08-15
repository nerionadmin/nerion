import { NextResponse } from 'next/server';
import openai from '@/lib/openai';

export const maxDuration = 30; // facultatif : limite l'enregistrement à 30s

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get('audio');

    if (!audioFile || !(audioFile instanceof Blob)) {
      return NextResponse.json({ error: 'Fichier audio manquant ou invalide.' }, { status: 400 });
    }

    const buffer = Buffer.from(await audioFile.arrayBuffer());
    const file = new File([buffer], 'voice.webm', { type: 'audio/webm' });

    const transcript = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      response_format: 'json',
      language: 'fr',
    });

    return NextResponse.json({ text: transcript.text });
  } catch (err: unknown) {
    console.error('Erreur transcription :', err);
    const message = err instanceof Error ? err.message : 'Erreur de transcription';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
