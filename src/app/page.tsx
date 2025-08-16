'use client';
import { Mic, Volume2, VolumeX, Upload, LogOut } from 'lucide-react';
import Image from 'next/image';
import { useState, useRef, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

// Petit type local pour l'événement de MediaRecorder
type DataAvailableEvent = { data: Blob };

// ➕ Helper pour retirer le gras Markdown (**…**)
const stripMdEmphasis = (s: string) => s.replace(/\*\*(.*?)\*\*/g, '$1');

// ✅ Typage propre pour webkitAudioContext
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export default function Home() {
  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  // 🎛️ UI: niveau de voix (0 → 1) pour afficher des vibrations dans la barre de recherche
  const [voiceLevel, setVoiceLevel] = useState(0);

  // États/refs pour la capture audio + VAD
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const userIsSpeakingRef = useRef(false);
  const lastVoiceTsRef = useRef<number>(0);

  const bottomRef = useRef<HTMLDivElement>(null);

  // 🔊 Lecture audio fiable (une seule instance)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const isSpeakingRef = useRef<boolean>(false);

  const USER_ID = 'demo_user_1'; // provisoire

  // ⛔️ Gate d’auth
  const supabase = createClientComponentClient();
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    let mounted = true;
    supabase.auth
      .getUser()
      .then(({ data }) => mounted && setIsAuthed(!!data.user))
      .catch(() => mounted && setIsAuthed(false));
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setIsAuthed(!!session?.user);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined },
    });
  };

  // ✅ LOGOUT TOUJOURS DISPONIBLE – couleurs Néryon only
  const handleLogout = async () => {
    try {
      await stopRecordingAndCleanup(); // coupe micro/lectures si besoin
      await supabase.auth.signOut();
      setIsAuthed(false);
      setMessages((prev) => [...prev, '🔒 Déconnecté.']);
    } catch (e) {
      console.error('Erreur logout:', e);
    }
  };

  // 📌 Charger l'historique au montage
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch(`/api/history?userId=${USER_ID}`);
        const data: { messages?: ChatMessage[] } = await res.json();
        if (res.ok && Array.isArray(data.messages)) {
          setMessages(
            data.messages.map((m: ChatMessage) =>
              m.role === 'user' ? `🧠 ${m.content}` : `🤖 ${m.content}`
            )
          );
        }
      } catch (err) {
        console.error('Erreur chargement historique', err);
      }
    };
    fetchHistory();
  }, []);

  // 📌 Upload image → on envoie aussi imageUrl à /api/ask (modif unique)
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', USER_ID);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data: { url?: string } = await res.json();
      if (res.ok && data.url) {
        // Affiche l’image dans la conversation (inchangé)
        setMessages((prev) => [
          ...prev,
          `📷 <img src="${data.url}" alt="Image uploadée" class="max-w-full rounded-lg mt-2" />`,
        ]);

        // ✅ Ajout: message d'attente visible pendant l'analyse
        setMessages((prev) => [...prev, '🤖 Analyse de ton image…']);

        // 🔥 Déclencher l'analyse côté /api/ask avec imageUrl
        setLoading(true);
        try {
          const askRes = await fetch('/api/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: USER_ID,
              message: '',
              imageUrl: data.url,
            }),
          });

          const askData: { reply?: string } = await askRes.json();

          if (askRes.ok && askData.reply) {
            setMessages((prev) => [...prev, '🤖 ']);
            const replyText = stripMdEmphasis(askData.reply);
            let i = 0;
            const interval = setInterval(() => {
              setMessages((prev) => {
                const updated = prev.slice(0, -1);
                return [...updated, '🤖 ' + replyText.slice(0, i)];
              });
              i++;
              if (i > replyText.length) clearInterval(interval);
            }, 30);

            await stopRecordingAndCleanup();
            speak(replyText);
          } else {
            setMessages((prev) => [...prev, '❌ Réponse invalide (analyse image)']);
          }
        } catch (e) {
          console.error('Erreur /api/ask (image):', e);
          setMessages((prev) => [...prev, '⚠️ Erreur serveur (analyse image)']);
        } finally {
          setLoading(false);
        }
      } else {
        setMessages((prev) => [...prev, '⚠️ Erreur upload image']);
      }
    } catch (err) {
      console.error('Erreur upload image', err);
      setMessages((prev) => [...prev, '⚠️ Erreur upload image']);
    }
  };

  const handleSubmit = async (customInput?: string) => {
    const promptToSend = customInput ?? input;
    if (!promptToSend.trim()) return;

    const userMessage = `🧠 ${promptToSend}`;
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER_ID, message: promptToSend }),
      });

      const data: { reply?: string } = await response.json();
      if (response.ok && data.reply) {
        setMessages((prev) => [...prev, '🤖 ']);

        const replyText = stripMdEmphasis(data.reply);
        let i = 0;
        const interval = setInterval(() => {
          setMessages((prev) => {
            const updated = prev.slice(0, -1);
            return [...updated, '🤖 ' + replyText.slice(0, i)];
          });
          i++;
          if (i > replyText.length) clearInterval(interval);
        }, 30);

        await stopRecordingAndCleanup();
        speak(replyText);
      } else {
        setMessages((prev) => [...prev, '❌ Réponse invalide']);
      }
    } catch (error: unknown) {
      console.error(error);
      setMessages((prev) => [...prev, '⚠️ Une erreur est survenue']);
    }

    setLoading(false);
  };

  const speak = async (text: string) => {
    if (!isSpeakerOn) return;
    if (!text || !text.trim()) return;

    try {
      if (!audioUnlocked) {
        unlockAudioContext();
      }

      if (currentAudioRef.current) {
        try {
          currentAudioRef.current.pause();
        } catch {
          // ignore
        }
        currentAudioRef.current.src = '';
        currentAudioRef.current = null;
      }
      if (isSpeakingRef.current) {
        isSpeakingRef.current = false;
      }

      const res = await fetch('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        console.error('Erreur API ElevenLabs:', await res.text().catch(() => ''));
        return;
      }

      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      currentAudioRef.current = audio;
      isSpeakingRef.current = true;

      audio.onended = () => {
        if (currentAudioRef.current === audio) {
          currentAudioRef.current = null;
        }
        isSpeakingRef.current = false;
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = () => {
        isSpeakingRef.current = false;
      };

      await audio.play().catch((e) => {
        // Si le navigateur bloque la lecture auto, l’utilisateur devra recliquer le bouton HP
        console.error('Lecture audio bloquée/erreur:', e);
      });
    } catch (err) {
      console.error('Erreur audio :', err);
      isSpeakingRef.current = false;
    }
  };

  // 🔇 Coupe le micro + libère les ressources (stream, AudioContext, RAF)
  const stopRecordingAndCleanup = async () => {
    try {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    } catch {
      // ignore
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    if (audioCtxRef.current) {
      try {
        await audioCtxRef.current.close();
      } catch {
        // ignore
      }
      audioCtxRef.current = null;
    }

    analyserRef.current = null;
    dataArrayRef.current = null;
    userIsSpeakingRef.current = false;
    setVoiceLevel(0);
    setRecording(false);
  };

  // 🎤 Clic micro → enregistre, waveform, auto-stop quand tu as fini de parler (silence)
  const handleVoiceInput = async () => {
    if (recording) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // 1) MediaRecorder pour capturer l'audio (envoi à /api/transcribe)
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      const audioChunks: Blob[] = [];

      mediaRecorder.ondataavailable = (event: DataAvailableEvent) => {
        if (event.data && event.data.size > 0) audioChunks.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        setRecording(false);
        await stopVADLoop();

        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', audioBlob);

        try {
          const res = await fetch('/api/transcribe', {
            method: 'POST',
            body: formData,
          });

        const data: { text?: string } = await res.json();
          if (data.text && data.text.trim()) {
            await handleSubmit(data.text.trim());
          } else {
            setMessages((prev) => [...prev, '❌ Échec de transcription']);
          }
        } catch (err) {
          console.error('Erreur transcription', err);
          setMessages((prev) => [...prev, '⚠️ Erreur serveur transcription']);
        }
      };

      mediaRecorder.start();
      setRecording(true);

      // 2) Démarrer VAD (détection de voix) pour: waveform + stopper au silence
      startVADLoop(stream);
    } catch (error) {
      console.error('Erreur micro', error);
      alert("Erreur lors de l'accès au micro.");
      setRecording(false);
    }
  };

  // 🧠 VAD simple via WebAudio (RMS) + seuil + timeout de silence
  const startVADLoop = (stream: MediaStream) => {
    const SILENCE_HOLD_MS = 600;
    const VOICE_THRESHOLD = 0.02;

    const AudioContextCtor =
      typeof window !== 'undefined'
        ? window.AudioContext || window.webkitAudioContext
        : undefined;

    if (!AudioContextCtor) {
      console.error('AudioContext non supporté.');
      return;
    }

    const audioCtx = new AudioContextCtor();
    audioCtxRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;

    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);

    analyserRef.current = analyser;
    dataArrayRef.current = dataArray;

    source.connect(analyser);

    lastVoiceTsRef.current = performance.now();

    const tick = () => {
      analyser.getByteTimeDomainData(dataArray);

      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = (dataArray[i] - 128) / 128;
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / dataArray.length);

      setVoiceLevel(Math.min(1, rms * 6));

      const now = performance.now();
      if (rms > VOICE_THRESHOLD) {
        userIsSpeakingRef.current = true;
        lastVoiceTsRef.current = now;
      } else {
        if (userIsSpeakingRef.current && now - lastVoiceTsRef.current > SILENCE_HOLD_MS) {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
          }
          return;
        }
      }

      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);
  };

  const stopVADLoop = async () => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        await audioCtxRef.current.close();
      } catch {
        // ignore
      }
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    dataArrayRef.current = null;
    userIsSpeakingRef.current = false;
    setVoiceLevel(0);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const unlockAudioContext = () => {
    if (audioUnlocked) return;

    const audio = new Audio();
    audio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';
    audio.play().catch(() => {});
    setAudioUnlocked(true);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const VoiceMeter = ({ level, active }: { level: number; active: boolean }) => {
    if (!active) return null;

    const width = 200;
    const height = 20;
    const points = Array.from({ length: width }, (_, i) => {
      const angle = (i / width) * Math.PI * 2;
      const y = Math.sin(angle + Date.now() / 180) * level * 6 + height / 2;
      return `${i},${y.toFixed(2)}`;
    }).join(' ');

    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 animate-fadeIn"
      >
        <polyline
          points={points}
          fill="none"
          stroke="#60A5FA"
          strokeWidth="1.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <style jsx>{`
          @keyframes fadeIn {
            from {
              opacity: 0;
              transform: translateY(-50%) scaleY(0.9);
            }
            to {
              opacity: 1;
              transform: translateY(-50%) scaleY(1);
            }
          }
          .animate-fadeIn {
            animation: fadeIn 250ms ease-out forwards;
          }
        `}</style>
      </svg>
    );
  };

  return (
    <main className="flex flex-col h-screen bg-[#0F172A] text-[#F8FAFC]">
      <header className="relative text-center p-4 bg-[#0F172A] border-b border-[#1E293B]">
        <div className="flex justify-center items-center">
          <Image src="/nerion.png" alt="Nerion AI Logo" width={200} height={100} priority />
        </div>

        {/* 🔘 Logout – même style que les boutons du bas */}
        <button
          onClick={handleLogout}
          className="absolute right-4 top-1/2 -translate-y-1/2 h-14 w-14 rounded-lg flex items-center justify-center transition bg-[#1E293B] text-[#94A3B8] hover:bg-[#334155]"
          title="Se déconnecter"
          aria-label="Se déconnecter"
        >
          <LogOut size={22} />
        </button>
      </header>

      <section className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="flex flex-col justify-end gap-4 max-w-4xl mx-auto min-h-full">
          {messages.map((msg: string, i: number) => (
            <div
              key={i}
              className="w-full bg-[#1E293B] text-[#F8FAFC] p-4 rounded-md break-words space-y-2"
            >
              <div dangerouslySetInnerHTML={{ __html: msg }} />
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </section>

      <footer className="px-4 py-4 sm:px-6 bg-[#0F172A] border-t border-[#1E293B]">
        <div className="w-full max-w-4xl mx-auto flex items-center gap-2">
          <div className="relative flex-grow min-w-[150px]">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="Pose ta question..."
              className="w-full h-14 px-4 pr-10 py-3 bg-[#1E293B] text-[#F8FAFC] text-base sm:text-lg rounded-lg placeholder-[#94A3B8] shadow-inner focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            />
            <VoiceMeter level={voiceLevel} active={recording} />
          </div>

          <button
            onClick={() => {
              setIsSpeakerOn(!isSpeakerOn);
              unlockAudioContext();
            }}
            className={`h-14 w-14 rounded-lg flex items-center justify-center transition ${
              isSpeakerOn
                ? 'bg-[#1E293B] text-[#3B82F6] hover:bg-[#334155]'
                : 'bg-gray-700 text-gray-400'
            }`}
            title={isSpeakerOn ? 'Désactiver la voix' : 'Activer la voix'}
          >
            {isSpeakerOn ? <Volume2 size={22} /> : <VolumeX size={22} />}
          </button>

          <button
            onClick={handleVoiceInput}
            className={`h-14 w-14 rounded-lg flex items-center justify-center transition ${
              recording ? 'bg-red-600 text-white' : 'bg-[#1E293B] text-[#94A3B8] hover:bg-[#334155]'
            }`}
            title={recording ? 'Enregistrement en cours…' : 'Parle maintenant'}
          >
            <Mic size={22} />
          </button>

          <label
            className="h-14 w-14 bg-[#1E293B] text-[#94A3B8] hover:bg-[#334155] rounded-lg flex items-center justify-center cursor-pointer transition"
            title="Uploader une image"
          >
            <Upload size={22} />
            <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
          </label>

          <button
            onClick={() => handleSubmit()}
            disabled={loading}
            className="h-14 w-[120px] bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-base sm:text-lg rounded-lg font-semibold transition flex items-center justify-center"
          >
            {loading ? (
              <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              'Envoyer'
            )}
          </button>
        </div>
      </footer>

      {/* 🔒 Overlay d’auth grisé (pas flouté). Bloque l’UI tant que non connecté. */}
      {isAuthed === false && (
        <div className="fixed inset-0 z-50">
          {/* voile gris */}
          <div className="absolute inset-0 bg-black/60" />
          {/* carte centrale */}
          <div className="relative z-10 flex items-center justify-center h-full p-4">
            <div className="w-full max-w-md bg-[#0F172A]/95 border border-[#1E293B] rounded-2xl shadow-2xl p-6 text-center">
              <div className="flex justify-center mb-4">
                <Image src="/nerion.png" alt="Nerion" width={200} height={100} priority />
              </div>
              <h2 className="text-xl font-semibold mb-2">Connecte-toi pour continuer</h2>
              <p className="text-[#94A3B8] mb-5">
                Ton espace est prêt. Authentifie-toi avec Google pour accéder à la conversation.
              </p>
              <button
                onClick={handleGoogleLogin}
                className="w-full h-12 rounded-lg bg-white/10 hover:bg-white/15 border border-[#334155] transition font-medium"
              >
                Se connecter avec Google
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
