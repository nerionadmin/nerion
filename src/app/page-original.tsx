/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { Mic, Volume2, Upload, LogOut, Sun, Moon, Menu, X } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useTheme } from 'next-themes';
import Logo from "@/components/Logo";
import TypingDots from "../components/TypingDots";
import ReactMarkdown from "react-markdown";
import dynamic from "next/dynamic";
const AutoFaceScanner = dynamic(() => import("@/components/AutoFaceScanner"), { ssr: false });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

const safeStorage = {
  get: (k: string) => {
    try { if (typeof window === 'undefined' || !window.sessionStorage) return null; return window.sessionStorage.getItem(k); } catch { return null; }
  },
  set: (k: string, v: string) => {
    try { if (typeof window === 'undefined' || !window.sessionStorage) return; window.sessionStorage.setItem(k, v); } catch {}
  },
  remove: (k: string) => {
    try { if (typeof window === 'undefined' || !window.sessionStorage) return; window.sessionStorage.removeItem(k); } catch {}
  },
};

// Petit type local pour l'événement de MediaRecorder
type DataAvailableEvent = { data: Blob };

// ✅ Typage propre pour webkitAudioContext
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export default function Home() {
  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false); // <-- conserve l'animation (typing dots)
  const [gptBusy, setGptBusy] = useState(false); // <-- NOUVEAU: verrou global (réflexion/écriture/audio)
  const [recording, setRecording] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  // 🎛️ UI: niveau de voix (0 → 1)
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
  const [userScrolled, setUserScrolled] = useState(false);

  // 🔊 Lecture audio fiable (une seule instance)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const isSpeakingRef = useRef<boolean>(false);

  // ⛔️ Gate d’auth
  const supabase = createClientComponentClient();

  // Refs pour input texte + file
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Miniature + progression upload
  const [pendingImage, setPendingImage] = useState<{
    previewUrl: string;
    uploading: boolean;
    progress: number; // 0..100
    publicUrl?: string;
  } | null>(null);

  // Zoom modal
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);

  // ⬇️ Échange ?code=... -> session (cookies sb-...)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    if (!code) return;

    supabase.auth.exchangeCodeForSession(code)
      .then(() => {
        url.searchParams.delete("code");
        url.searchParams.delete("state");
        window.history.replaceState({}, "", url.toString());
      })
      .catch(() => {});
  }, [supabase]);

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

  // Scanner modal state + processed trigger tracking
  const [showScanner, setShowScanner] = useState(false);
  const processedScannerMsgIdxRef = useRef<Set<number>>(new Set());

  // Detect FaceScannerTrigger
  useEffect(() => {
    for (let i = 0; i < messages.length; i++) {
      const raw = messages[i];
      const isUser = raw.startsWith("🧠 ");
      const clean = raw.replace(/^(🧠|🤖)\s?/, "").trim();
      if (!isUser && /"trigger"\s*:\s*"FaceScannerTrigger"/i.test(clean)) {
        if (!processedScannerMsgIdxRef.current.has(i)) {
          processedScannerMsgIdxRef.current.add(i);
          setShowScanner(true);
          break;
        }
      }
    }
  }, [messages]);

  // Google Login
  const handleGoogleLogin = async () => {
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : undefined;

    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: origin,
        queryParams: { prompt: 'consent', access_type: 'offline' },
      },
    });
  };

  // Logout
  const handleLogout = async () => {
    try {
      await stopRecordingAndCleanup();
      await supabase.auth.signOut({ scope: 'global' });
      safeStorage.remove("chatMessages");
      setMessages([]);
      setIsAuthed(false);
      if (typeof window !== 'undefined') window.location.assign('/');
    } catch (e) {
      console.error('Erreur logout:', e);
    }
  };

  const autoResize = (el: HTMLTextAreaElement) => {
    const MIN = 40;
    const MAX = 240;
    el.style.height = 'auto';
    const needed = el.scrollHeight;
    const newH = Math.max(Math.min(needed, MAX), MIN);
    el.style.height = newH + 'px';
    el.style.overflowY = needed > MAX ? 'auto' : 'hidden';
    if (!el.value.trim()) {
      el.style.height = MIN + 'px';
      el.style.overflowY = 'hidden';
    }
  };

  const [hasSentMessage, setHasSentMessage] = useState(false);
  console.log("📦 Tous les messages stockés :", messages);

  // ------------------------
  //  Upload XHR avec progress
  // ------------------------
  const uploadImageWithProgress = async (file: File): Promise<{ publicUrl: string, filePath: string }> => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || SUPABASE_ANON_KEY; // fallback

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const filePath = `chat_images/${fileName}`;

    const endpoint = `${SUPABASE_URL}/storage/v1/object/temporary/${encodeURIComponent(filePath)}`;

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', endpoint, true);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
      xhr.setRequestHeader('x-upsert', 'false');
      if (file.type) xhr.setRequestHeader('Content-Type', file.type);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.max(0, Math.min(100, Math.round((e.loaded / e.total) * 100)));
          setPendingImage((prev) => prev ? { ...prev, progress: pct } : prev);
        }
      };

      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setPendingImage((prev) => prev ? { ...prev, progress: 100, uploading: false } : prev);
          resolve();
        } else {
          reject(new Error(`Upload error: ${xhr.status}`));
        }
      };

      xhr.send(file);
      setPendingImage((prev) => prev ? { ...prev, uploading: true, progress: 0 } : prev);
    });

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/temporary/${encodeURIComponent(filePath)}`;
    return { publicUrl, filePath };
  };

  // -------------
  //  Envoi image SEULE (bloqué si gptBusy)
  // -------------
  const sendPendingImage = async () => {
    if (gptBusy) return;
    if (!pendingImage?.publicUrl) return;

    setGptBusy(true);           // 🔒 début du call GPT
    setHasSentMessage(true);
    setUserScrolled(false);

    // Ajoute l'image côté user
    setMessages((prev) => [...prev, `🧠 ![Image](${pendingImage.publicUrl})`]);
    scrollToBottomSoon();

    // Nettoyage miniature
    if (pendingImage.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
    const imageUrlForRequest = pendingImage.publicUrl;
    setPendingImage(null);

    // Appel backend
    setLoading(true);           // conserve l'animation
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          content: [{ type: 'image_url', image_url: { url: imageUrlForRequest } }],
        }),
      });

      const data: { message?: string } = await response.json();

      if (response.ok && typeof data.message === 'string') {
        const raw = data.message ?? '';

        // Détection trigger
        if (/"trigger"\s*:\s*"FaceScannerTrigger"/i.test(raw)) {
          setShowScanner(true);
        }

        // Nettoyage + fallback
        let replyText = stripTechnicalBlocks(raw);
        if (!replyText) {
          const minimal = stripCodeFencesOnly(raw);
          if (!minimal || /"trigger"\s*:\s*"[A-Za-z0-9_]+"/i.test(minimal)) {
            setLoading(false);
            setGptBusy(false); // rien à streamer
            return;
          }
          replyText = minimal;
        }

        setMessages((prev) => [...prev, '🤖 ']);

        let i = 0;
        const interval = setInterval(() => {
          setMessages((prev) => {
            const updated = prev.slice(0, -1);
            return [...updated, '🤖 ' + replyText.slice(0, i)];
          });
          i++;
          if (i > replyText.length) {
            clearInterval(interval);
            // Fin de stream texte : libère si pas de voix
            if (!isSpeakerOn) setGptBusy(false);
            speak(replyText);
            if (!userScrolled) scrollToBottomSoon();
          }
        }, 30);

      } else {
        setMessages((prev) => [...prev, '❌ Réponse invalide']);
        setGptBusy(false);
      }
    } catch (error: unknown) {
      console.error(error);
      setMessages((prev) => [...prev, '⚠️ Une erreur est survenue']);
      setGptBusy(false);
    }
    setLoading(false);
  };

  // -------------
  //  Envoi TEXTE + IMAGE (bloqué si gptBusy)
  // -------------
  const sendImageAndText = async (overrideText?: string) => {
    if (gptBusy) return;

    const textToSend = (overrideText ?? input).trim();
    const imageUrl = pendingImage?.publicUrl;
    if (!textToSend || !imageUrl) return;

    setGptBusy(true);           // 🔒 début du call GPT
    setHasSentMessage(true);
    setUserScrolled(false);

    // Message utilisateur (texte + image)
    setMessages((prev) => [
      ...prev,
      `🧠 ${textToSend}`,
      `🧠 ![Image](${imageUrl})`
    ]);

    setInput('');
    scrollToBottomSoon();

    if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
    setPendingImage(null);

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          content: [
            { type: 'text', text: textToSend },
            { type: 'image_url', image_url: { url: imageUrl } }
          ],
        }),
      });

      const data: { message?: string } = await response.json();

      if (response.ok && typeof data.message === 'string') {
        const raw = data.message ?? '';

        if (/"trigger"\s*:\s*"FaceScannerTrigger"/i.test(raw)) {
          setShowScanner(true);
        }

        let replyText = stripTechnicalBlocks(raw);
        if (!replyText) {
          const minimal = stripCodeFencesOnly(raw);
          if (!minimal || /"trigger"\s*:\s*"[A-Za-z0-9_]+"/i.test(minimal)) {
            setLoading(false);
            setGptBusy(false);
            return;
          }
          replyText = minimal;
        }

        setMessages((prev) => [...prev, '🤖 ']);

        let i = 0;
        const interval = setInterval(() => {
          setMessages((prev) => {
            const updated = prev.slice(0, -1);
            return [...updated, '🤖 ' + replyText.slice(0, i)];
          });
          i++;
          if (i > replyText.length) {
            clearInterval(interval);
            if (!isSpeakerOn) setGptBusy(false);
            speak(replyText);
            if (!userScrolled) scrollToBottomSoon();
          }
        }, 30);

      } else {
        setMessages((prev) => [...prev, '❌ Réponse invalide']);
        setGptBusy(false);
      }
    } catch (error: unknown) {
      console.error(error);
      setMessages((prev) => [...prev, '⚠️ Une erreur est survenue']);
      setGptBusy(false);
    }
    setLoading(false);
  };

  // Utilitaire pour récupérer la dernière URL d'image déjà envoyée dans le chat si besoin
  const messagesImageUrl = (msgs: string[]) => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      const mm = m.replace(/^(🧠|🤖)\s?/, '').trim().match(/^!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)\s*$/);
      if (mm) return mm[1];
    }
    return null;
  };

  // 🧼 Double filtrage (front)
  function stripTechnicalBlocks(text: string): string {
    let cleaned = text ?? "";
    cleaned = cleaned
      .replace(/```json[\s\S]*?```/gi, "")
      .replace(/```[\s\S]*?```/gi, "");
    cleaned = cleaned
      .replace(/\{\s*"?trigger_orchestrator"?\s*:\s*true\s*\}/gi, "")
      .replace(/\{\s*"?trigger"?\s*:\s*"TriggerPhotoUserTrue"\s*\}/gi, "")
      .replace(/\{\s*"?trigger"?\s*:\s*"TriggerUserTrue"\s*\}/gi, "")
      .replace(/\{\s*"?trigger"?\s*:\s*"FaceScannerTrigger"\s*\}/gi, "");
    cleaned = cleaned
      .replace(/\{\s*"?score"?\s*:\s*\d+\s*\}/gi, "")
      .replace(/["']?score["']?\s*[:=]\s*\d+/gi, "")
      .replace(/\[\[\s*SCORE\s*=\s*\d+\s*\]\]/gi, "");
    cleaned = cleaned
      .replace(/^\s*\[STIMULUS\]\s*$/gim, "")
      .replace(/^\s*\[SYSTEM\]\s*$/gim, "")
      .replace(/^\s*\[PHOTO_PENDING\]\s*$/gim, "")
      .replace(/^\s*\[PHOTO_DONE\]\s*$/gim, "")
      .replace(/^\s*\[AUTO_CONTINUE\]\s*$/gim, "");
    return cleaned.trim();
  }

  function stripCodeFencesOnly(text: string): string {
    return (text ?? "")
      .replace(/```json[\s\S]*?```/gi, "")
      .replace(/```[\s\S]*?```/gi, "")
      .trim();
  }

  // ➕ Gestion de la capture du scanner (déclenche un call GPT → doit être bloquant via gptBusy)
  const handleScannerCapture = async ({ dataUrl, blob }: { dataUrl: string; blob: Blob }) => {
    try {
      const file = new File([blob], `scan_${Date.now()}.jpg`, { type: "image/jpeg" });

      // Ferme l’overlay caméra
      setShowScanner(false);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;

      // 🆕 Afficher la réponse du backend (phase photo_user)
      try {
        setLoading(true);
        setGptBusy(true); // 🔒 début du call GPT (kickoff)
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            assistant_message: '{"trigger":"TriggerPhotoUserTrue"}'
          }),
        });

        const kickoffJson = await res.json().catch(() => ({} as any));
        const raw = typeof kickoffJson?.message === "string" ? kickoffJson.message : "";

        if (res.ok && raw) {
          if (/"trigger"\s*:\s*"FaceScannerTrigger"/i.test(raw)) {
            setShowScanner(true);
          }

          let replyText = stripTechnicalBlocks(raw);
          if (!replyText) {
            const minimal = stripCodeFencesOnly(raw);
            if (!minimal || /"trigger"\s*:\s*"[A-Za-z0-9_]+"/i.test(minimal)) {
              setLoading(false);
              setGptBusy(false);
              // rien à afficher
            } else {
              replyText = minimal;

              setHasSentMessage(true);
              setMessages((prev) => [...prev, '🤖 ']);

              let i = 0;
              const interval = setInterval(() => {
                setMessages((prev) => {
                  const updated = prev.slice(0, -1);
                  return [...updated, '🤖 ' + replyText.slice(0, i)];
                });
                i++;
                if (i > replyText.length) {
                  clearInterval(interval);
                  if (!isSpeakerOn) setGptBusy(false);
                  speak(replyText);
                  if (!userScrolled) scrollToBottomSoon();
                }
              }, 30);
            }
          } else {
            setHasSentMessage(true);
            setMessages((prev) => [...prev, '🤖 ']);

            let i = 0;
            const interval = setInterval(() => {
              setMessages((prev) => {
                const updated = prev.slice(0, -1);
                return [...updated, '🤖 ' + replyText.slice(0, i)];
              });
              i++;
              if (i > replyText.length) {
                clearInterval(interval);
                if (!isSpeakerOn) setGptBusy(false);
                speak(replyText);
                if (!userScrolled) scrollToBottomSoon();
              }
            }, 30);
          }
        } else {
          console.error("Réponse /api/ask invalide après TriggerPhotoUserTrue:", kickoffJson);
          setGptBusy(false);
        }
      } catch (e) {
        console.error("Erreur envoi TriggerPhotoUserTrue:", e);
        setGptBusy(false);
      } finally {
        setLoading(false);
      }

      // 3) Upload de l'image dans Supabase (photo_scan)
      try {
        const uploadRes = await supabase.storage
          .from("photo_scan")
          .upload(`chat_images/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`, file, {
            upsert: true,
            contentType: "image/jpeg",
          });

        if (uploadRes.error || !uploadRes.data?.path) {
          console.error("Erreur upload photo_scan:", uploadRes.error?.message);
          alert("Erreur pendant l’envoi de la photo scan.");
          setPendingImage(null);
          return;
        }

        const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id;
        if (!userId) {
          alert("Utilisateur non authentifié.");
          setPendingImage(null);
          return;
        }

        const insertRes = await supabase
          .from("photos")
          .insert([{
            user_id: userId,
            path: uploadRes.data.path,
            photo: "scan",
            vectorized: false,
            status: "confirmed",
          }]);

        if (insertRes.error) {
          console.error("Erreur insertion dans 'photos':", insertRes.error);
          alert("Erreur lors de l'enregistrement de la photo dans la base.");
          setPendingImage(null);
          return;
        }

        // (Optionnel) URL publique
        supabase.storage.from("photo_scan").getPublicUrl(uploadRes.data.path);
      } catch (err) {
        console.error("Erreur de capture automatique (upload):", err);
        alert("Erreur pendant l’envoi de la photo scan.");
      }

      setPendingImage(null);
    } catch (err) {
      console.error("Erreur de capture automatique (scan):", err);
      alert("Erreur pendant la capture du visage.");
      setPendingImage(null);
    }
  };

  // -------------
  //  Submit texte (bloqué si gptBusy ; gère aussi le cas image+texte)
  // -------------
  const handleSubmit = async (customInput?: string) => {
    if (gptBusy) return;

    // Si une image est en attente → Enter doit envoyer l'image seule ou combinée
    if (pendingImage?.publicUrl) {
      const promptToSend = (customInput ?? input).trim();
      if (promptToSend) {
        await sendImageAndText(promptToSend);
      } else {
        await sendPendingImage();
      }
      return;
    }

    const promptToSend = (customInput ?? input).trim();
    if (!promptToSend) return;

    setGptBusy(true); // 🔒 début du call GPT
    const userMessage = `🧠 ${promptToSend}`;
    setUserScrolled(false);
    setMessages((prev) => [...prev, userMessage]);
    setHasSentMessage(true);
    setInput('');
    setLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message: promptToSend }),
      });

      const data: { message?: string } = await response.json();

      if (response.ok && typeof data.message === 'string') {
        const raw = data.message ?? '';

        if (/"trigger"\s*:\s*"FaceScannerTrigger"/i.test(raw)) {
          setShowScanner(true);
        }

        let replyText = stripTechnicalBlocks(raw);
        if (!replyText) {
          const minimal = stripCodeFencesOnly(raw);
          if (!minimal || /"trigger"\s*:\s*"[A-Za-z0-9_]+"/i.test(minimal)) {
            setLoading(false);
            setGptBusy(false);
            return;
          }
          replyText = minimal;
        }

        setMessages((prev) => [...prev, '🤖 ']);

        let i = 0;
        const interval = setInterval(() => {
          setMessages((prev) => {
            const updated = prev.slice(0, -1);
            return [...updated, '🤖 ' + replyText.slice(0, i)];
          });
          i++;
          if (i > replyText.length) {
            clearInterval(interval);
            if (!isSpeakerOn) setGptBusy(false);
            speak(replyText);
            if (!userScrolled) scrollToBottomSoon();
          }
        }, 30);

      } else {
        setMessages((prev) => [...prev, '❌ Réponse invalide']);
        setGptBusy(false);
      }
    } catch (error: unknown) {
      console.error(error);
      setMessages((prev) => [...prev, '⚠️ Une erreur est survenue']);
      setGptBusy(false);
    }

    setLoading(false);
  };

  const speak = async (text: string) => {
    if (!isSpeakerOn) return; // si pas de voix, gptBusy est libéré à la fin du stream texte
    if (!text || !text.trim()) return;

    try {
      if (!audioUnlocked) {
        unlockAudioContext();
      }

      if (currentAudioRef.current) {
        try { currentAudioRef.current.pause(); } catch {}
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
        console.error('Erreur API Voice:', await res.text().catch(() => ''));
        // Échec TTS → libère pour éviter blocage
        setGptBusy(false);
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
        setGptBusy(false); // 🔓 libération après lecture
      };

      audio.onerror = () => {
        isSpeakingRef.current = false;
        if (currentAudioRef.current === audio) {
          currentAudioRef.current = null;
        }
        setGptBusy(false); // 🔓 libérer si la lecture échoue
      };

      await audio.play().catch((e) => {
        console.error('Lecture audio bloquée/erreur:', e);
        setGptBusy(false);
      });
    } catch (err) {
      console.error('Erreur audio :', err);
      isSpeakingRef.current = false;
      setGptBusy(false);
    }
  };

  // 🔇 Coupe le micro + libère les ressources
  const stopRecordingAndCleanup = async () => {
    try {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    } catch {}
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (audioCtxRef.current) {
      try { await audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    dataArrayRef.current = null;
    userIsSpeakingRef.current = false;
    setVoiceLevel(0);
    setRecording(false);
  };

  // 🎤 Clic micro → enregistre, waveform, auto-stop quand fini de parler
  const handleVoiceInput = async () => {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

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
          const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
          const data: { text?: string } = await res.json();
          if (data.text && data.text.trim()) {
            await handleSubmit(data.text.trim()); // handleSubmit bloquera si gptBusy
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
      startVADLoop(stream);
    } catch (error) {
      console.error('Erreur micro', error);
      alert("Erreur lors de l'accès au micro.");
      setRecording(false);
    }
  };

  // 🧠 VAD simple via WebAudio
  const startVADLoop = (stream: MediaStream) => {
    const SILENCE_HOLD_MS = 2000;
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
      try { await audioCtxRef.current.close(); } catch {}
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

  // ♻️ Réhydratation messages
  useEffect(() => {
    try {
      const saved = safeStorage.get("chatMessages");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setMessages(parsed);
      }
    } catch {}
  }, []);

  // 💾 Sauvegarde + scroll
  useEffect(() => {
    try { safeStorage.set("chatMessages", JSON.stringify(messages)); } catch {}
    if (!userScrolled) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, userScrolled]);

  const scrollToBottomSoon = () => {
    if (userScrolled) return;
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
  };

  // trigger file picker
  const triggerFilePicker = () => fileInputRef.current?.click();

  // sélection fichier (images only) + miniature + upload + focus
  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert("Merci de choisir une image.");
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setPendingImage({ previewUrl, uploading: true, progress: 0 });
    scrollToBottomSoon();

    try {
      const { publicUrl } = await uploadImageWithProgress(file);
      setPendingImage((prev) => prev ? { ...prev, uploading: false, progress: 100, publicUrl } : prev);
      textAreaRef.current?.focus();
    } catch (err) {
      console.error('Upload error:', err);
      alert("Upload échoué. Merci de réessayer.");
      if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
      setPendingImage(null);
    }
  };

  // Mini composant VU-mètre
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
          stroke="var(--ring)"
          strokeWidth="1.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <style jsx>{`
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-50%) scaleY(0.9); }
            to { opacity: 1; transform: translateY(-50%) scaleY(1); }
          }
          .animate-fadeIn { animation: fadeIn 250ms ease-out forwards; }
        `}</style>
      </svg>
    );
  };

  // === Theme toggle (Sun/Moon) ===
  const { theme, setTheme } = useTheme();
  const [mountedTheme, setMountedTheme] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => setMountedTheme(true), []);

  // UI miniature
  const Miniature = () => {
    if (!pendingImage) return null;

    const R = 26;
    const C = 2 * Math.PI * R;
    const dash = C * (1 - Math.max(0, Math.min(1, pendingImage.progress / 100)));

    return (
      <div className="px-4 pt-3 text-left">
        <div className="relative inline-block">
          <img
            src={pendingImage.previewUrl}
            alt="preview"
            className="h-24 w-24 object-cover rounded-md border border-[var(--image-border)]"
          />

          {/* Croix de suppression */}
          <button
            onClick={() => {
              if (pendingImage.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
              setPendingImage(null);
              textAreaRef.current?.focus();
            }}
            className="absolute -top-2 -right-2 h-7 w-7 rounded-full bg-black text-white flex items-center justify-center shadow-md"
            aria-label="Supprimer"
            title="Supprimer"
          >
            <X size={16} />
          </button>

          {/* Anneau de progression */}
          {pendingImage.uploading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <svg width="60" height="60" viewBox="0 0 60 60">
                <circle cx="30" cy="30" r={R} stroke="rgba(0,0,0,0.2)" strokeWidth="4" fill="none" />
                <circle
                  cx="30" cy="30" r={R}
                  stroke="var(--ring)" strokeWidth="4" fill="none"
                  strokeDasharray={C}
                  strokeDashoffset={dash}
                  strokeLinecap="round"
                  style={{ transition: 'stroke-dashoffset 120ms linear' }}
                />
                <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle" fontSize="11" fill="var(--text)">
                  {Math.round(pendingImage.progress)}%
                </text>
              </svg>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <main className="flex flex-col h-[100dvh] bg-[var(--bg)] text-[var(--text)] sm:pl-14">

      {/* Barre latérale (desktop) */}
      <aside className="hidden sm:flex flex-col group fixed left-0 top-0 z-30 h-full w-[85px] hover:w-56 transition-[width] duration-200 ease-out bg-[var(--surface-2)] border-r border-[var(--border)]">
        <div className="py-3 space-y-3">
          <div className="w-[85px] flex items-center justify-center">
            <Logo symbolOnly className="h-logo-md w-auto fill-black dark:fill-white" />
          </div>
        </div>

        <div className="mt-auto w-full pb-10">
          <div className="relative w-[85px] flex justify-center mb-10">
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="flex items-center text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              title="Basculer le thème"
              aria-label="Basculer le thème"
            >
              {!mountedTheme ? (
                <span className="block h-7 w-7 opacity-0" aria-hidden="true" />
              ) : theme === 'dark' ? <Sun className="h-7 w-7" /> : <Moon className="h-7 w-7" />}
            </button>
          </div>

          <div className="relative w-[85px] flex justify-center">
            <button
              onClick={handleLogout}
              className="flex items-center text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              title="Se déconnecter"
              aria-label="Se déconnecter"
            >
              <LogOut className="h-8 w-8" />
            </button>
          </div>
        </div>
      </aside>

      {/* Header */}
      <header className="relative text-center px-4 py-6">
        <div className="flex justify-center items-center" />
        {/* 🔘 Hamburger (mobile) */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="sm:hidden absolute top-4 left-4 h-14 w-14 rounded-lg flex items-center justify-center transition bg-[var(--surface-2)] text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--surface-2)_93%,black_7%)]"
          title="Ouvrir le menu"
          aria-label="Ouvrir le menu"
        >
          <Menu size={22} />
        </button>
      </header>

      {/* Champ caché unique */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* État initial (avant 1er message) */}
      {!hasSentMessage ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 text-center max-h-[80vh]">
          <Logo className="h-logo-md w-auto mb-6 fill-black dark:fill-white" />

          <div className="w-full max-w-3xl mx-auto bg-[var(--surface-2)] rounded-xl shadow-inner grid grid-rows-[auto_auto_auto] border border-[var(--image-border)]">

            {/* Miniature upload (si présente) */}
            <Miniature />

            {/* Ligne TEXTE */}
            <div className="px-4 pt-3 relative">
              <textarea
                ref={textAreaRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); autoResize(e.currentTarget); }}
                onInput={(e) => autoResize(e.currentTarget)}
                onPaste={(e) => autoResize(e.currentTarget)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();

                    // ⛔️ Porte unique d’envoi : bloque tout si GPT est occupé
                    if (gptBusy) {
                      console.warn("⛔ GPT est occupé. Envoi bloqué.");
                      return;
                    }

                    const hasImage = !!pendingImage?.publicUrl;
                    const hasText = !!input.trim();

                    if (hasImage && hasText) {
                      await sendImageAndText();
                    } else if (hasImage) {
                      await sendPendingImage();
                    } else if (hasText) {
                      await handleSubmit();
                    }
                  }
                }}
                placeholder="Pose ta question..."
                enterKeyHint="send"
                rows={1}
                className="block w-full resize-none bg-transparent text-[var(--text)] placeholder-[var(--placeholder)] focus:outline-none text-base sm:text-lg leading-relaxed max-h-60 overflow-y-auto"
                style={{ height: 40 }}
              />
              <VoiceMeter level={voiceLevel} active={recording} />
            </div>

            {/* Ligne BOUTONS */}
            <div className="px-2 py-2 flex items-center justify-end gap-2">
              <button
                onClick={handleVoiceInput}
                className={`h-10 w-10 flex items-center justify-center rounded-lg border transition-all duration-200 ease-out ${
                  recording
                    ? 'bg-[var(--danger)] text-white border-transparent'
                    : 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--image-border)] hover:bg-[var(--hover-surface)] hover:shadow-sm'
                }`}
                aria-label="Dicter" title="Dicter"
              >
                <Mic size={20} />
              </button>

              <button
                onClick={() => { setIsSpeakerOn(!isSpeakerOn); unlockAudioContext(); }}
                className={`h-10 w-10 flex items-center justify-center rounded-lg border transition-all durée-200 ease-out bg-[var(--surface-2)] border-[var(--image-border)] hover:bg-[var(--hover-surface)] hover:shadow-sm ${isSpeakerOn ? 'text-[var(--ring)]' : 'text-[var(--text)]'}`}
                aria-label="Haut-parleur" title="Haut-parleur"
              >
                <Volume2 size={20} />
              </button>

              <button
                onClick={triggerFilePicker}
                className="h-10 w-10 flex items-center justify-center rounded-lg border transition-all durée-200 ease-out bg-[var(--surface-2)] text-[var(--text)] border-[var(--image-border)] hover:bg-[var(--hover-surface)] hover:shadow-sm"
                aria-label="Ouvrir un fichier" title="Ouvrir un fichier"
              >
                <Upload size={20} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Zone de conversation */}
          <section
            className="flex-1 overflow-y-auto px-4 py-6 sm:px-6"
            onScroll={(e) => {
              const el = e.currentTarget;
              const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
              setUserScrolled(!atBottom); // si pas en bas → on bloque l’autoscroll
            }}
          >
            <div className="flex flex-col gap-4 max-w-3xl mx-auto min-h-full">
              {messages.map((msg: string, i: number) => {
                console.log("🔁 Message brut reçu du backend :", msg);
                const isUser = msg.startsWith("🧠 ");
                const base = msg.replace(/^(🧠|🤖)\s?/, "").trim();

                // Déclencheur caméra envoyé par le backend (message IA)
                if (!isUser && /"trigger"\s*:\s*"FaceScannerTrigger"/i.test(base)) {
                  const visible = stripTechnicalBlocks(base);
                  if (!visible) return null;
                  return (
                    <div key={i} className="w-full">
                      <div className="text-[var(--text)] leading-relaxed px-1">
                        <ReactMarkdown>{visible}</ReactMarkdown>
                      </div>
                    </div>
                  );
                }

                // Image seule côté user
                const imgOnly = base.match(/^!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)\s*$/);
                if (isUser && imgOnly) {
                  const url = imgOnly[1];
                  return (
                    <div key={i} className="w-full">
                      <div className="max-w-[70%] ml-auto">
                        <img
                          src={url}
                          alt="Image"
                          className="rounded-lg max-w-full h-auto cursor-pointer border border-[var(--image-border)]"
                          onClick={() => setZoomUrl(url)}
                          onLoad={scrollToBottomSoon}
                        />
                      </div>
                    </div>
                  );
                }

                // Utilisateur : bulle à droite (texte)
                if (isUser) {
                  const cleanUser = base;
                  return (
                    <div key={i} className="w-full">
                      <div className="max-w-md ml-auto">
                        <div className="bg-[var(--surface-2)] text-[var(--text)] p-4 rounded-md break-words">
                          <ReactMarkdown>{cleanUser}</ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  );
                }

                // IA : rendu Markdown
                const safeAssistant = stripTechnicalBlocks(base);
                if (!safeAssistant) return null;

                return (
                  <div key={i} className="w-full">
                    <div className="text-[var(--text)] leading-relaxed px-1">
                      <ReactMarkdown>{safeAssistant}</ReactMarkdown>
                    </div>
                  </div>
                );
              })}

              {hasSentMessage && loading && (
                <div className="w-full">
                  <div className="max-w-3xl mx-auto">
                    <TypingDots />
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </section>

          {/* Barre d'input en bas */}
          <div className="px-4 pt-2 pb-6 sm:px-6">
            <div className="w-full max-w-3xl mx-auto bg-[var(--surface-2)] rounded-xl shadow-inner grid grid-rows-[auto_auto_auto] border border-[var(--image-border)]">

              {/* Miniature upload (si présente) */}
              <Miniature />

              {/* Ligne TEXTE */}
              <div className="px-4 pt-3 relative">
                <textarea
                  ref={textAreaRef}
                  value={input}
                  onChange={(e) => { setInput(e.target.value); autoResize(e.currentTarget); }}
                  onInput={(e) => autoResize(e.currentTarget)}
                  onPaste={(e) => autoResize(e.currentTarget)}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();

                      if (gptBusy) {
                        console.warn("⛔ GPT est occupé. Envoi bloqué.");
                        return;
                      }

                      const hasImage = !!pendingImage?.publicUrl;
                      const hasText = !!input.trim();

                      if (hasImage && hasText) {
                        await sendImageAndText();
                      } else if (hasImage) {
                        await sendPendingImage();
                      } else if (hasText) {
                        await handleSubmit();
                      }
                    }
                  }}
                  placeholder="Pose ta question..."
                  enterKeyHint="send"
                  rows={1}
                  className="block w-full resize-none bg-transparent text-[var(--text)] placeholder-[var(--placeholder)] focus:outline-none text-base sm:text-lg leading-relaxed max-h-60 overflow-y-auto"
                  style={{ height: 40 }}
                />
                <VoiceMeter level={voiceLevel} active={recording} />
              </div>

              {/* Ligne BOUTONS */}
              <div className="px-2 py-2 flex items-center justify-end gap-2">
                <button
                  onClick={handleVoiceInput}
                  className={`h-10 w-10 flex items-center justify-center rounded-lg border transition-all duration-200 ease-out ${
                    recording
                      ? 'bg-[var(--danger)] text-white border-transparent'
                      : 'bg-[var(--surface-2)] text-[var(--text)] border-[var(--image-border)] hover:bg-[var(--hover-surface)] hover:shadow-sm'
                  }`}
                  aria-label="Dicter" title="Dicter"
                >
                  <Mic size={20} />
                </button>

                <button
                  onClick={() => { setIsSpeakerOn(!isSpeakerOn); unlockAudioContext(); }}
                  className={`h-10 w-10 flex items-center justify-center rounded-lg border transition-all durée-200 ease-out bg-[var(--surface-2)] border-[var(--image-border)] hover:bg-[var(--hover-surface)] hover:shadow-sm ${isSpeakerOn ? 'text-[var(--ring)]' : 'text-[var(--text)]'}`}
                  aria-label="Haut-parleur" title="Haut-parleur"
                >
                  <Volume2 size={20} />
                </button>

                <button
                  onClick={triggerFilePicker}
                  className="h-10 w-10 flex items-center justify-center rounded-lg border transition-all durée-200 ease-out bg-[var(--surface-2)] text-[var(--text)] border-[var(--image-border)] hover:bg-[var(--hover-surface)] hover:shadow-sm"
                  aria-label="Ouvrir un fichier" title="Ouvrir un fichier"
                >
                  <Upload size={20} />
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 📸 Face Scanner Overlay */}
      {showScanner && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 backdrop-blur-sm bg-black/30" />
          <div className="relative z-10 h-full w-full flex items-center justify-center p-4">
            <div className="w-full max-w-3xl bg-[color-mix(in_srgb,var(--bg)_95%,transparent)] border border-[var(--border)] rounded-2xl shadow-2xl p-3">
              <div className="rounded-xl overflow-hidden">
                <AutoFaceScanner
                  onCapture={handleScannerCapture}
                  width={720}
                  height={540}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 🔒 Overlay d’auth */}
      {isAuthed === false && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 backdrop-blur-sm bg-black/30" />
          <div className="relative z-10 flex items-center justify-center h-full p-4">
            <div className="w-full max-w-md bg-[color-mix(in_srgb,var(--bg)_95%,transparent)] border border-[var(--border)] rounded-2xl shadow-2xl p-6 text-center">
              {!hasSentMessage && (
                <div className="flex justify-center mt-10 mb-6">
                  <Logo className="h-16 w-auto fill-black dark:fill-white" />
                </div>
              )}
              <h2 className="text-xl font-semibold mb-2">Connecte-toi pour continuer</h2>
              <p className="text-[var(--text-muted)] mb-5">
                Ton espace est prêt. Authentifie-toi avec Google pour accéder à la conversation.
              </p>
              <button
                onClick={handleGoogleLogin}
                className="w-full h-12 rounded-lg bg-[var(--surface-2)] text-[var(--text)] border border-[var(--image-border)] hover:bg-[color-mix(in_srgb,var(--surface-2)_93%,black_7%)] hover:shadow-sm transition-all durée-200 ease-out font-medium"
              >
                Se connecter avec Google
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drawer mobile */}
      {drawerOpen && (
        <div className="sm:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-[var(--scrim-40)]" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[85px] bg-[var(--surface-2)] border-r border-[var(--border)] flex flex-col">
            <div className="py-3 space-y-3">
              <div className="w-[85px] flex items-center justify-center">
                <Logo symbolOnly className="h-logo-md w-auto fill-black dark:fill-white" />
              </div>
            </div>
            <div className="mt-auto w-full pb-10">
              <div className="relative w-[85px] flex justify-center mb-10">
                <button
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="flex items-center text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                  title="Basculer le thème"
                  aria-label="Basculer le thème"
                >
                  {!mountedTheme ? <span className="block h-7 w-7 opacity-0" /> : theme === 'dark' ? <Sun className="h-7 w-7" /> : <Moon className="h-7 w-7" />}
                </button>
              </div>
              <div className="relative w-[85px] flex justify-center">
                <button
                  onClick={() => { setDrawerOpen(false); handleLogout(); }}
                  className="flex items-center text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                  title="Se déconnecter"
                  aria-label="Se déconnecter"
                >
                  <LogOut className="h-8 w-8" />
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Zoom modal */}
      {zoomUrl && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/70" onClick={() => setZoomUrl(null)} />
          <div className="relative z-10 h-full w-full flex items-center justify-center p-4">
            <img
              src={zoomUrl}
              alt="zoom"
              className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
              onLoad={scrollToBottomSoon}
            />
            <button
              onClick={() => setZoomUrl(null)}
              className="absolute top-4 right-4 h-10 w-10 rounded-full bg-black text-white flex items-center justify-center"
              aria-label="Fermer"
              title="Fermer"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
