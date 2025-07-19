'use client';
import { Mic } from 'lucide-react';
import Image from 'next/image';
import { useState, useRef, useEffect } from 'react';

export default function Home() {
  const [results, setResults] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const handleSubmit = async () => {
  if (!input.trim()) return;

  try {
    const response = await fetch('/api/ask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: input }),
    });

    const data = await response.json();

    if (data.result) {
      setResults((prev) => [...prev, `🤖 ${data.result}`]);
    } else {
      setResults((prev) => [...prev, '❌ Réponse invalide']);
    }
  } catch (error) {
    console.error('Erreur :', error);
    setResults((prev) => [...prev, '⚠️ Une erreur est survenue']);
  }

  setInput('');
};

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [results]);

  return (
    <main className="flex flex-col h-screen bg-[#0F172A] text-[#F8FAFC]">
      <header className="text-center p-4 bg-[#0F172A] border-b border-[#1E293B]">
        <div className="flex justify-center items-center">
          <Image
            src="/nerion.png"
            alt="Nerion AI Logo"
            width={300}
            height={175}
            priority
          />
        </div>
      </header>

      <section className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="flex flex-col justify-end gap-4 max-w-4xl mx-auto min-h-full">
          {results.map((res, i) => (
            <div
              key={i}
              className="w-full bg-[#1E293B] text-[#F8FAFC] p-4 rounded-md break-words"
            >
              {res}
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
              className="h-14 w-14 bg-[#1E293B] text-[#94A3B8] rounded-lg flex items-center justify-center hover:bg-[#334155] cursor-not-allowed"
              title="Commande vocale (bientôt)"
            >
              <Mic size={22} />
            </button>
            <button
              onClick={handleSubmit}
              className="h-14 px-4 sm:px-6 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-base sm:text-lg rounded-lg font-semibold transition"
            >
              Envoyer
            </button>
          </div>
        </div>
      </footer>
    </main>
  );
}
