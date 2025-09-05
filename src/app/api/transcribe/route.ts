import { NextResponse } from 'next/server';
import openai from '@/lib/openai';

export const runtime = 'nodejs';       // ✅ obligatoire pour Buffer
export const maxDuration = 30;         // limite exécution (facultatif)

// Limite prudente pour Whisper (≈25MB)
const MAX_BYTES = 25 * 1024 * 1024;

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('x-m4a')) return 'm4a';
  if (m.includes('m4a')) return 'm4a';
  if (m.includes('wav')) return 'wav';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mpeg')) return 'mp3';
  if (m.includes('aac')) return 'aac';
  return 'bin';
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get('audio');

    if (!audioFile || !(audioFile instanceof Blob)) {
      return NextResponse.json(
        { error: 'Fichier audio manquant ou invalide.' },
        { status: 400 }
      );
    }

    const mime = (audioFile as any).type || 'application/octet-stream';
    const ext = extFromMime(mime);

    // ⚠️ contrôle de taille
    const size = (audioFile as Blob).size;
    if (size > MAX_BYTES) {
      return NextResponse.json(
        { error: `Fichier trop volumineux (${(size / 1024 / 1024).toFixed(1)}MB). Max ≈ 25MB.` },
        { status: 413 }
      );
    }

    // On garde le VRAI type & extension pour Whisper
    const buffer = Buffer.from(await audioFile.arrayBuffer());
    const file = new File([buffer], `voice.${ext}`, { type: mime });

    const transcript = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      response_format: 'json',
      language: 'fr', // ⬅️ laisse FR forcé, commente si tu veux auto-détection
    });

    return NextResponse.json({ text: transcript.text ?? '' });
  } catch (err: any) {
    console.error('Erreur transcription :', err);
    const msg =
      err?.response?.data?.error?.message ||
      err?.message ||
      'Erreur de transcription';
    const status = Number(err?.status) || Number(err?.response?.status) || 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
