'use client';
import { Mic, Volume2, VolumeX, Upload } from 'lucide-react';
import Image from 'next/image';
import { useState, useRef, useEffect } from 'react';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

// Petit type local pour l'événement de MediaRecorder
type DataAvailableEvent = { data: Blob };

export default function Home() {
  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const USER_ID = "demo_user_1"; // provisoire

  // 📌 Charger l'historique au montage
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch(`/api/history?userId=${USER_ID}`);
        const data: { messages?: ChatMessage[] } = await res.json();
        if (res.ok && Array.isArray(data.messages)) {
          setMessages(
            data.messages.map((m: ChatMessage) =>
              m.role === "user" ? `🧠 ${m.content}` : `🤖 ${m.content}`
            )
          );
        }
      } catch (err) {
        console.error("Erreur chargement historique", err);
      }
    };
    fetchHistory();
  }, []);

  // 📌 Nouvelle fonction : upload image vers Supabase
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', USER_ID);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      const data: { url?: string } = await res.json();
      if (res.ok && data.url) {
        setMessages((prev) => [
          ...prev,
          `📷 <img src="${data.url}" alt="Image uploadée" class="max-w-full rounded-lg mt-2" />`
        ]);
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

        // ✅ éviter le non-null assertion `!`
        const replyText = data.reply;
        let i = 0;
        const interval = setInterval(() => {
          setMessages((prev) => {
            const updated = prev.slice(0, -1);
            return [...updated, '🤖 ' + replyText.slice(0, i)];
          });
          i++;
          if (i > replyText.length) clearInterval(interval);
        }, 30);

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

    try {
      const res = await fetch('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) throw new Error('Erreur API ElevenLabs');

      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      await audio.play();
    } catch (err) {
      console.error('Erreur audio :', err);
    }
  };

  const handleVoiceInput = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const audioChunks: Blob[] = [];

      setRecording(true);

      mediaRecorder.ondataavailable = (event: DataAvailableEvent) => {
        audioChunks.push(event.data);
      };

      const timeout = setTimeout(() => {
        mediaRecorder.stop();
      }, 10000);

      mediaRecorder.onstop = async () => {
        clearTimeout(timeout);
        setRecording(false);

        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', audioBlob);

        try {
          const res = await fetch('/api/transcribe', {
            method: 'POST',
            body: formData,
          });

          const data: { text?: string } = await res.json();
          if (data.text) {
            await handleSubmit(data.text);
          } else {
            setMessages((prev) => [...prev, '❌ Échec de transcription']);
          }
        } catch (err) {
          console.error('Erreur transcription', err);
          setMessages((prev) => [...prev, '⚠️ Erreur serveur transcription']);
        }
      };

      mediaRecorder.start();
    } catch (error) {
      console.error('Erreur micro', error);
      alert("Erreur lors de l'accès au micro.");
      setRecording(false);
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

  return (
    <main className="flex flex-col h-screen bg-[#0F172A] text-[#F8FAFC]">
      <header className="text-center p-4 bg-[#0F172A] border-b border-[#1E293B]">
        <div className="flex justify-center items-center">
          <Image src="/nerion.png" alt="Nerion AI Logo" width={300} height={175} priority />
        </div>
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
        <div className="w-full max-w-4xl mx-auto flex flex-wrap justify-center gap-2 gap-y-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="Pose ta question..."
            className="flex-1 min-w-[150px] w-full sm:w-auto h-14 px-4 py-3 bg-[#1E293B] text-[#F8FAFC] text-base sm:text-lg rounded-lg placeholder-[#94A3B8] shadow-inner focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          />
          <div className="flex items-center gap-2">
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
              title="Parle maintenant"
            >
              <Mic size={22} />
            </button>

            <label className="h-14 w-14 bg-[#1E293B] text-[#94A3B8] hover:bg-[#334155] rounded-lg flex items-center justify-center cursor-pointer transition" title="Uploader une image">
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
        </div>
      </footer>
    </main>
  );
}
