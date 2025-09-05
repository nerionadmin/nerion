import { NextResponse } from 'next/server';
import openai from '@/lib/openai';

export const runtime = 'nodejs';       // ✅ nécessaire pour Buffer
export const maxDuration = 30;         // limite d’exécution (optionnel)

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
    const entry = formData.get('audio');

    // ✅ Narrowing fort: on exige un Blob/File
    if (!(entry instanceof Blob)) {
      return NextResponse.json(
        { error: 'Fichier audio manquant ou invalide.' },
        { status: 400 }
      );
    }

    const audioFile = entry; // Blob typé
    const mime = audioFile.type || 'application/octet-stream';
    const ext = extFromMime(mime);

    // ⚠️ contrôle de taille
    const size = audioFile.size;
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
      language: 'fr', // ⬅️ laisse FR forcé; commente pour auto-détection
    });

    return NextResponse.json({ text: transcript.text ?? '' });
  } catch (err: unknown) {
    // ✅ Pas de any : on typage-narrow l’erreur
    const e = err as {
      response?: { data?: { error?: { message?: string } }; status?: number };
      message?: string;
      status?: number;
    };

    console.error('Erreur transcription :', e);

    const msg =
      e?.response?.data?.error?.message ||
      e?.message ||
      'Erreur de transcription';

    const status = Number(e?.status) || Number(e?.response?.status) || 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
