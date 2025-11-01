/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, CSSProperties } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useTheme } from 'next-themes';
import { Sun,
  Moon,
  LogOut,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  Settings as SettingsIcon,
  HelpCircle,
  X } from 'lucide-react';
import { Range, getTrackBackground } from 'react-range';
import Logo from '@/components/Logo';
import FaceScanVisual from '@/components/FaceScanVisual';
// --- Nouveaux imports pour les deux scanners ---
import dynamic from 'next/dynamic';
import PhoneInput, { isValidPhoneNumber, type Country } from 'react-phone-number-input';
import { getCountryCallingCode } from 'libphonenumber-js';
import type React from 'react';

const AutoFaceScannerLandscape = dynamic(
  () => import('@/components/AutoFaceScanner'),
  { ssr: false }
);
const AutoFaceScannerPortrait = dynamic(
  () => import('@/components/AutoFaceScannerPortrait'),
  { ssr: false }
);

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10; // +10
type RelationshipChoice = 'serious' | 'open' | 'casual';
type ScanStatus = 'idle' | 'pending' | 'confirmed' | 'rejected' | 'timeout';
type UploadStatus = 'idle' | 'uploading' | 'confirmed' | 'rejected' | 'duplicate' | 'timeout' | 'deleted';

type PhotoItem = {
  id: string;              // local UI id
  dbId?: string;           // id de la ligne 'photos' en base (pour Realtime & polling)
  url: string;
  progress: number;        // 0..100 (simulé)
  status: UploadStatus;
};

export default function OnboardingFlowTest() {
  const supabase = createClientComponentClient();
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);
  // === phone login toggle ===
  const [showPhoneLogin, setShowPhoneLogin] = useState(false);
  // === Phone OTP login ===
const [phone, setPhone] = useState('');
const [otp, setOtp] = useState('');
const [otpSent, setOtpSent] = useState(false);
const [loadingOtp, setLoadingOtp] = useState(false);
const [otpError, setOtpError] = useState<string | null>(null);
// Auto‑détection du pays (2 lettres : "US", "FR", …)
const [detectedCountry, setDetectedCountry] = useState<Country | undefined>(undefined);

useEffect(() => {
  let alive = true;
  (async () => {
    try {
      const res = await fetch('https://ipapi.co/json/');
      const data: { country_code?: string } = await res.json();
      if (alive && data?.country_code) {
        // ipapi renvoie déjà "US", "FR", … (majuscules)
        setDetectedCountry(data.country_code as Country);
      }
    } catch {
      // pas grave : on laisse undefined, le composant fonctionne quand même
    }
  })();
  return () => { alive = false; };
}, []);

// Send OTP via Supabase
const sendOtp = async () => {
  try {
    setLoadingOtp(true);
    setOtpError(null);
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) throw error;
    setOtpSent(true);
  } catch (err: any) {
    setOtpError(err.message || 'Failed to send code.');
  } finally {
    setLoadingOtp(false);
  }
};

// Verify OTP code
const verifyOtp = async () => {
  try {
    setLoadingOtp(true);
    setOtpError(null);
    const { error } = await supabase.auth.verifyOtp({
      phone,
      token: otp,
      type: 'sms',
    });
    if (error) throw error;
    setShowPhoneLogin(false);
    setIsAuthed(true);
  } catch (err: any) {
    setOtpError(err.message || 'Invalid code. Please try again.');
  } finally {
    setLoadingOtp(false);
  }
};

  const [initialBirthdateFetched, setInitialBirthdateFetched] = useState(false);
  // 🪩 Zoom sur photo (modale)
  const [zoomedPhoto, setZoomedPhoto] = useState<string | null>(null);


  // === Steps ===
  // Auth (avant tout) • 1: DOB • 2: orientation • 3: age range • 4: distance • 5: relationship type • 6: scan info • 7: (capture) • 8: (upload 6 photos - self) • 9: (upload 6 photos - preference) • 10: page vide avec symbole
  const [step, setStep] = useState<Step>(1);
  // Persisted step index loading flag
  const [stepLoaded, setStepLoaded] = useState(false);

  // Helper to change step and persist it to backend
  async function goToStep(n: Step) {
    setStep(n);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      await fetch('/api/ask', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ step_index: n }),
      });
    } catch {}
  }


  // Status du flux de scan (étape 7)
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
  // --- Orientation de l’écran ---
const [isPortrait, setIsPortrait] = useState<boolean | null>(null);

useEffect(() => {
  const mq = window.matchMedia('(orientation: portrait)');
  const update = () => setIsPortrait(mq.matches);
  update();

  mq.addEventListener?.('change', update);
  (mq as any).addListener?.(update); // fallback anciens navigateurs

  return () => {
    mq.removeEventListener?.('change', update);
    (mq as any).removeListener?.(update);
  };
}, []);

  const [currentPhotoId, setCurrentPhotoId] = useState<string | null>(null);

  // -------- Settings modal (step 10 only) --------
  const postOnboarding = step === 10;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'orientation' | 'age' | 'distance' | 'relationship' | 'photos' | 'preferences'>('orientation');
  const [modalDirty, setModalDirty] = useState(false);
// === Test bubble when match is inserted in Supabase
const [showMatchTestBubble, setShowMatchTestBubble] = useState(false);
const [showConfirmDismiss, setShowConfirmDismiss] = useState(false);
const [confirmButtonState, setConfirmButtonState] = useState<'idle' | 'waiting' | 'rejected' | 'confirmed'>('idle');
// état par match (clé = match.id)
const [confirmButtonStates, setConfirmButtonStates] = useState<Record<string, 'idle' | 'waiting' | 'rejected' | 'confirmed'>>({});

// helper: lire l'état du bouton pour un match donné
const getConfirmStateForMatch = (id?: string | null) => {
  if (!id) return 'idle';
  return confirmButtonStates[id] ?? 'idle';
};

// === Badge "Confirmed" au-dessus de la pastille profil ===
const [showConfirmedMatchBubble, setShowConfirmedMatchBubble] = useState(false);
const [matchInitials, setMatchInitials] = useState<string | null>(null);
// 🖼️ Galerie du match confirmé (plein écran)
const [showMatchGallery, setShowMatchGallery] = useState(false);
const [matchModalTab, setMatchModalTab] = useState<'gallery' | 'details' | 'chat'>('gallery');
// URLs signées des 6 photos du match (servies par le backend)
const [matchPhotos, setMatchPhotos] = useState<string[]>([]);
// Index de la photo affichée (0..5)
const [currentMatchPhoto, setCurrentMatchPhoto] = useState(0);
// 💬 Chat (modal → Chat tab)

// --- Live typing indicator (broadcast) ---
const [otherTyping, setOtherTyping] = useState(false);
const typingChannelRef = useRef<any>(null);
const typingHideTimerRef = useRef<any>(null);
const lastTypingSentRef = useRef<number>(0);
type ChatMessage = { id: string; sender_id: string; body: string; created_at: string };

const [chatReady, setChatReady] = useState(false);
const [chatMatchId, setChatMatchId] = useState<string | null>(null);
const [chatOtherId, setChatOtherId] = useState<string | null>(null);
const [chatMeId, setChatMeId] = useState<string | null>(null);
const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
const [chatInput, setChatInput] = useState('');
const [chatBooting, setChatBooting] = useState(false);
const [chatSending, setChatSending] = useState(false);
const [chatError, setChatError] = useState<string | null>(null);
const chatListRef = useRef<HTMLDivElement | null>(null);
const chatChannelRef = useRef<any>(null);
// ✅ Fix: declare latestMatch before useEffect
const [latestMatch, setLatestMatch] = useState<MatchInfo | null>(null);
// === MULTI-MATCH ===
const [matchesQueue, setMatchesQueue] = useState<any[]>([]);
const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
// Seed initial des matches (en cas de reload, pas d'INSERT Realtime)
useEffect(() => {
  if (!isAuthed || !postOnboarding) return;

  (async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Récupère les derniers matches (tu peux monter le limit si besoin)
      const { data, error } = await supabase
        .from('matches')
        .select('id, user_id, match_user_id, status, match, match_initials, match_gender, match_age, distance_km, score_pref_to_self, created_at')
        .eq('user_id', user.id)
        .neq('status', 'deleted')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error || !Array.isArray(data)) return;

      // Filtre les doublons si Realtime a déjà poussé des lignes
      setMatchesQueue(prev => {
        const seen = new Set(prev.map(m => m?.id));
        const merged = [...data.filter(r => !seen.has(r.id)), ...prev];
        return merged;
      });

      // Alimente le cercle si rien n’est encore chargé
      setLatestMatch(prev => {
        if (prev || data.length === 0) return prev;
        const r = data[0];
        return {
          match_user_id: r.match_user_id ?? null,
          match_gender: r.match_gender ?? null,
          match_age: r.match_age != null ? Number(r.match_age) : null,
          distance_kilometre: r.distance_km != null ? Number(r.distance_km) : null,
          score_pref_to_self: r.score_pref_to_self != null ? Number(r.score_pref_to_self) : null,
        };
      });

      // Mets à niveau l’état du bouton pour chacune des lignes
      setConfirmButtonStates(prev => {
        const next = { ...prev };
        for (const r of data) {
          const id = String(r.id);
          if (r.match === true) next[id] = 'confirmed';
          else if (String(r.status).toLowerCase() === 'confirmed') next[id] = 'waiting';
          else if (String(r.status).toLowerCase() === 'rejected') next[id] = 'rejected';
          else next[id] = 'idle';
        }
        return next;
      });
    } catch {}
  })();
}, [isAuthed, postOnboarding, supabase]);

// ➜ Une pastille au-dessus de l’avatar UNIQUEMENT quand le match est mutuel
const confirmedMatches = useMemo(
  () => matchesQueue.filter((m: any) => m?.match === true),
  [matchesQueue]
);

// Quand on change de match (ou que la file évolue), on alimente le cercle avec le match courant
useEffect(() => {
  const r = matchesQueue[currentMatchIndex];
  if (!r) return;
  setLatestMatch({
    match_user_id: r.match_user_id ?? null,
    match_gender: r.match_gender ?? null,
    match_age: r.match_age != null ? Number(r.match_age) : null,
    // la DB envoie distance_km → on met dans ton state distance_kilometre
    distance_kilometre: r.distance_km != null ? Number(r.distance_km) : null,
    score_pref_to_self: r.score_pref_to_self != null ? Number(r.score_pref_to_self) : null,
  });
}, [matchesQueue, currentMatchIndex]);
// ➜ Aligner l'état du bouton sur la DB pour le match AFFICHÉ
useEffect(() => {
  if (!postOnboarding || !isAuthed) return;

  const current = matchesQueue[currentMatchIndex];
  if (!current?.id) return;

  (async () => {
    try {
      const { data, error } = await supabase
        .from('matches')
        .select('status, match')
        .eq('id', current.id)
        .maybeSingle();

      if (error || !data) return;

      const id = String(current.id);
      const s = String(data.status || '').toLowerCase();

      if (data.match === true) {
        setConfirmButtonStates(prev => ({ ...prev, [id]: 'confirmed' }));
      } else if (s === 'confirmed') {
        setConfirmButtonStates(prev => ({ ...prev, [id]: 'waiting' }));
      } else if (s === 'rejected') {
        setConfirmButtonStates(prev => ({ ...prev, [id]: 'rejected' }));
      } else {
        setConfirmButtonStates(prev => ({ ...prev, [id]: 'idle' }));
      }
    } catch {}
  })();
}, [postOnboarding, isAuthed, currentMatchIndex, matchesQueue, supabase]);

// Bootstrap chat when modal is open on "chat" tab

// Realtime typing channel (broadcast)
useEffect(() => {
  if (!(showMatchGallery && matchModalTab === 'chat' && chatReady && chatMeId && chatOtherId)) {
    // cleanup if exists
    if (typingChannelRef.current) {
      try { supabase.removeChannel(typingChannelRef.current); } catch {}
      typingChannelRef.current = null;
    }
    return;
  }

  (async () => {
    try {
      const a = chatMeId < chatOtherId ? chatMeId : chatOtherId;
      const b = chatMeId < chatOtherId ? chatOtherId : chatMeId;

      // Remove previous channel if any
      if (typingChannelRef.current) {
        try { supabase.removeChannel(typingChannelRef.current); } catch {}
        typingChannelRef.current = null;
      }

      const ch = supabase
        .channel(`typing-${a}-${b}`, { config: { broadcast: { ack: false }}})
        .on('broadcast', { event: 'typing' }, (payload: any) => {
          const from = payload?.payload?.sender_id;
          if (!from || from === chatMeId) return;
          // show indicator for ~2.2s
          setOtherTyping(true);
          if (typingHideTimerRef.current) clearTimeout(typingHideTimerRef.current);
          typingHideTimerRef.current = setTimeout(() => setOtherTyping(false), 2200);
        })
        .subscribe();

      typingChannelRef.current = ch;
    } catch {}
  })();

  return () => {
    if (typingChannelRef.current) {
      try { supabase.removeChannel(typingChannelRef.current); } catch {}
      typingChannelRef.current = null;
    }
  };
}, [showMatchGallery, matchModalTab, chatReady, chatMeId, chatOtherId, supabase]);

// Mark messages as read when viewing the chat
useEffect(() => {
  if (!(chatReady && chatMatchId && showMatchGallery && matchModalTab === 'chat')) return;
  (async () => {
    try {
      await supabase.rpc('chat_mark_read', { p_match_id: chatMatchId, p_at: new Date().toISOString() });
    } catch {}
  })();
}, [chatReady, chatMatchId, showMatchGallery, matchModalTab, chatMessages, supabase]);

useEffect(() => {
  if (!(showMatchGallery && matchModalTab === 'chat' && isAuthed)) return;

  setChatError(null);
  setChatBooting(true);

  (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const me = session?.user;
      if (!me) { setChatReady(false); setChatBooting(false); return; }
      setChatMeId(me.id);

      // Determine the other user id
      let otherId = latestMatch?.match_user_id ?? null;
      if (!otherId) {
        const { data: last } = await supabase
          .from('matches')
          .select('match_user_id')
          .eq('user_id', me.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        otherId = last?.match_user_id ?? null;
      }
      if (!otherId) { setChatReady(false); setChatBooting(false); return; }
      setChatOtherId(otherId);

      // Mirror + confirmed check on the frontend (defense-in-depth; SQL also checks it)
      const { data: rows, error: mirrorErr } = await supabase
        .from('matches')
        .select('id, user_id, match_user_id, status')
        .or(
          `and(user_id.eq.${me.id},match_user_id.eq.${otherId}),` +
          `and(user_id.eq.${otherId},match_user_id.eq.${me.id})`
        );

      if (mirrorErr) throw mirrorErr;

      const mine  = rows?.find((r: any) => r.user_id === me.id      && r.match_user_id === otherId);
      const other = rows?.find((r: any) => r.user_id === otherId     && r.match_user_id === me.id);

      if (!mine || !other || mine.status !== 'confirmed' || other.status !== 'confirmed') {
        setChatReady(false);
        setChatBooting(false);
        return;
      }
      setChatReady(true);
      setChatMatchId(String(mine.id));

      // Load latest messages via RPC (returns newest first per SQL; we reverse for chronological)
      const { data: list, error: listErr } = await supabase.rpc('chat_list', {
        p_match_id: mine.id,
        p_limit: 50,
        p_before: null,
      });
      if (listErr) throw listErr;

      const ordered = Array.isArray(list) ? list.slice().reverse() : [];
      const mapped: ChatMessage[] = ordered.map((row: any) => ({
        id: String(row.id),
        sender_id: String(row.sender_id),
        body: String(row.body ?? ''),
        created_at: row.created_at,
      }));
      setChatMessages(mapped);

      // Setup realtime on INSERT for this pair (user_a is the smaller uuid)
      const a = me.id < otherId ? me.id : otherId;
      const b = me.id < otherId ? otherId : me.id;

      if (chatChannelRef.current) {
        try { supabase.removeChannel(chatChannelRef.current); } catch {}
        chatChannelRef.current = null;
      }

      const ch = supabase
        .channel(`chat-${a}-${b}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `user_a=eq.${a}` },
          (payload: any) => {
            const row = payload?.new;
            if (!row || row.user_b !== b) return;
            const m: ChatMessage = { id: String(row.id), sender_id: String(row.sender_id), body: String(row.body ?? ''), created_at: row.created_at };
            setChatMessages((prev) => (prev.some(x => x.id === m.id) ? prev : [...prev, m]));
            requestAnimationFrame(() => {
              const el = chatListRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            });
          }
        )
        .subscribe();
      chatChannelRef.current = ch;

      // Scroll to bottom after initial load
      requestAnimationFrame(() => {
        const el = chatListRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    } catch (err) {
      console.error('💥 Chat bootstrap error:', err);
      setChatError('Failed to load chat.');
      setChatReady(false);
    } finally {
      setChatBooting(false);
    }
  })();

  return () => {
    if (chatChannelRef.current) {
      try { supabase.removeChannel(chatChannelRef.current); } catch {}
      chatChannelRef.current = null;
    }
  };
}, [showMatchGallery, matchModalTab, isAuthed, supabase, latestMatch]);

// Send message helper
async function sendChat() {
  const text = chatInput.trim();
  if (!text || chatSending || !chatMatchId) return;
  try {
    setChatSending(true);
    const { data, error } = await supabase.rpc('chat_send', {
      p_match_id: chatMatchId,
      p_body: text,
    });
    if (error) throw error;

    setChatInput('');
    if (data && data.id) {
      const m: ChatMessage = {
        id: String(data.id),
        sender_id: String(data.sender_id),
        body: String(data.body ?? ''),
        created_at: data.created_at,
      };
      setChatMessages((prev) => (prev.some(x => x.id === m.id) ? prev : [...prev, m]));
      requestAnimationFrame(() => {
        const el = chatListRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  } catch (err) {
    console.error('💥 Failed to send message:', err);
    setChatError('Failed to send message.');
  } finally {
    setChatSending(false);
  }
}

// Broadcast "typing" with a small throttle to avoid spamming
function emitTyping() {
  try {
    const now = Date.now();
    if (!typingChannelRef.current || !chatMeId) return;
    // throttle: 1.5s between sends
    if (now - (lastTypingSentRef.current || 0) < 1500) return;
    lastTypingSentRef.current = now;
    typingChannelRef.current.send({
      type: 'broadcast',
      event: 'typing',
      payload: { sender_id: chatMeId, at: now },
    });
  } catch {}
}


// Details of the latest match to display in the premium pulse
type MatchInfo = {
  match_user_id?: string | null;
  match_gender?: string | null;
  match_age?: number | null;
  distance_kilometre?: number | null;
  score_pref_to_self?: number | null;
};

function roundScorePercent(score?: number | null): number | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return Math.round(score * 100); // physics-style rounding to nearest
}


  const markDirty = () => setModalDirty(true);

  // --- Draft state mirrored from the main onboarding state (edited only inside modal) ---
  const [draftGenderIdx, setDraftGenderIdx] = useState<number | null>(null);
  const [draftPreferenceIdx, setDraftPreferenceIdx] = useState<number | null>(null);
  const [draftAgeRange, setDraftAgeRange] = useState<number[]>([25, 30]);
  const [draftDistanceMax, setDraftDistanceMax] = useState<number>(100);
  const [draftDistanceIdx, setDraftDistanceIdx] = useState<number>(0);
  const [draftGeoEnabled, setDraftGeoEnabled] = useState<boolean>(false);
  const [draftGeoBusy, setDraftGeoBusy] = useState<boolean>(false);
  const [draftGeoCoords, setDraftGeoCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [draftRelationshipType, setDraftRelationshipType] = useState<RelationshipChoice | null>(null);
  const [draftStrictnessLevel, setDraftStrictnessLevel] = useState<number>(2);

  const openSettings = () => {
    // seed drafts with current values
    setDraftGenderIdx(genderIdx);
    setDraftPreferenceIdx(preferenceIdx);
    setDraftAgeRange([ageRange[0], ageRange[1]]);
    setDraftDistanceMax(distanceMax);
    setDraftDistanceIdx(distanceSteps.indexOf(distanceMax) >= 0 ? distanceSteps.indexOf(distanceMax) : currentIdx);
    setDraftGeoEnabled(geoEnabled);
    setDraftGeoCoords(geoCoords);
    setDraftRelationshipType(relationshipType);
    setDraftStrictnessLevel(strictnessLevel);
    setSettingsTab('orientation');
    setModalDirty(false);
    setSettingsOpen(true);
  };

  // Theme toggle
  const { theme, setTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  useEffect(() => setThemeMounted(true), []);
  const toggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light');

  // ===== Auth bootstrap (Google OAuth) =====
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    if (!code) return;
    supabase.auth
      .exchangeCodeForSession(code)
      .then(() => {
        url.searchParams.delete('code');
        url.searchParams.delete('state');
        window.history.replaceState({}, '', url.toString());
      })
      .catch(() => {});
  }, [supabase]);
  // Load step_index at boot and avoid flashing step 1
  useEffect(() => {
    if (!isAuthed || stepLoaded) return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) { setStepLoaded(true); return; }
        const res = await fetch('/api/ask?fn=me', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        const raw = json?.profile?.step_index;
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 1 && n <= 10) {
          setStep(n as Step); // initial set only, no PATCH here
        }
      } catch {
        // ignore
      } finally {
        setStepLoaded(true);
      }
    })();
  }, [isAuthed, supabase, stepLoaded]);


  useEffect(() => {
    let mounted = true;
    supabase.auth
      .getUser()
      .then(({ data }) => mounted && setIsAuthed(!!data.user))
      .catch(() => mounted && setIsAuthed(false));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setIsAuthed(!!session?.user);
      const fresh = session?.access_token;
      if (fresh) { void supabase.realtime.setAuth(fresh); }
    });
    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [supabase]);

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

  const handleLogout = async () => {
    await supabase.auth.signOut({ scope: 'global' });
    setIsAuthed(false);
  };
  // 📡 Canal central — INSERT + UPDATE sur MA ligne dans `matches` (passif, centralisé)
useEffect(() => {
  if (!isAuthed || !postOnboarding) return;

  let channel: any;

  (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return;

      channel = supabase
        .channel(`matches-central-${user.id}`)

        // 🆕 INSERT — nouvelle ligne m’a été attribuée (user_id = moi)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'matches',
            filter: `user_id=eq.${user.id}`,
          },
          (payload: any) => {
  const row = payload?.new || {};

  // 1) Hydrater les infos du cercle avec la ligne insérée
  setLatestMatch({
    match_user_id: row.match_user_id ?? null,
    match_gender: row.match_gender ?? null,
    match_age:
      typeof row.match_age === 'number'
        ? row.match_age
        : row.match_age != null
        ? Number(row.match_age)
        : null,
    // la DB envoie distance_km → on l’injecte dans ton state distance_kilometre
    distance_kilometre:
      typeof row.distance_km === 'number'
        ? row.distance_km
        : row.distance_km != null
        ? Number(row.distance_km)
        : null,
    score_pref_to_self:
      typeof row.score_pref_to_self === 'number'
        ? row.score_pref_to_self
        : row.score_pref_to_self != null
        ? Number(row.score_pref_to_self)
        : null,
  });

  // 2) Afficher la bulle New Match
  setShowMatchTestBubble(true);

  // 3) Bouton au démarrage : "idle"
  setConfirmButtonState('idle');
  // 4) Empiler ce match en tête de file (dernier arrivé d'abord) et pointer dessus
setMatchesQueue((prev) => {
  const withoutDup = prev.filter((m) => m?.id !== row.id);
  return [row, ...withoutDup];
});
setCurrentMatchIndex(0);
if (row?.id) {
  setConfirmButtonStates(prev => ({ ...prev, [String(row.id)]: 'idle' }));
}
}
        )

        // ♻️ UPDATE — modification de MA ligne (colonnes utiles uniquement)
        .on(
  'postgres_changes',
  {
    event: 'UPDATE',
    schema: 'public',
    table: 'matches',
    filter: `user_id=eq.${user.id}`,
  },
  (payload: any) => {
    const row = payload?.new;
    if (!row) return;

    const status = String(row.status || '').toLowerCase();
    const id = String(row.id);

    // 🔴 Cas supprimé → on retire UNIQUEMENT ce match (sans toucher aux autres)
    if (status === 'deleted') {
  // ➜ on retire UNIQUEMENT cette ligne, et on affiche le prochain match s'il y en a un
  setMatchesQueue((prev) => {
    const next = prev.filter((m) => String(m?.id) !== id);

    const nextIndex =
      currentMatchIndex >= next.length ? Math.max(0, next.length - 1) : currentMatchIndex;
    setCurrentMatchIndex(nextIndex);

    setConfirmButtonStates((prevState) => {
      const copy = { ...prevState };
      delete copy[id];
      return copy;
    });

    setShowConfirmedMatchBubble(false);

    if (next.length > 0) {
      const r = next[nextIndex];
      setLatestMatch({
        match_user_id: r.match_user_id ?? null,
        match_gender: r.match_gender ?? null,
        match_age: r.match_age != null ? Number(r.match_age) : null,
        distance_kilometre: r.distance_km != null ? Number(r.distance_km) : null,
        score_pref_to_self: r.score_pref_to_self != null ? Number(r.score_pref_to_self) : null,
      });
      setShowMatchTestBubble(true);
    } else {
      setShowMatchTestBubble(false);
    }

    return next;
  });

  return; // fin du cas "deleted"
}

    // 1) Mettre à jour / insérer CETTE ligne dans la file
    setMatchesQueue((prev) => {
      const i = prev.findIndex((m) => String(m?.id) === id);
      if (i === -1) return [row, ...prev]; // pas vu l'INSERT → on ajoute en tête
      const copy = [...prev];
      copy[i] = { ...copy[i], ...row };
      return copy;
    });

    // 2) État du bouton pour CE match
    if (row.match === true) {
      setConfirmButtonStates((prev) => ({ ...prev, [id]: 'confirmed' }));
      setShowConfirmedMatchBubble(true);
      return;
    }

    if (status === 'confirmed') {
      setConfirmButtonStates((prev) => ({ ...prev, [id]: 'waiting' }));
      setShowConfirmedMatchBubble(false);
      return;
    }

    if (status === 'rejected') {
      setConfirmButtonStates((prev) => ({ ...prev, [id]: 'rejected' }));
      setShowConfirmedMatchBubble(false);
      return;
    }

    // fallback (pending / autres)
    setConfirmButtonStates((prev) => ({ ...prev, [id]: 'idle' }));
    setShowConfirmedMatchBubble(false);
  }
)

        .subscribe();
    } catch (err) {
      console.error('💥 [matches-central] init error:', err);
    }
  })();

  return () => { if (channel) supabase.removeChannel(channel); };
}, [isAuthed, postOnboarding, supabase]);

  // ===== Heure serveur via backend =====
  const [serverYear, setServerYear] = useState<number | null>(null);
  const [loadingYear, setLoadingYear] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    async function fetchServerYear() {
      setLoadingYear(true);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;

        const res = await fetch('/api/ask', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (mounted && typeof json?.year === 'number') {
          setServerYear(json.year);
        }
      } catch {
        // no-op
      } finally {
        if (mounted) setLoadingYear(false);
      }
    }
    if (isAuthed) void fetchServerYear();
    return () => {
      mounted = false;
    };
  }, [supabase, isAuthed]);

  // ===== Récup nom utilisateur via Askroot.ts (jamais directement Supabase) =====
  const [userFullName, setUserFullName] = useState<string | null>(null);
  const [userInitials, setUserInitials] = useState<string>('••');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isAuthed) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;

        // ⬇️ récup fullname depuis Askroot
        const res = await fetch('/api/ask?fn=me', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();

        const full =
          json?.user?.full_name ??
          json?.full_name ??
          null;

        if (!cancelled) {
          if (typeof full === 'string' && full.trim().length > 0) {
            setUserFullName(full);
            setUserInitials(initialsFromFullName(full));
          } else {
            // fallback
            setUserFullName(null);
            setUserInitials('U');
          }
        }
      } catch {
        if (!cancelled) {
          setUserFullName(null);
          setUserInitials('U');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthed, supabase]);

  // ===== DOB logic (Dropdowns) =====
  const MAX_AGE = 80;
  const MIN_AGE = 18;
  const minYear = useMemo(() => (serverYear != null ? serverYear - MAX_AGE : null), [serverYear]);
  const maxYear = useMemo(() => (serverYear != null ? serverYear - MIN_AGE : null), [serverYear]);

  const years = useMemo(() => {
    if (minYear == null || maxYear == null) return [];
    return Array.from({ length: maxYear - minYear + 1 }, (_, i) => String(maxYear - i));
  }, [minYear, maxYear]);

  const months = useMemo(
    () => Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')),
    []
  );

  const daysInMonth = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate();

  const [dayIdx, setDayIdx] = useState<number | null>(null);
  const [monthIdx, setMonthIdx] = useState<number | null>(null);
  const [yearIdx, setYearIdx] = useState<number | null>(null);

  const yearVal = yearIdx != null && years[yearIdx] ? parseInt(years[yearIdx], 10) : null;
  const monthVal = monthIdx != null ? parseInt(months[monthIdx], 10) : null;

  const daysCount = useMemo(() => {
    if (yearVal != null && monthVal != null) return daysInMonth(yearVal, monthVal - 1);
    return 31;
  }, [yearVal, monthVal]);

  const days = useMemo(
    () => Array.from({ length: daysCount }, (_, i) => String(i + 1).padStart(2, '0')),
    [daysCount]
  );

  // 🔧 useEffect (birthdate) avec protections "vierge"
  useEffect(() => {
    if (!isAuthed || initialBirthdateFetched || serverYear == null || years.length === 0) {
      return;
    }

    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from('users')
          .select('birthdate')
          .eq('id', user.id)
          .maybeSingle();

        if (error) {
          console.error('❌ Erreur Supabase birthdate:', error);
          setInitialBirthdateFetched(true);
          return;
        }

        if (!data?.birthdate) {
          setInitialBirthdateFetched(true);
          return;
        }

        const [yStr, mStr, dStr] = String(data.birthdate).split('-');
        const y = Number(yStr);
        const m0 = Number(mStr) - 1;
        const dNum = Number(dStr);

        const yIndex = years.findIndex((val) => Number(val) === y);
        if (yIndex !== -1) setYearIdx(yIndex);
        if (m0 >= 0 && m0 <= 11) setMonthIdx(m0);

        const dIdx = dNum - 1;
        if (dIdx >= 0 && dIdx <= 30) setDayIdx(dIdx);

        setInitialBirthdateFetched(true);
      } catch (err) {
        console.error('💥 Erreur chargement birthdate:', err);
        setInitialBirthdateFetched(true);
      }
    })();
  }, [isAuthed, initialBirthdateFetched, serverYear, years, supabase]);

  useEffect(() => {
    if (dayIdx != null && dayIdx > days.length - 1) {
      setDayIdx(days.length - 1);
    }
  }, [days.length, dayIdx]);

  const dayVal = dayIdx != null ? parseInt(days[dayIdx], 10) : null;

  const hasValidDate =
    serverYear != null &&
    minYear != null &&
    maxYear != null &&
    yearVal != null &&
    monthVal != null &&
    dayVal != null &&
    yearVal >= minYear &&
    yearVal <= maxYear &&
    monthVal >= 1 &&
    monthVal <= 12 &&
    dayVal >= 1 &&
    dayVal <= daysCount;

  // ===== Orientation =====
  const [genderIdx, setGenderIdx] = useState<number | null>(null);
  const [preferenceIdx, setPreferenceIdx] = useState<number | null>(null);
  const genders = ['Man', 'Woman'];
  const preferences = ['Man', 'Woman', 'Both'];
  const hasOrientation = genderIdx != null && preferenceIdx != null;

  // === Step 2: mapping UI labels -> DB codes (lowercase)
  const GENDER_CODE = { Man: 'man', Woman: 'woman' } as const;
  const PREF_CODE   = { Man: 'seek_man', Woman: 'seek_woman', Both: 'seek_both' } as const;
  type GenderUILabel = keyof typeof GENDER_CODE; // 'Man' | 'Woman'
  type PrefUILabel   = keyof typeof PREF_CODE;   // 'Man' | 'Woman' | 'Both'

  // DB -> UI (compat: accepte aussi ancien format 'man'/'woman'/'both' et capitalisés)
  const GENDER_CODE_TO_UI: Record<string, GenderUILabel> = {
    man: 'Man',
    woman: 'Woman',
  };
  const PREF_CODE_TO_UI: Record<string, PrefUILabel> = {
    seek_man: 'Man',
    seek_woman: 'Woman',
    seek_both: 'Both',
    // rétro-compat si l'ancien format est déjà stocké
    man: 'Man',
    woman: 'Woman',
    both: 'Both',
  };

  // 🔁 Préremplissage auto (safe table vide)
  useEffect(() => {
    if (!isAuthed || genderIdx !== null || preferenceIdx !== null) return;

    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from('user_profiles')
          .select('gender, orientation_preference')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) {
          console.error('⚠️ Erreur chargement user_profiles (orientation):', error);
          return;
        }

        if (data?.gender) {
          const ui = GENDER_CODE_TO_UI[String(data.gender).toLowerCase()];
          if (ui) {
            const gIdx = genders.findIndex((g) => g === ui);
            if (gIdx !== -1) setGenderIdx(gIdx);
          }
        }

        if (data?.orientation_preference) {
          const ui = PREF_CODE_TO_UI[String(data.orientation_preference).toLowerCase()];
          if (ui) {
            const pIdx = preferences.findIndex((p) => p === ui);
            if (pIdx !== -1) setPreferenceIdx(pIdx);
          }
        }
      } catch (err) {
        console.error('💥 Erreur récupération profil (orientation):', err);
      }
    })();
  }, [isAuthed, genderIdx, preferenceIdx, supabase]);

  // ===== Age Range =====
  const RANGE_MIN = 18;
  const RANGE_MAX = 80;
  const [ageRange, setAgeRange] = useState<number[]>([25, 30]);

  useEffect(() => {
    if (!isAuthed) return;

    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from('user_profiles')
          .select('age_min, age_max')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) {
          console.error('❌ Erreur chargement age range:', error);
          return;
        }

        if (typeof data?.age_min === 'number' && typeof data?.age_max === 'number') {
          setAgeRange([data.age_min, data.age_max]);
        }
      } catch (err) {
        console.error('💥 Erreur récupération age range:', err);
      }
    })();
  }, [isAuthed, supabase]);

  const hasAgeRange = ageRange[0] < ageRange[1];

  const pctLeft = ((ageRange[0] - RANGE_MIN) / (RANGE_MAX - RANGE_MIN)) * 100;
  const pctRight = ((ageRange[1] - RANGE_MIN) / (RANGE_MAX - RANGE_MIN)) * 100;

  // ===== Distance =====
  const DIST_NO_LIMIT = 5001;
  const distanceSteps = useMemo<number[]>(
    () => [
      ...Array.from({ length: 100 }, (_, i) => i + 1),
      ...Array.from({ length: 90 }, (_, i) => 110 + i * 10),
      ...Array.from({ length: 20 }, (_, i) => 1100 + i * 100),
      3500, 4000, 4500, 5000,
      DIST_NO_LIMIT,
    ],
    []
  );

  const [distanceMax, setDistanceMax] = useState<number>(100);
  const [currentIdx, setCurrentIdx] = useState<number>(() => {
    const idx = distanceSteps.indexOf(100);
    return idx >= 0 ? idx : 0;
  });

  // ✅ NEW: Préremplissage distance depuis Supabase, sans toucher au switch de géoloc
  const [initialDistanceLoaded, setInitialDistanceLoaded] = useState(false);
  useEffect(() => {
    if (!isAuthed || initialDistanceLoaded) return;

    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from('user_profiles')
          .select('distance_max_km')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) {
          console.error('⚠️ Erreur chargement user_profiles (distance):', error);
          setInitialDistanceLoaded(true);
          return;
        }

        const saved = data?.distance_max_km;
        if (typeof saved === 'number') {
          const idx = distanceSteps.indexOf(saved);
          if (idx !== -1) {
            setDistanceMax(saved);
            setCurrentIdx(idx);
          }
        }
      } catch (err) {
        console.error('💥 Erreur récupération distance:', err);
      } finally {
        setInitialDistanceLoaded(true);
      }
    })();
  }, [isAuthed, supabase, distanceSteps, initialDistanceLoaded]);

  // —— Géoloc (étape 4) — UI + state
  const [geoEnabled, setGeoEnabled] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoCoords, setGeoCoords] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);

  // 🔒 Suivi permission navigateur (fige ON quand granted, repasse OFF si révoqué)
  type GeoPermission = 'granted' | 'prompt' | 'denied' | 'unknown';
  const [geoPermission, setGeoPermission] = useState<GeoPermission>('unknown');
  const geoPermRef = useRef<any>(null);
  const geoLockedOn = geoEnabled && geoPermission === 'granted';

  useEffect(() => {
    if (step !== 4) return;
    if (typeof navigator === 'undefined' || !(navigator as any).permissions?.query) {
      setGeoPermission('unknown');
      return;
    }
    let cancelled = false;
    (navigator as any).permissions
      .query({ name: 'geolocation' as any })
      .then((status: any) => {
        if (cancelled) return;
        geoPermRef.current = status;
        const apply = (st: 'granted' | 'prompt' | 'denied') => {
          setGeoPermission(st);
          if (st === 'granted') {
            // 🔒 Le switch reflète l'autorisation -> toujours ON et verrouillé.
            setGeoEnabled(true);
            // On tente d'obtenir des coordonnées fraîches si on n'en a pas encore.
            if (!geoCoords && !geoBusy) {
              void requestGeolocation();
            }
          } else {
            // Permission non accordée -> switch OFF et coordonnées vidées.
            setGeoEnabled(false);
            setGeoCoords(null);
          }
        };
        apply(status.state);
        (status as any).onchange = () => apply((status as any).state);
      })
      .catch(() => setGeoPermission('unknown'));
    return () => {
      cancelled = true;
      if (geoPermRef.current) {
        try {
          (geoPermRef.current as any).onchange = null;
        } catch {}
      }
    };
  }, [step]); // volontairement limité à step (comportement voulu à l'entrée de l'étape)

  // Demande la position (aucun appel backend ici)
  const requestGeolocation = async () => {
    if (geoBusy) return;
    setGeoBusy(true);
    try {
      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            const accuracy = pos.coords.accuracy;
            setGeoCoords({ lat, lng, accuracy });
            // Le switch reflète la permission, pas la présence de coords; mais si on a réussi, on confirme ON.
            setGeoEnabled(true);
            setGeoBusy(false);
            resolve();
          },
          () => {
            // Si la permission est accordée mais l'obtention échoue, on laisse le switch ON (il reflète la permission).
            if (geoPermission === 'granted') {
              setGeoEnabled(true);
            } else {
              setGeoEnabled(false);
            }
            setGeoCoords(null);
            setGeoBusy(false);
            resolve();
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      });
    } catch {
      // Même logique qu'au-dessus : on respecte l'état de permission.
      if (geoPermission === 'granted') {
        setGeoEnabled(true);
      } else {
        setGeoEnabled(false);
      }
      setGeoCoords(null);
      setGeoBusy(false);
    }
  };

  // Toggle du switch (empêche OFF si permission encore granted)
  const handleLocationToggle = async () => {
    if (geoBusy) return;
    if (geoEnabled && geoPermission === 'granted') {
      // Figé sur ON tant que le navigateur n’a pas révoqué la permission
      return;
    }
    if (geoEnabled) {
      // Cas théorique (pas granted) → OFF local
      setGeoEnabled(false);
      setGeoCoords(null);
      return;
    }
    // ON → pop-up / récupération coords
    await requestGeolocation();
  };

  // ===== Relationship Type (Step 5) =====
  const [relationshipType, setRelationshipType] = useState<RelationshipChoice | null>(null);

  // 🔁 Préremplissage auto (relationship)
  useEffect(() => {
    if (!isAuthed || relationshipType !== null) return;

    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data, error } = await supabase
          .from('user_profiles')
          .select('relationship')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) {
          console.error('⚠️ Erreur chargement user_profiles (relationship):', error);
          return;
        }

        if (data?.relationship === 'serious' || data?.relationship === 'open' || data?.relationship === 'casual') {
          setRelationshipType(data.relationship);
        }
      } catch (err) {
        console.error('💥 Erreur récupération profil (relationship):', err);
      }
    })();
  }, [isAuthed, relationshipType, supabase]);

  // ===== Étape 8 : état local des 6 photos (SELF) =====
  const [photos, setPhotos] = useState<(PhotoItem | null)[]>(
    () => Array.from({ length: 6 }, () => null)
  );

  const allConfirmed = useMemo(
    () => photos.filter((p) => p?.status === 'confirmed').length === 6,
    [photos]
  );

  // ⏱️ NEW (Step 8): refs pour animation fluide + lecture statut en temps réel
  const photosRef = useRef<(PhotoItem | null)[]>(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  const uploadRafRef = useRef<Record<number, number | null>>({});
  const cancelUploadProgress = (slot: number) => {
    const id = uploadRafRef.current[slot];
    if (id != null) {
      window.cancelAnimationFrame(id);
      uploadRafRef.current[slot] = null;
    }
  };

  // ===== Étape 9 : strictness + préférences =====
  const [strictnessLevel, setStrictnessLevel] = useState<number>(2); // 1 | 2 | 3 (défaut Balanced=2)
  const strictnessPct = useMemo(() => ((strictnessLevel - 1) / 2) * 100, [strictnessLevel]); // 0%, 50%, 100%

  const strictnessCopy = useMemo(() => {
    if (strictnessLevel === 1) {
      return {
        title: 'Open-minded 🧘‍♂️',
        desc: "I’m vibing with all kinds of people. Surprise me.",
      };
    }
    if (strictnessLevel === 2) {
      return {
        title: 'Balanced ⚖️',
        desc: "I’ve got a type, but I’m flexible.",
      };
    }
    return {
      title: 'Specific taste 🔍',
      desc: "Be picky. Show me only what I love.",
    };
  }, [strictnessLevel]);

  // 🔁 Préchargement strictness (via backend askroot.ts → /api/ask?fn=me)
  const [strictnessLoaded, setStrictnessLoaded] = useState(false);
  useEffect(() => {
    if (!isAuthed || strictnessLoaded) return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;
        const res = await fetch('/api/ask?fn=me', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        const raw =
          json?.profile?.strictness_level ??
          json?.strictness_level ??
          json?.user?.strictness_level;
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 3) {
          setStrictnessLevel(parsed);
        }
      } catch {
        // pas d’erreur bloquante — on garde la valeur par défaut
      } finally {
        setStrictnessLoaded(true);
      }
    })();
  }, [isAuthed, strictnessLoaded, supabase]);

  const [photosPreference, setPhotosPreference] = useState<(PhotoItem | null)[]>(
    () => Array.from({ length: 6 }, () => null)
  );
  const allPrefConfirmed = useMemo(
    () => photosPreference.filter((p) => p?.status === 'confirmed').length === 6,
    [photosPreference]
  );

  // ⏱️ NEW (Step 9): refs pour animation fluide + lecture statut en temps réel
  const photosPreferenceRef = useRef<(PhotoItem | null)[]>(photosPreference);
  useEffect(() => {
    photosPreferenceRef.current = photosPreference;
  }, [photosPreference]);

  const uploadPrefRafRef = useRef<Record<number, number | null>>({});
  const cancelPrefUploadProgress = (slot: number) => {
    const id = uploadPrefRafRef.current[slot];
    if (id != null) {
      window.cancelAnimationFrame(id);
      uploadPrefRafRef.current[slot] = null;
    }
  };

  /**
   * ===== Helpers Realtime pour Step 8 (SELF) =====
   */
  const selfPhotoChannelsRef = useRef<Record<string, any>>({}); // dbId -> channel

  const unsubscribeSelfChannel = (dbId: string) => {
    const ch = selfPhotoChannelsRef.current[dbId];
    if (ch) {
      try {
        supabase.removeChannel(ch);
      } catch {}
      delete selfPhotoChannelsRef.current[dbId];
    }
  };

  const mapServerToUploadStatus = (s?: string): UploadStatus | null => {
    if (!s) return null;
    if (s === 'confirmed' || s === 'rejected' || s === 'duplicate' || s === 'timeout') return s;
    // 'pending' => on laisse l'UI sur 'uploading'
    return null;
  };

  const subscribeSelfChannel = (dbId: string) => {
    // Nettoyage éventuel si déjà abonné
    unsubscribeSelfChannel(dbId);

    const ch = supabase
      .channel(`photos-self-${dbId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'photos',
          filter: `id=eq.${dbId}`,
        },
        (payload: any) => {
          const s = mapServerToUploadStatus(payload?.new?.status as string | undefined);
          if (s) {
            setPhotos((prev) =>
              prev.map((p) => (p && p.dbId === dbId ? { ...p, status: s } : p))
            );
          }
        }
      )
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          try {
            const { data, error } = await supabase
              .from('photos')
              .select('status')
              .eq('id', dbId)
              .maybeSingle();
            if (!error) {
              const s = mapServerToUploadStatus(data?.status as string | undefined);
              if (s) {
                setPhotos((prev) =>
                  prev.map((p) => (p && p.dbId === dbId ? { ...p, status: s } : p))
                );
              }
            }
          } catch {
            // ignore
          }
        }
      });

    selfPhotoChannelsRef.current[dbId] = ch;
  };

  // ===== Handlers Étape 8 (SELF) — upload direct Supabase + Realtime =====
  const handlePhotoUpload = async (file: File, index: number) => {
    if (!file) return;
    if (settingsOpen) setModalDirty(true); // mark modal dirty when changing inside modal

    // Si une photo existait déjà sur ce slot, on coupe son écoute
    const prev = photos[index];
    if (prev?.dbId) unsubscribeSelfChannel(prev.dbId);

    const objectUrl = URL.createObjectURL(file);
    const localId = `${index}-${Date.now()}`;
    const newPhoto: PhotoItem = {
      id: localId,
      url: objectUrl,
      progress: 0,
      status: 'uploading',
    };

    setPhotos((prevArr) => {
      const next = [...prevArr];
      next[index] = newPhoto;
      return next;
    });

    // ⏱️ Progression visuelle fluide (exactement 10s) via rAF
    const SIM_MS = 10000;
    const start = performance.now();

    const animate = () => {
      const elapsed = performance.now() - start;
      const pct = Math.min(100, Math.floor((elapsed / SIM_MS) * 100));

      // N'actualiser que si le slot est toujours en 'uploading'
      setPhotos((prevArr) => {
        const current = prevArr[index];
        if (!current || current.status !== 'uploading') return prevArr;
        if (current.progress === pct) return prevArr;
        const next = [...prevArr];
        next[index] = { ...current, progress: pct };
        return next;
      });

      // Tant que <100 et toujours 'uploading', on continue l'animation
      const currentStatus = photosRef.current[index]?.status;
      if (pct < 100 && currentStatus === 'uploading') {
        uploadRafRef.current[index] = window.requestAnimationFrame(animate);
      } else {
        uploadRafRef.current[index] = null; // stop
      }
    };
    uploadRafRef.current[index] = window.requestAnimationFrame(animate);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        cancelUploadProgress(index);
        setPhotos((prevArr) =>
          prevArr.map((p, i) =>
            i === index && p?.id === localId ? { ...p, status: 'timeout', progress: 100 } : p
          )
        );
        return;
    }

      // 1) Créer la ligne (status pending, path provisoire)
      const { data: inserted, error: insertError } = await supabase
        .from('photos')
        .insert({
          user_id: user.id,
          photo: 'self',
          path: 'pending',
          vectorized: false,
          status: 'pending',
        })
        .select('id')
        .single();

      if (insertError || !inserted?.id) {
        console.error('❌ Erreur insertion DB (self):', insertError);
        cancelUploadProgress(index);
        setPhotos((prevArr) =>
          prevArr.map((p, i) =>
            i === index && p?.id === localId ? { ...p, status: 'timeout', progress: 100 } : p
          )
        );
        return;
      }

      const dbId = inserted.id as string;

      // Enregistrer dbId sur le slot
      setPhotos((prevArr) => {
        const next = [...prevArr];
        const p = next[index];
        if (p && p.id === localId) next[index] = { ...p, dbId };
        return next;
      });

      // 2) S'abonner très tôt aux updates de statut
      subscribeSelfChannel(dbId);

      // 3) Uploader le fichier dans le bucket 'photos_user'
      const path = `${dbId}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('photos_user')
        .upload(path, file, {
          contentType: file.type || 'image/jpeg',
          upsert: false,
        });

      if (uploadError) {
        console.error('❌ Erreur upload Supabase (self):', uploadError);
        // ⚠️ On NE supprime PAS la ligne (demande produit)
        cancelUploadProgress(index);
        setPhotos((prevArr) =>
          prevArr.map((p, i) =>
            i === index && p?.id === localId ? { ...p, status: 'timeout', progress: 100 } : p
          )
        );
        return;
      }

      // 4) Mettre à jour la ligne avec le path final
      const { error: updateErr } = await supabase
        .from('photos')
        .update({ path })
        .eq('id', dbId);

      if (updateErr) {
        console.error('❌ Erreur update path (self):', updateErr);
        // Ne pas supprimer la ligne – on marque timeout côté UI
        cancelUploadProgress(index);
        setPhotos((prevArr) =>
          prevArr.map((p, i) =>
            i === index && p?.id === localId ? { ...p, status: 'timeout', progress: 100 } : p
          )
        );
        return;
      }

      // ✅ Fin upload: on ne force plus le progress à 100 ici.
      // L’animation continue jusqu’à 10s, sauf si le backend statue avant (alors le ring disparaît).
    } catch (err) {
      console.error('💥 Erreur upload direct Supabase (self):', err);
      cancelUploadProgress(index);
      setPhotos((prevArr) =>
        prevArr.map((p, i) =>
          i === index && p?.id === localId ? { ...p, status: 'timeout', progress: 100 } : p
        )
      );
    }
  };

  const handleDeletePhoto = async (index: number) => {
    // ⏹️ Arrête l'animation si en cours
    cancelUploadProgress(index);
    if (settingsOpen) setModalDirty(true); // mark modal dirty when changing inside modal

    const item = photos[index];
    if (item?.url) URL.revokeObjectURL(item.url);
    const dbId = item?.dbId;

    if (dbId) unsubscribeSelfChannel(dbId);

    // 1) Retirer la tuile de l'UI immédiatement
    setPhotos((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });

    // 2) Mettre à jour la ligne DB → status = 'deleted' (le backend s'occupe du reste)
    if (dbId) {
      try {
        await supabase
          .from('photos')
          .update({ status: 'deleted' })
          .eq('id', dbId);
      } catch (e) {
        console.error('⚠️ Erreur set status=deleted (self):', e);
      }
    }
  };

  /**
   * ===== Helpers Realtime pour Step 9 (PREFERENCE) =====
   */
  const preferencePhotoChannelsRef = useRef<Record<string, any>>({}); // dbId -> channel

  const unsubscribePreferenceChannel = (dbId: string) => {
    const ch = preferencePhotoChannelsRef.current[dbId];
    if (ch) {
      try {
        supabase.removeChannel(ch);
      } catch {}
      delete preferencePhotoChannelsRef.current[dbId];
    }
  };

  const subscribePreferenceChannel = (dbId: string) => {
    // Nettoyage éventuel si déjà abonné
    unsubscribePreferenceChannel(dbId);

    const ch = supabase
      .channel(`photos-pref-${dbId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'photos',
          filter: `id=eq.${dbId}`,
        },
        (payload: any) => {
          const s = mapServerToUploadStatus(payload?.new?.status as string | undefined);
          if (s) {
            setPhotosPreference((prev) =>
              prev.map((p) => (p && p.dbId === dbId ? { ...p, status: s } : p))
            );
          }
        }
      )
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          try {
            const { data, error } = await supabase
              .from('photos')
              .select('status')
              .eq('id', dbId)
              .maybeSingle();
            if (!error) {
              const s = mapServerToUploadStatus(data?.status as string | undefined);
              if (s) {
                setPhotosPreference((prev) =>
                  prev.map((p) => (p && p.dbId === dbId ? { ...p, status: s } : p))
                );
              }
            }
          } catch {
            // ignore
          }
        }
      });

    preferencePhotoChannelsRef.current[dbId] = ch;
  };

  // ===== Handlers Étape 9 (PREFERENCE) — upload direct Supabase + Realtime (identique à Step 8) =====
  const handlePreferenceUpload = async (file: File, index: number) => {
    if (!file) return;
    if (settingsOpen) setModalDirty(true);

    // Si une photo existait déjà sur ce slot, on coupe son écoute
    const prev = photosPreference[index];
    if (prev?.dbId) unsubscribePreferenceChannel(prev.dbId);

    const objectUrl = URL.createObjectURL(file);
    const localId = `pref-${index}-${Date.now()}`;
    const newPhoto: PhotoItem = {
      id: localId,
      url: objectUrl,
      progress: 0,
      status: 'uploading',
    };

    setPhotosPreference((prevArr) => {
      const next = [...prevArr];
      next[index] = newPhoto;
      return next;
    });

    // ⏱️ Progression visuelle fluide (exactement 10s) via rAF
    const SIM_MS = 10000;
    const start = performance.now();

    const animate = () => {
      const elapsed = performance.now() - start;
      const pct = Math.min(100, Math.floor((elapsed / SIM_MS) * 100));

      // N'actualiser que si le slot est toujours en 'uploading'
      setPhotosPreference((prevArr) => {
        const current = prevArr[index];
        if (!current || current.status !== 'uploading') return prevArr;
        if (current.progress === pct) return prevArr;
        const next = [...prevArr];
        next[index] = { ...current, progress: pct };
        return next;
      });

      // Tant que <100 et toujours 'uploading', on continue l'animation
      const currentStatus = photosPreferenceRef.current[index]?.status;
      if (pct < 100 && currentStatus === 'uploading') {
        uploadPrefRafRef.current[index] = window.requestAnimationFrame(animate);
      } else {
        uploadPrefRafRef.current[index] = null; // stop
      }
    };
    uploadPrefRafRef.current[index] = window.requestAnimationFrame(animate);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        cancelPrefUploadProgress(index);
        setPhotosPreference((prevArr) =>
          prevArr.map((p, i) =>
            i === index && p?.id === localId ? { ...p, status: 'timeout', progress: 100 } : p
          )
        );
        return;
      }

      // 1) Créer la ligne (status pending, path provisoire)
      const { data: inserted, error: insertError } = await supabase
        .from('photos')
        .insert({
          user_id: user.id,
          photo: 'preference',
          path: 'pending',
          vectorized: false,
          status: 'pending',
        })
        .select('id')
        .single();

      if (insertError || !inserted?.id) {
        console.error('❌ Erreur insertion DB (preference):', insertError);
        cancelPrefUploadProgress(index);
        setPhotosPreference((prevArr) =>
          prevArr.map((p, i) =>
            i === index && p?.id === localId ? { ...p, status: 'timeout', progress: 100 } : p
          )
        );
        return;
      }

      const dbId = inserted.id as string;

      // Enregistrer dbId sur le slot
      setPhotosPreference((prevArr) => {
        const next = [...prevArr];
        const p = next[index];
        if (p && p.id === localId) next[index] = { ...p, dbId };
        return next;
      });

      // 2) S'abonner très tôt aux updates de statut
      subscribePreferenceChannel(dbId);

      // 3) Uploader le fichier dans le bucket 'photos_preference'
      const path = `${dbId}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('photos_preference')
        .upload(path, file, {
          contentType: file.type || 'image/jpeg',
          upsert: false,
        });

      if (uploadError) {
        console.error('❌ Erreur upload Supabase (preference):', uploadError);
        // ⚠️ On NE supprime PAS la ligne
        cancelPrefUploadProgress(index);
        setPhotosPreference((prevArr) =>
          prevArr.map((p, i) =>
            i === index && p?.id === localId ? { ...p, status: 'timeout', progress: 100 } : p
          )
        );
        return;
      }

      // 4) Mettre à jour la ligne avec le path final
      const { error: updateErr } = await supabase
        .from('photos')
        .update({ path })
        .eq('id', dbId);

      if (updateErr) {
        console.error('❌ Erreur update path (preference):', updateErr);
        // Ne pas supprimer la ligne – on marque timeout côté UI
        cancelPrefUploadProgress(index);
        setPhotosPreference((prevArr) =>
          prevArr.map((p, i) =>
            i === index && p?.id === localId ? { ...p, status: 'timeout', progress: 100 } : p
          )
        );
        return;
      }

      // ✅ Fin upload: on ne force pas le progress à 100 ici.
    } catch (err) {
      console.error('💥 Erreur upload direct Supabase (preference):', err);
      cancelPrefUploadProgress(index);
      setPhotosPreference((prevArr) =>
        prevArr.map((p, i) =>
          i === index && p?.id === localId ? { ...p, status: 'timeout', progress: 100 } : p
        )
      );
    }
  };

  const handleDeletePreference = async (index: number) => {
    // ⏹️ Arrête l'animation si en cours
    cancelPrefUploadProgress(index);
    if (settingsOpen) setModalDirty(true);

    const item = photosPreference[index];
    if (item?.url) URL.revokeObjectURL(item.url);
    const dbId = item?.dbId;

    if (dbId) unsubscribePreferenceChannel(dbId);

    // 1) Retirer la tuile de l'UI immédiatement
    setPhotosPreference((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });

    // 2) Mettre à jour la ligne DB → status = 'deleted' (le backend s'occupe du reste)
    if (dbId) {
      try {
        await supabase
          .from('photos')
          .update({ status: 'deleted' })
          .eq('id', dbId);
      } catch (e) {
        console.error('⚠️ Erreur set status=deleted (preference):', e);
      }
    }
  };

  /**
   * ===== Realtime: écoute des updates de la ligne "photos" (scan) + check initial & fallback polling =====
   */
  useEffect(() => {
    if (!currentPhotoId) return;

    // Helper pour appliquer le statut DB sur l'UI
    const applyStatus = (s?: string | null) => {
      if (s === 'confirmed' || s === 'rejected' || s === 'timeout') {
        setScanStatus(s);
      }
      // ('pending' garde l'UI sur "Uploading…")
    };

    const channel = supabase
      .channel(`photos-listener-${currentPhotoId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'photos',
          filter: `id=eq.${currentPhotoId}`,
        },
        (payload: any) => {
          const newStatus = payload?.new?.status as string | undefined;
          console.log('📡 Realtime update — status:', newStatus);
          applyStatus(newStatus);
        }
      )
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Check immédiat : si l'update a eu lieu avant l'abonnement, on ne la rate pas
          try {
            const { data, error } = await supabase
              .from('photos')
              .select('status')
              .eq('id', currentPhotoId)
              .maybeSingle();
            if (!error) {
              console.log('🔎 Initial status check:', data?.status);
              applyStatus(data?.status as string | undefined);
            }
          } catch (err) {
            console.error('Initial status fetch error:', err);
          }
        }
      });

    // Cleanup à la sortie / changement de photo
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentPhotoId, supabase]);

  // Fallback polling pendant "pending" (scan) pour ne pas rester bloqué si Realtime ne pousse pas l’event
  useEffect(() => {
    if (!currentPhotoId || scanStatus !== 'pending') return;

    let stopped = false;
    const interval = window.setInterval(async () => {
      try {
        const { data, error } = await supabase
          .from('photos')
          .select('status')
          .eq('id', currentPhotoId)
          .maybeSingle();
        if (stopped) return;
        const s = data?.status as string | undefined;
        if (!error && s && s !== 'pending') {
          console.log('🕒 Polling resolved — status:', s);
          if (s === 'confirmed' || s === 'rejected' || s === 'timeout') {
            setScanStatus(s);
          }
          window.clearInterval(interval);
        }
      } catch {
        // ignore
      }
    }, 3000);

    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [currentPhotoId, scanStatus, supabase]);

  // ✅ Fallback polling pour Step 8 (SELF): met à jour les slots en "uploading" si le serveur a statué
  useEffect(() => {
    if (step !== 8) return;

    const uploadingDbIds = photos
      .filter((p): p is PhotoItem => !!p && p.status === 'uploading' && !!p.dbId)
      .map((p) => p.dbId!) as string[];

    if (uploadingDbIds.length === 0) return;

    let stopped = false;
    const interval = window.setInterval(async () => {
      try {
        const { data, error } = await supabase
          .from('photos')
          .select('id,status')
          .in('id', uploadingDbIds);

        if (stopped || error || !data) return;

        data.forEach((row: any) => {
          const s = mapServerToUploadStatus(row?.status);
          if (s) {
            setPhotos((prev) =>
              prev.map((p) => (p && p.dbId === row.id ? { ...p, status: s } : p))
            );
          }
        });
      } catch {
        // ignore
      }
    }, 3000);

    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [photos, step, supabase]);

  // ✅ Fallback polling pour Step 9 (PREFERENCE): même logique que Step 8
  useEffect(() => {
    if (step !== 9) return;

    const uploadingDbIds = photosPreference
      .filter((p): p is PhotoItem => !!p && p.status === 'uploading' && !!p.dbId)
      .map((p) => p.dbId!) as string[];

    if (uploadingDbIds.length === 0) return;

    let stopped = false;
    const interval = window.setInterval(async () => {
      try {
        const { data, error } = await supabase
          .from('photos')
          .select('id,status')
          .in('id', uploadingDbIds);

        if (stopped || error || !data) return;

        data.forEach((row: any) => {
          const s = mapServerToUploadStatus(row?.status);
          if (s) {
            setPhotosPreference((prev) =>
              prev.map((p) => (p && p.dbId === row.id ? { ...p, status: s } : p))
            );
          }
        });
      } catch {
        // ignore
      }
    }, 3000);

    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [photosPreference, step, supabase]);

  // ♻️ Cleanup global des canaux SELF à l’unmount
  useEffect(() => {
    return () => {
      Object.values(selfPhotoChannelsRef.current).forEach((ch) => {
        try {
          supabase.removeChannel(ch as any);
        } catch {}
      });
      selfPhotoChannelsRef.current = {};
    };
  }, [supabase]);

  // ♻️ Cleanup global des canaux PREFERENCE à l’unmount
  useEffect(() => {
    return () => {
      Object.values(preferencePhotoChannelsRef.current).forEach((ch) => {
        try {
          supabase.removeChannel(ch as any);
        } catch {}
      });
      preferencePhotoChannelsRef.current = {};
    };
  }, [supabase]);

  
  // === Restore confirmed photos (private buckets with signed URLs) ===
  // Step 8 (self)
  useEffect(() => {
    if (!isAuthed || step !== 8) return;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data, error } = await supabase
          .from('photos')
          .select('id, path')
          .eq('user_id', user.id)
          .eq('photo', 'self')
          .eq('status', 'confirmed')
          .order('id', { ascending: true });
        if (error || !Array.isArray(data)) return;

        const rows = data.slice(0, 6);
        const signed = await Promise.all(
          rows.map(async (row: any) => {
            const { data: s } = await supabase.storage
              .from('photos_user')
              .createSignedUrl(row.path, 3600);
            return { id: row.id, url: s?.signedUrl || '' };
          })
        );

        const arr = Array.from({ length: 6 }, () => null) as (PhotoItem | null)[];
        signed.forEach((it, i) => {
          arr[i] = {
            id: `self-${it.id}`,
            dbId: String(it.id),
            url: it.url,
            progress: 100,
            status: 'confirmed',
          };
        });
        setPhotos(arr);
      } catch {}
    })();
  }, [isAuthed, step, supabase]);

  // Step 9 (preference)
  useEffect(() => {
    if (!isAuthed || step !== 9) return;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data, error } = await supabase
          .from('photos')
          .select('id, path')
          .eq('user_id', user.id)
          .eq('photo', 'preference')
          .eq('status', 'confirmed')
          .order('id', { ascending: true });
        if (error || !Array.isArray(data)) return;

        const rows = data.slice(0, 6);
        const signed = await Promise.all(
          rows.map(async (row: any) => {
            const { data: s } = await supabase.storage
              .from('photos_preference')
              .createSignedUrl(row.path, 3600);
            return { id: row.id, url: s?.signedUrl || '' };
          })
        );

        const arr = Array.from({ length: 6 }, () => null) as (PhotoItem | null)[];
        signed.forEach((it, i) => {
          arr[i] = {
            id: `pref-${it.id}`,
            dbId: String(it.id),
            url: it.url,
            progress: 100,
            status: 'confirmed',
          };
        });
        setPhotosPreference(arr);
      } catch {}
    })();
  }, [isAuthed, step, supabase]);

  // Settings modal (Your photos & Preferences)
  useEffect(() => {
    if (!settingsOpen || !isAuthed) return;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Your photos (self)
        const { data: selfRows } = await supabase
          .from('photos')
          .select('id, path')
          .eq('user_id', user.id)
          .eq('photo', 'self')
          .eq('status', 'confirmed')
          .order('id', { ascending: true });

        if (Array.isArray(selfRows)) {
          const signedSelf = await Promise.all(
            selfRows.slice(0, 6).map(async (row: any) => {
              const { data: s } = await supabase.storage
                .from('photos_user')
                .createSignedUrl(row.path, 3600);
              return { id: row.id, url: s?.signedUrl || '' };
            })
          );
          const arr = Array.from({ length: 6 }, () => null) as (PhotoItem | null)[];
          signedSelf.forEach((it, i) => {
            arr[i] = { id: `self-${it.id}`, dbId: String(it.id), url: it.url, progress: 100, status: 'confirmed' };
          });
          setPhotos(arr);
        }

        // Preferences (preference)
        const { data: prefRows } = await supabase
          .from('photos')
          .select('id, path')
          .eq('user_id', user.id)
          .eq('photo', 'preference')
          .eq('status', 'confirmed')
          .order('id', { ascending: true });

        if (Array.isArray(prefRows)) {
          const signedPref = await Promise.all(
            prefRows.slice(0, 6).map(async (row: any) => {
              const { data: s } = await supabase.storage
                .from('photos_preference')
                .createSignedUrl(row.path, 3600);
              return { id: row.id, url: s?.signedUrl || '' };
            })
          );
          const arr = Array.from({ length: 6 }, () => null) as (PhotoItem | null)[];
          signedPref.forEach((it, i) => {
            arr[i] = { id: `pref-${it.id}`, dbId: String(it.id), url: it.url, progress: 100, status: 'confirmed' };
          });
          setPhotosPreference(arr);
        }
      } catch {}
    })();
  }, [settingsOpen, isAuthed, supabase]);

  // ✅ Persistent match bubble on reload/reconnect (no DB writes)
  useEffect(() => {
    if (!postOnboarding || !isAuthed) return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;
        const res = await fetch('/api/ask?fn=incoming_match', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (json?.hasIncomingMatch) {
          setShowMatchTestBubble(true);
          setLatestMatch({
            match_user_id: json?.match_user_id ?? null,
            match_gender: json?.match_gender ?? null,
            match_age: (json?.match_age != null && Number.isFinite(Number(json.match_age))) ? Number(json.match_age) : null,
            distance_kilometre: (json?.distance_km != null && Number.isFinite(Number(json.distance_km))) ? Number(json.distance_km) : null,
            score_pref_to_self: (json?.score_pref_to_self != null && Number.isFinite(Number(json.score_pref_to_self))) ? Number(json.score_pref_to_self) : null,
          });
        }
        // 🩵 Fallback : si match_user_id n'est pas fourni par l’API, on le récupère depuis Supabase
if (!json?.match_user_id) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: last } = await supabase
        .from('matches')
        .select('match_user_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (last?.match_user_id) {
        setLatestMatch((prev) => ({ ...prev, match_user_id: last.match_user_id }));
      }
    }
  } catch (err) {
    console.error('⚠️ Erreur fallback récupération match_user_id:', err);
  }
}

      } catch {
        // silent
      }
    })();
  }, [postOnboarding, isAuthed, supabase]);

  // ✅ If bubble opens (realtime) but details are missing, fetch the latest match row for details
  useEffect(() => {
    if (!postOnboarding || !isAuthed) return;
    if (!showMatchTestBubble || latestMatch) return;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: m, error: mErr } = await supabase
          .from('matches')
          .select('match_gender, match_age, distance_km, score_pref_to_self')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!mErr && m) {
          setLatestMatch({
            match_gender: (m as any).match_gender ?? null,
            match_age: typeof (m as any).match_age === 'number' ? (m as any).match_age : ((m as any).match_age != null ? Number((m as any).match_age) : null),
            distance_kilometre: typeof (m as any).distance_km === 'number'
            ? (m as any).distance_km
            : ((m as any).distance_km != null ? Number((m as any).distance_km) : null),

            score_pref_to_self: typeof (m as any).score_pref_to_self === 'number' ? (m as any).score_pref_to_self : ((m as any).score_pref_to_self != null ? Number((m as any).score_pref_to_self) : null),
          });
        }
      } catch {}
    })();
  }, [postOnboarding, isAuthed, showMatchTestBubble, latestMatch, supabase]);

// 📸 Charge/Purge les photos du match sélectionné quand la modale s'ouvre
useEffect(() => {
  if (!postOnboarding || !isAuthed) return;
  if (!showMatchGallery) return;

  (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const me = session?.user?.id;
      if (!me || !token) return;

      // 1️⃣ Trouve l'autre utilisateur (B)
      let otherId = latestMatch?.match_user_id ?? null;
      if (!otherId) {
        const { data: last } = await supabase
          .from('matches')
          .select('match_user_id')
          .eq('user_id', me)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        otherId = last?.match_user_id ?? null;
      }
      if (!otherId) return;

      // 2️⃣ Récupère les 6 photos confirmées de l'autre via ton backend sécurisé
      const res = await fetch(`/api/ask?fn=match_photos&id=${otherId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = await res.json();
      if (Array.isArray(json.photos)) {
        setMatchPhotos(json.photos);
        setCurrentMatchPhoto(0);
      } else {
        setMatchPhotos([]);
      }
    } catch (err) {
      console.error('💥 Erreur chargement photos match sécurisé:', err);
      setMatchPhotos([]);
    }
  })();
}, [postOnboarding, isAuthed, showMatchGallery, matchModalTab, latestMatch, supabase]);

// Close match modal with Escape
useEffect(() => {
  if (!showMatchGallery) return;
  const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setShowMatchGallery(false); };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}, [showMatchGallery]);
  // ===== Render =====
  if (isAuthed === null) {
    return (
      <main className="flex items-center justify-center h-screen w-screen bg-[var(--bg)] text-[var(--text)]">
        <div className="opacity-70 text-sm">Loading…</div>
      </main>
    );
  }

  // === Écran de connexion ===
  if (isAuthed === false) {
    return (
      <>
        <main className="flex flex-col items-center justify-center h-screen w-screen bg-[var(--bg)] text-[var(--text)] px-4">
          <Logo className="h-16 w-auto mb-12 fill-black dark:fill-white" />
          <h1 className="text-3xl sm:text-4xl font-semibold text-center leading-snug tracking-tight">
            Sign in to continue
          </h1>
          <button
            onClick={handleGoogleLogin}
            className="mt-10 w-64 h-12 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-lg font-semibold transition-all duration-200 ease-out"
          >
            Sign in with Google
          </button>
          {/* Premium glass button — Phone Auth */}
          <button
            onClick={() => setShowPhoneLogin(true)}
            className="mt-4 w-64 h-12 rounded-xl bg-[color-mix(in srgb,var(--surface-2) 70%,transparent)] border border-[var(--border)] text-[var(--text)] text-lg font-semibold backdrop-blur-[6px] hover:bg-[color-mix(in srgb,var(--surface-2) 90%,white 10%)] transition-all duration-300 ease-out shadow-[0_0_16px_color-mix(in_srgb,var(--accent)_20%,transparent)] hover:shadow-[0_0_24px_color-mix(in_srgb,var(--accent)_40%,transparent)]">
            <span className="bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] text-transparent bg-clip-text">
              Sign in with phone
            </span>
          </button>

          {themeMounted && (
            <button
              onClick={toggleTheme}
              className="absolute bottom-6 right-6 h-10 px-4 rounded-lg border border-[var(--border)] hover:bg-[var(--hover-surface)] flex items-center gap-2 text-sm"
              title="Toggle Light/Dark"
            >
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
              {theme === 'light' ? 'Dark' : 'Light'} mode
            </button>
          )}
        </main>

        {/* === Premium modal for phone auth === */}
        {showPhoneLogin && (() => {
  const canSend = !loadingOtp && isValidPhoneNumber(phone || '');
  const canVerify = !loadingOtp && otp.trim().length >= 4;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[color-mix(in srgb,var(--bg) 65%,transparent)] backdrop-blur-[10px] animate-[fadeIn_0.25s_ease-out]"
      style={{ WebkitBackdropFilter: 'blur(10px)' as any }}
    >
      <div className="relative w-[min(90%,400px)] rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] shadow-[0_12px_48px_color-mix(in_srgb,var(--accent)_25%,transparent)] p-8 text-center animate-[pop-in_0.3s_ease-out]">
        <button
          onClick={() => setShowPhoneLogin(false)}
          className="absolute top-3 right-3 text-[var(--text-muted)] hover:text-[var(--text)] transition"
          aria-label="Close"
        >
          ✕
        </button>

        <h2 className="text-2xl font-semibold mb-2 bg-gradient-to-r from-[var(--accent)] to-[var(--accent-hover)] text-transparent bg-clip-text">
          Sign in with phone
        </h2>
        <p className="text-sm opacity-70 mb-6 auth-transition-enter">
          {otpSent
            ? "Enter the 6-digit code we sent you."
            : "Enter your phone number to get a secure one-time code."}
        </p>

        {!otpSent ? (
          <div className="auth-transition-enter">
            
<PhoneInput
  id="phone"
  international
  country={detectedCountry} /* ✅ pays détecté automatiquement via IP */
  placeholder="Enter your number"
  value={phone || undefined}
  onChange={(v) => setPhone(v || '')}
  /* ✅ Liste visible uniquement au survol : elle s’ouvre quand on passe la souris */
countrySelectProps={{
  tabIndex: -1,
  onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => {
    const select = e.currentTarget.querySelector('select');
    if (select) {
      select.setAttribute('size', '8'); // ✅ ouvre la liste au survol
      select.focus(); // met le focus pour l'effet fluide
    }
  },
  onMouseLeave: (e: React.MouseEvent<HTMLDivElement>) => {
    const select = e.currentTarget.querySelector('select');
    if (select) {
      select.setAttribute('size', '1'); // ✅ referme la liste quand on quitte
      select.blur();
    }
  },
}}

  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !loadingOtp && isValidPhoneNumber(phone || '')) {
      e.preventDefault();
      void sendOtp();
    }
  }}
  aria-invalid={!!phone && !isValidPhoneNumber(phone || '')}
  className="w-full"
  autoFocus
/>

{!isValidPhoneNumber(phone || '') && phone.length > 0 && (
  <div className="mb-1 text-xs text-[var(--danger)] auth-transition-enter">
    Enter a valid phone number (e.g. +XX ••• ••• •••)
  </div>
)}

            <button
              onClick={sendOtp}
              disabled={!canSend}
              className={`mt-2 w-full h-12 rounded-xl text-white text-lg font-semibold transition-all duration-200 ease-out active:phone-button-active ${
                canSend
                  ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] shadow-[0_0_20px_color-mix(in_srgb,var(--accent)_30%,transparent)]'
                  : 'bg-[color-mix(in srgb,var(--surface-2) 85%,white 15%)] text-[var(--text-muted)] cursor-not-allowed'
              }`}
            >
              {loadingOtp ? 'Sending…' : 'Send code'}
            </button>
          </div>
        ) : (
          <div className="auth-transition-enter">
            <input
              type="text"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canVerify) void verifyOtp(); }}
              placeholder="6-digit code"
              className="phone-input w-full h-12 mb-3 rounded-xl border border-[var(--border)] text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition-all duration-200 ease-out"
              maxLength={6}
              autoFocus
            />

            <button
              onClick={verifyOtp}
              disabled={!canVerify}
              className={`mt-2 w-full h-12 rounded-xl text-white text-lg font-semibold transition-all duration-200 ease-out active:phone-button-active ${
                canVerify
                  ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] shadow-[0_0_20px_color-mix(in_srgb,var(--accent)_30%,transparent)]'
                  : 'bg-[color-mix(in srgb,var(--surface-2) 85%,white 15%)] text-[var(--text-muted)] cursor-not-allowed'
              }`}
            >
              {loadingOtp ? 'Verifying…' : 'Verify code'}
            </button>

            <button
              onClick={() => { setOtpSent(false); setOtp(''); }}
              className="mt-4 text-sm text-[var(--accent)] hover:underline transition-all duration-150"
            >
              Change number
            </button>
          </div>
        )}

        {otpError && (
          <div className="mt-3 text-sm text-[var(--danger)] font-medium auth-transition-enter">
            {otpError}
          </div>
        )}

        <div className="mt-5 text-xs opacity-70 auth-transition-enter">
          Powered by <span className="text-[var(--accent)] font-semibold">AI Identity Verification</span>
        </div>
      </div>
    </div>
  );
})()}
      </>
    );
  }

  
  // Avoid flashing step 1 before step_index is loaded
  if (isAuthed === true && !stepLoaded) {
    return (
      <main className="flex items-center justify-center h-screen w-screen bg-[var(--bg)] text-[var(--text)]">
        <div className="opacity-70 text-sm">Loading…</div>
      </main>
    );
  }
// === Flow authentifié ===
  return (
    <main className="relative flex flex-col items-center justify-center h-screen w-screen bg-[var(--bg)] text-[var(--text)] px-4 overflow-visible">
      {/* Logo compact */}
      <div className="absolute top-6 left-6 z-[40]">
        <Logo className="h-10 w-auto fill-black dark:fill-white" />
      </div>

      {/* Step 1: Date of birth */}
      {step === 1 && (
        <>
          <h1 className="text-3xl sm:text-4xl font-semibold text-center leading-snug tracking-tight">
            What’s your date of birth?
          </h1>

          <div className="mt-2 text-sm opacity-70">
            {loadingYear && 'Syncing server time…'}
            {!loadingYear && serverYear == null && 'Server time unavailable'}
          </div>

          <div className="mt-4 w-full max-w-3xl grid grid-cols-[1fr_auto_1fr_auto_1fr] gap-4 sm:gap-6">
            <DropdownPicker
              ariaLabel="Day"
              placeholder="Day"
              items={days}
              valueIndex={dayIdx}
              onChange={(v)=>{ setDayIdx(v); }}
              heightPx={56}
            />
            <Slash />
            <DropdownPicker
              ariaLabel="Month"
              placeholder="Month"
              items={months}
              valueIndex={monthIdx}
              onChange={(v)=>{ setMonthIdx(v); }}
              heightPx={56}
            />
            <Slash />
            <DropdownPicker
              ariaLabel="Year"
              placeholder="Year"
              items={years}
              valueIndex={yearIdx}
              onChange={(v)=>{ setYearIdx(v); }}
              heightPx={56}
            />
          </div>

          <button
            disabled={!hasValidDate}
            onClick={async () => {
              if (!hasValidDate || !yearVal || !monthVal || !dayVal) return;

              const birthdate = `${yearVal}-${String(monthVal).padStart(2, '0')}-${String(dayVal).padStart(2, '0')}`;

              const {
                data: { session },
              } = await supabase.auth.getSession();
              const token = session?.access_token;

              if (!token) return;

              await fetch('/api/ask', {
                method: 'PATCH',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ birthdate }),
              });

              goToStep(2);
            }}
            className={[
              'mt-6 w-64 h-12 rounded-xl text-white text-lg font-semibold transition',
              hasValidDate
                ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'
                : 'bg-[color-mix(in srgb, var(--surface-2) 85%, white 15%)] text-[var(--text-muted)] cursor-not-allowed',
            ].join(' ')}
          >
            Next
          </button>
        </>
      )}

      {/* Step 2: Orientation */}
      {step === 2 && (
        <>
          <h1 className="text-3xl sm:text-4xl font-semibold text-center leading-snug tracking-tight">
            What’s your orientation?
          </h1>

          <div className="mt-8 w-full max-w-3xl grid grid-cols-1 gap-6">
            <div>
              <label className="block mb-2 text-lg font-medium">I am:</label>
              <DropdownPicker
                ariaLabel="Gender"
                placeholder="Select…"
                items={genders}
                valueIndex={genderIdx}
                onChange={setGenderIdx}
                heightPx={56}
              />
            </div>

            <div>
              <label className="block mb-2 text-lg font-medium">Looking for:</label>
              <DropdownPicker
                ariaLabel="Preference"
                placeholder="Select…"
                items={preferences}
                valueIndex={preferenceIdx}
                onChange={setPreferenceIdx}
                heightPx={56}
              />
            </div>
          </div>

          <div className="mt-8 flex justify-between gap-4 w-full max-w-3xl">
            <button
              onClick={() => goToStep(1)}
              className="w-1/2 h-12 rounded-xl border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover-surface)] font-medium transition"
            >
              Back
            </button>

            <button
              disabled={!hasOrientation}
              onClick={async () => {
                if (genderIdx == null || preferenceIdx == null) return;

                const genderLabel = genders[genderIdx] as GenderUILabel;       // 'Man' | 'Woman'
                const prefLabel   = preferences[preferenceIdx] as PrefUILabel; // 'Man' | 'Woman' | 'Both'

                // → codes normalisés pour la DB
                const gender = GENDER_CODE[genderLabel];                       // 'man' | 'woman'
                const orientation_preference = PREF_CODE[prefLabel];           // 'seek_man' | 'seek_woman' | 'seek_both'

                const {
                  data: { session },
                } = await supabase.auth.getSession();
                const token = session?.access_token;
                if (!token) return;

                await fetch('/api/ask', {
                  method: 'PATCH',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ gender, orientation_preference }),
                });

                goToStep(3);
              }}
              className={[
                'w-1/2 h-12 rounded-xl text-white font-medium transition',
                hasOrientation
                  ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'
                  : 'bg-[color-mix(in srgb, var(--surface-2) 85%, white 15%)] text-[var(--text-muted)] cursor-not-allowed',
              ].join(' ')}
            >
              Next
            </button>
          </div>
        </>
      )}

      {/* Step 3: Age range */}
      {step === 3 && (
        <>
          <h1 className="text-3xl sm:text-4xl font-semibold text-center leading-snug tracking-tight">
            What age range are you looking for?
          </h1>

          <div className="w-full max-w-3xl mx-auto mt-8">
            <Range
              values={ageRange}
              step={1}
              min={RANGE_MIN}
              max={RANGE_MAX}
              onChange={(vals) => setAgeRange(vals)}
              renderTrack={({ props, children }) => {
                const { key, ...rest } = (props as any);
                return (
                  <div
                    key={key}
                    {...rest}
                    className="h-2 rounded-full"
                    style={{
                      ...rest.style,
                      background: `linear-gradient(
                        to right,
                        var(--border) 0%,
                        var(--border) ${pctLeft}%,
                        var(--accent) ${pctLeft}%,
                        var(--accent) ${pctRight}%,
                        var(--border) ${pctRight}%,
                        var(--border) 100%
                      )`,
                    }}
                  >
                    {children}
                  </div>
                );
              }}
              renderThumb={({ props }) => {
                const { key, ...rest } = (props as any);
                return (
                  <div
                    key={key}
                    {...rest}
                    className="w-5 h-5 rounded-full border border-[var(--border)]"
                    style={{ ...rest.style, backgroundColor: 'var(--bg)' }}
                  />
                );
              }}
            />

            <div className="mt-4 text-center text-lg">
              From <span className="font-semibold">{ageRange[0]}</span> to{' '}
              <span className="font-semibold">{ageRange[1]}</span>
            </div>
          </div>

          <div className="mt-8 flex justify-between gap-4 w-full max-w-3xl">
            <button
              onClick={() => goToStep(2)}
              className="w-1/2 h-12 rounded-xl border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover-surface)] font-medium transition"
            >
              Back
            </button>
            <button
              disabled={!hasAgeRange}
              onClick={async () => {
                if (!hasAgeRange) return;

                const [age_min, age_max] = ageRange;

                const {
                  data: { session },
                } = await supabase.auth.getSession();
                const token = session?.access_token;
                if (!token) return;

                await fetch('/api/ask', {
                  method: 'PATCH',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ age_min, age_max }),
                });

                goToStep(4);
              }}
              className={[
                'w-1/2 h-12 rounded-xl text-white font-medium transition',
                hasAgeRange
                  ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'
                  : 'bg-[color-mix(in srgb, var(--surface-2) 85%, white 15%)] text-[var(--text-muted)] cursor-not-allowed',
              ].join(' ')}
            >
              Next
            </button>
          </div>
        </>
      )}

      {/* Step 4: Distance + Geolocation */}
      {step === 4 && (
        <>
          <h1 className="text-3xl sm:text-4xl font-semibold text-center leading-snug tracking-tight">
            How far are you willing to go to find love?
          </h1>

          <div className="w-full max-w-3xl mx-auto mt-8">
            <Range
              values={[currentIdx]}
              step={1}
              min={0}
              max={distanceSteps.length - 1}
              onChange={([idx]) => {
                setCurrentIdx(idx);
                setDistanceMax(distanceSteps[idx]);
              }}
              renderTrack={({ props, children }) => {
                const { key, ...rest } = (props as any);
                return (
                  <div
                    key={key}
                    {...rest}
                    className="h-2 rounded-full"
                    style={{
                      ...rest.style,
                      background: getTrackBackground({
                        values: [currentIdx],
                        colors: ['var(--accent)', 'var(--border)'],
                        min: 0,
                        max: distanceSteps.length - 1,
                      }),
                    }}
                  >
                    {children}
                  </div>
                );
              }}
              renderThumb={({ props }) => {
                const { key, ...rest } = (props as any);
                return (
                  <div
                    key={key}
                    {...rest}
                    className="w-5 h-5 rounded-full border border-[var(--border)]"
                    style={{ ...rest.style, backgroundColor: 'var(--bg)' }}
                  />
                );
              }}
            />

            <div className="mt-4 text-center text-lg">
              {distanceMax === DIST_NO_LIMIT ? (
                <span className="font-semibold">No distance limit</span>
              ) : (
                <>
                  Within <span className="font-semibold">{distanceMax} km</span>
                </>
              )}
            </div>

            {/* —— Bloc géolocalisation, juste sous "Within X km" */}
            <div className="mt-6 w-full max-w-3xl mx-auto">
              <div className="p-4 rounded-2xl border border-[var(--border)] bg-[var(--bg)] flex items-center justify-between gap-4">
                <div className="text-left">
                  <div className="font-medium">Use your location</div>
                  <div className="text-sm opacity-70">
                    Enable this to let your AI personalize matches based on your current position.
                  </div>
                </div>

                {/* Switch premium */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={geoEnabled}
                  aria-label="Enable location"
                  disabled={geoBusy || geoLockedOn}
                  onClick={handleLocationToggle}
                  className={[
                    'relative w-14 h-8 rounded-full border transition-colors select-none',
                    geoEnabled
                      ? 'border-[var(--accent)] bg-[var(--bg)]'
                      : 'border-[var(--border)] bg-[var(--bg)]',
                    geoBusy ? 'opacity-70 cursor-wait' : (geoLockedOn ? 'cursor-not-allowed' : 'cursor-pointer'),
                  ].join(' ')}
                >
                  {/* Knob / loader */}
                  {geoBusy ? (
                    <div
                      className="absolute inset-0 flex items-center justify-center text-[var(--accent)]"
                      aria-hidden
                    >
                      <Loader2 className="animate-spin" size={16} />
                    </div>
                  ) : (
                    <span
                      aria-hidden
                      className="absolute top-1 left-1 w-6 h-6 rounded-full shadow-sm border border-[var(--border)] transition-transform"
                      style={{
                        background: geoEnabled ? 'var(--accent)' : 'var(--bg)',
                        transform: geoEnabled ? 'translateX(24px)' : 'translateX(0px)',
                      }}
                    />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-8 flex justify-between gap-4 w-full max-w-3xl">
            <button
              onClick={() => goToStep(3)}
              className="w-1/2 h-12 rounded-xl border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover-surface)] font-medium transition"
            >
              Back
            </button>
            <button
              disabled={!geoEnabled}
              onClick={async () => {
                if (!geoEnabled || !geoCoords) return;

                const {
                  data: { session },
                } = await supabase.auth.getSession();
                const token = session?.access_token;
                if (!token) return;

                await fetch('/api/ask', {
                  method: 'PATCH',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    distance_max_km: distanceMax,
                    location: {
                      lat: geoCoords.lat,
                      lng: geoCoords.lng,
                      accuracy: geoCoords.accuracy,
                      source: 'browser',
                    },
                  }),
                });

                goToStep(5);
              }}
              className={[
                'w-1/2 h-12 rounded-xl text-white font-medium transition',
                geoEnabled
                  ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'
                  : 'bg-[color-mix(in srgb, var(--surface-2) 85%, white 15%)] text-[var(--text-muted)] cursor-not-allowed',
              ].join(' ')}
            >
              Next
            </button>
          </div>
        </>
      )}

      {/* Step 5: Relationship Type */}
      {step === 5 && (
        <>
          <h1 className="text-3xl sm:text-4xl font-semibold text-center leading-snug tracking-tight">
            What are you looking for?
          </h1>

          <div className="mt-10 grid gap-6 w-full max-w-3xl md:grid-cols-3">
            {[
              {
                icon: '💍',
                title: 'Long-term serious relationship.',
                description: 'Looking for something meaningful, stable, and long-term.',
                value: 'serious' as const,
              },
              {
                icon: '🤔',
                title: 'Open / Depends on the person',
                description: 'I prefer to stay open. It depends on the connection and the vibe.',
                value: 'open' as const,
              },
              {
                icon: '🎉',
                title: 'Just fun, dating or friends',
                description:
                  'Here for casual vibes, flirting, short-term dating, and fun experiences.',
                value: 'casual' as const,
              },
            ].map((option) => {
              const selected = relationshipType === option.value;
              return (
                <button
                  key={option.value}
                  onClick={() => setRelationshipType(option.value)}
                  aria-pressed={selected}
                  className={[
                    'p-6 rounded-2xl border transition text-left shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]',
                    selected
                      ? 'border-[var(--accent)] bg-[var(--hover-surface)]'
                      : 'border-[var(--border)] hover:bg-[var(--hover-surface)] hover:shadow-md',
                  ].join(' ')}
                >
                  <div className="text-4xl mb-3">{option.icon}</div>
                  <div className="font-semibold text-lg mb-1">{option.title}</div>
                  <div className="text-sm opacity-70 leading-snug">{option.description}</div>
                </button>
              );
            })}
          </div>

          <div className="mt-10 flex justify-between gap-4 w-full max-w-3xl">
            <button
              onClick={() => goToStep(4)}
              className="w-1/2 h-12 rounded-xl border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover-surface)] font-medium transition"
            >
              Back
            </button>
            <button
              disabled={!relationshipType}
              onClick={async () => {
                if (!relationshipType) return;

                const {
                  data: { session },
                } = await supabase.auth.getSession();
                const token = session?.access_token;
                if (!token) return;

                await fetch('/api/ask', {
                  method: 'PATCH',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ relationship: relationshipType }),
                });

                goToStep(6);
              }}
              className={[
                'w-1/2 h-12 rounded-xl text-white font-medium transition',
                relationshipType
                  ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'
                  : 'bg-[color-mix(in srgb, var(--surface-2) 85%, white 15%)] text-[var(--text-muted)] cursor-not-allowed',
              ].join(' ')}
            >
              Next
            </button>
          </div>
        </>
      )}

      {/* Step 6: Scan info */}
      {step === 6 && (
        <>
          <h1 className="text-3xl sm:text-4xl font-semibold text-center leading-snug tracking-tight">
            Get ready to scan your face
          </h1>

          <div className="w-full flex justify-center">
            <FaceScanVisual className="max-w-[220px] sm:max-w-sm mt-4 mb-2" />
          </div>

          <div className="max-w-xl text-center text-base sm:text-lg opacity-90 leading-relaxed space-y-4">
            <p>Quick face scan to verify your identity.</p>
            <p><strong>No photo is stored</strong>. It's deleted instantly after analysis.</p>
            <p>This keeps profiles authentic and trusted, powered by real AI.</p>
          </div>

          <div className="mt-8 flex justify-between gap-4 w-full max-w-3xl">
            <button
              onClick={() => goToStep(5)}
              className="w-1/2 h-12 rounded-xl border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover-surface)] font-medium transition"
            >
              Back
            </button>
            <button
              onClick={() => {
                setScanStatus('idle');
                goToStep(7);
              }}
              className="w-1/2 h-12 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium transition"
            >
              I’m ready to start scan
            </button>
          </div>
        </>
      )}

      {/* Step 7: Webcam + Upload + Feedback */}
      {step === 7 && (
        <>
          <div className="w-full max-w-3xl mx-auto">
            {scanStatus === 'idle' && (
  <>
    {isPortrait == null ? (
      <div className="w-full flex items-center justify-center py-8 opacity-70">
        Initializing camera…
      </div>
    ) : isPortrait ? (
      <AutoFaceScannerPortrait
        onCapture={async ({ blob }) => {
          try {
            setScanStatus('pending');
            const { data: { session } } = await supabase.auth.getSession();
            const user = session?.user;
            if (!user) { setScanStatus('timeout'); return; }

            const { data: inserted, error: insertError } = await supabase
              .from('photos')
              .insert({ user_id: user.id, photo: 'scan', path: 'pending', vectorized: false, status: 'pending' })
              .select('id')
              .single();
            if (insertError || !inserted?.id) { setScanStatus('timeout'); return; }

            const photoId = inserted.id;
            setCurrentPhotoId(photoId);

            const path = `${photoId}.jpg`;
            const { error: uploadError } = await supabase.storage
              .from('photo_scan')
              .upload(path, blob, { contentType: 'image/jpeg', upsert: false });

            if (uploadError) {
              await supabase.from('photos').delete().eq('id', photoId);
              setScanStatus('timeout');
              return;
            }

            const { error: updateErr } = await supabase
              .from('photos')
              .update({ path })
              .eq('id', photoId);

            if (updateErr) { setScanStatus('timeout'); return; }
          } catch {
            setScanStatus('timeout');
          }
        }}
      />
    ) : (
      <AutoFaceScannerLandscape
        onCapture={async ({ blob }) => {
          try {
            setScanStatus('pending');
            const { data: { session } } = await supabase.auth.getSession();
            const user = session?.user;
            if (!user) { setScanStatus('timeout'); return; }

            const { data: inserted, error: insertError } = await supabase
              .from('photos')
              .insert({ user_id: user.id, photo: 'scan', path: 'pending', vectorized: false, status: 'pending' })
              .select('id')
              .single();
            if (insertError || !inserted?.id) { setScanStatus('timeout'); return; }

            const photoId = inserted.id;
            setCurrentPhotoId(photoId);

            const path = `${photoId}.jpg`;
            const { error: uploadError } = await supabase.storage
              .from('photo_scan')
              .upload(path, blob, { contentType: 'image/jpeg', upsert: false });

            if (uploadError) {
              await supabase.from('photos').delete().eq('id', photoId);
              setScanStatus('timeout');
              return;
            }

            const { error: updateErr } = await supabase
              .from('photos')
              .update({ path })
              .eq('id', photoId);

            if (updateErr) { setScanStatus('timeout'); return; }
          } catch {
            setScanStatus('timeout');
          }
        }}
      />
    )}

    <div className="mt-8 flex justify-start gap-4 w-full max-w-3xl">
      <button
        onClick={() => goToStep(6)}
        className="w-1/2 h-12 rounded-xl border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover-surface)] font-medium transition"
      >
        Back
      </button>
    </div>
  </>
)}

            {scanStatus === 'pending' && (
              <div className="flex flex-col items-center gap-4 text-[var(--accent)]">
                <Loader2 className="animate-spin" size={48} />
                <div className="text-lg">Uploading…</div>
              </div>
            )}

            {scanStatus === 'confirmed' && (
              <div className="flex flex-col items-center gap-4 text-[var(--success)]">
                <CheckCircle size={64} />
                <div className="text-xl font-semibold">Verified</div>
                <button
                  onClick={() => goToStep(8)}
                  className="mt-2 px-6 py-2 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium"
                >
                  Next
                </button>
              </div>
            )}

            {scanStatus === 'rejected' && (
              <div className="flex flex-col items-center gap-4 text-[var(--danger)]">
                <XCircle size={64} />
                <div className="text-xl font-semibold">Rejected. Please try again.</div>
                <button
                  onClick={() => setScanStatus('idle')}
                  className="mt-2 px-6 py-2 rounded-xl border border-[var(--border)] hover:bg-[var(--hover-surface)]"
                >
                  Retry
                </button>
              </div>
            )}

            {scanStatus === 'timeout' && (
              <div className="flex flex-col items-center gap-4 text-[var(--warning)]">
                <AlertTriangle size={64} />
                <div className="text-xl font-semibold">Timeout. Please try again.</div>
                <button
                  onClick={() => setScanStatus('idle')}
                  className="mt-2 px-6 py-2 rounded-xl border border-[var(--border)] hover:bg-[var(--hover-surface)]"
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Step 8: Upload 6 personal photos */}
      {step === 8 && (
        <div className="w-full max-w-7xl mx-auto">
          <div className="text-3xl sm:text-4xl font-semibold text-center leading-snug tracking-tight">
            What do you actually look like?
          </div>
          <div className="mt-2 text-sm opacity-70 text-center">
            Upload your 6 best photos — the real you. This helps your AI match you with people who’ll actually get your vibe.
          </div>

          {/* ⬇️ MODIF: colonnes fixes 2 → 3 → 6, tuiles 200px */}
          <div className="mt-8 grid gap-4 justify-center grid-cols-[repeat(2,200px)] sm:grid-cols-[repeat(3,200px)] xl:grid-cols-[repeat(6,200px)]">
            {Array.from({ length: 6 }).map((_, idx) => {
              const p = photos[idx];

              const borderColor =
                p?.status === 'confirmed'
                  ? 'var(--success)'
                  : p?.status === 'rejected'
                  ? 'var(--danger)'
                  : p?.status === 'duplicate' || p?.status === 'timeout'
                  ? 'var(--warning)'
                  : 'var(--border)';

              return (
                <div
                  key={idx}
                  className="relative group"
                  style={{ aspectRatio: '3 / 4' }}
                >
                  <div
                    className={`absolute inset-0 rounded-xl border ${p ? 'border-solid' : 'border-dashed'} overflow-hidden transition-colors duration-150 group-hover:bg-[var(--hover-surface)]`}
                    style={{ borderColor }}
                  >
                    {!p && null}

                    {p && (
                      <>
                        <img
                          src={p.url}
                          alt="photo"
                          className="absolute inset-0 w-full h-full object-cover"
                        />

                        {p.status === 'uploading' && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <ProgressRing value={p.progress} />
                          </div>
                        )}

                        {p.status !== 'uploading' && (
                          <>
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center px-2 text-center">
                              {p.status === 'confirmed' && (
                                <div className="text-sm font-medium text-[var(--success)]">Verified</div>
                              )}
                              {p.status === 'rejected' && (
                                <div className="text-sm font-medium text-[var(--danger)]">Doesn’t match your identity</div>
                              )}
                              {p.status === 'duplicate' && (
                                <div className="text-sm font-medium text-[var(--warning)]">Already uploaded</div>
                              )}
                              {p.status === 'timeout' && (
                                <div className="text-sm font-medium text-[var(--warning)]">Timeout. Please try again.</div>
                              )}
                            </div>

                            <div className="absolute bottom-2 right-2">
                              {p.status === 'confirmed' && <CheckCircle size={20} color="var(--success)" />}
                              {p.status === 'rejected' && <XCircle size={22} color="var(--danger)" />}
                              {(p.status === 'duplicate' || p.status === 'timeout') && (
                                <AlertTriangle size={20} color="var(--warning)" />
                              )}
                            </div>
                          </>
                        )}

                        <button
                          onClick={() => handleDeletePhoto(idx)}
                          className="absolute top-1 right-1 bg-black/60 rounded-full px-2 leading-none text-sm"
                          aria-label="Remove photo"
                          title="Remove"
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </div>

                  {!p && (
                    <label className="absolute top-0 left-0 bottom-[-8px] right-[-8px] cursor-pointer">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handlePhotoUpload(file, idx);
                        }}
                      />
                      <div className="pointer-events-none absolute bottom-[3px] right-[3px] w-[22px] h-[22px] rounded-full bg-[var(--accent)] text-white flex items-center justify-center text-[18px] shadow-sm transition-colors duration-150 group-hover:bg-[var(--accent-hover)]">
                       +
                      </div>
                    </label>
                  )}
                </div>
              );
            })}
          </div>

          <button
            disabled={!allConfirmed}
            onClick={() => goToStep(9)}
            className={[
              'mt-8 w-full sm:w-64 h-12 rounded-xl text-white text-lg font-semibold transition',
              allConfirmed
                ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'
                : 'bg-[color-mix(in srgb, var(--surface-2) 85%, white 15%)] text-[var(--text-muted)] cursor-not-allowed',
            ].join(' ')}
          >
            Next
          </button>
        </div>
      )}

      {/* Step 9: Upload 6 preference photos + strictness */}
      {step === 9 && (
        <div className="w-full max-w-7xl mx-auto">
          <h1 className="text-3xl sm:text-4xl font-semibold text-center leading-snug tracking-tight">
            What kind of vibes are you into?
          </h1>
          <div className="mt-2 text-sm opacity-70 text-center">
            Upload 6 looks you find attractive. These help your AI match you with your type.
          </div>

          <div className="w-full max-w-3xl mx-auto mt-8">
            <Range
              values={[strictnessLevel]}
              step={1}
              min={1}
              max={3}
              onChange={([val]) => setStrictnessLevel(val)}
              renderTrack={({ props, children }) => {
                const { key, ...rest } = (props as any);
                return (
                  <div
                    key={key}
                    {...rest}
                    className="h-2 rounded-full"
                    style={{
                      ...rest.style,
                      background: `linear-gradient(
                        to right,
                        var(--accent) 0%,
                        var(--accent) ${strictnessPct}%,
                        var(--border) ${strictnessPct}%,
                        var(--border) 100%
                      )`,
                    }}
                  >
                    {children}
                  </div>
                );
              }}
              renderThumb={({ props }) => {
                const { key, ...rest } = (props as any);
                return (
                  <div
                    key={key}
                    {...rest}
                    className="w-5 h-5 rounded-full border border-[var(--border)]"
                    style={{ ...rest.style, backgroundColor: 'var(--bg)' }}
                  />
                );
              }}
            />

            <div className="mt-4 text-center text-lg">
              <span className="font-semibold">{strictnessCopy.title}</span>
              <span className="opacity-80"> — {strictnessCopy.desc}</span>
            </div>
          </div>

          {/* ⬇️ MODIF: colonnes fixes 2 → 3 → 6, tuiles 200px */}
          <div className="mt-8 grid gap-4 justify-center grid-cols-[repeat(2,200px)] sm:grid-cols-[repeat(3,200px)] xl:grid-cols-[repeat(6,200px)]">
            {Array.from({ length: 6 }).map((_, idx) => {
              const p = photosPreference[idx];

              const borderColor =
                p?.status === 'confirmed'
                  ? 'var(--success)'
                  : p?.status === 'rejected'
                  ? 'var(--danger)'
                  : p?.status === 'duplicate' || p?.status === 'timeout'
                  ? 'var(--warning)'
                  : 'var(--border)';

              return (
                <div
                  key={idx}
                  className="relative group"
                  style={{ aspectRatio: '3 / 4' }}
                >
                  <div
                    className={`absolute inset-0 rounded-xl border ${p ? 'border-solid' : 'border-dashed'} overflow-hidden transition-colors duration-150 group-hover:bg-[var(--hover-surface)]`}
                    style={{ borderColor }}
                  >
                    {!p && null}

                    {p && (
                      <>
                        <img
                          src={p.url}
                          alt="preference photo"
                          className="absolute inset-0 w-full h-full object-cover"
                        />

                        {p.status === 'uploading' && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <ProgressRing value={p.progress} />
                          </div>
                        )}

                        {p.status !== 'uploading' && (
                          <>
                            {/* ✅ Messages identiques à l'étape 8 */}
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center px-2 text-center">
                              {p.status === 'confirmed' && (
                                <div className="text-sm font-medium text-[var(--success)]">Verified</div>
                              )}
                              {p.status === 'rejected' && (
                                <div className="text-sm font-medium text-[var(--danger)]">Already uploaded as your own photo</div>
                              )}
                              {p.status === 'duplicate' && (
                                <div className="text-sm font-medium text-[var(--warning)]">Already uploaded</div>
                              )}
                              {p.status === 'timeout' && (
                                <div className="text-sm font-medium text-[var(--warning)]">Timeout. Please try again.</div>
                              )}
                            </div>

                            <div className="absolute bottom-2 right-2">
                              {p.status === 'confirmed' && <CheckCircle size={20} color="var(--success)" />}
                              {p.status === 'rejected' && <XCircle size={22} color="var(--danger)" />}
                              {(p.status === 'duplicate' || p.status === 'timeout') && (
                                <AlertTriangle size={20} color="var(--warning)" />
                              )}
                            </div>
                          </>
                        )}

                        <button
                          onClick={() => handleDeletePreference(idx)}
                          className="absolute top-1 right-1 bg-black/60 rounded-full px-2 leading-none text-sm"
                          aria-label="Remove photo"
                          title="Remove"
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </div>

                  {!p && (
                    <label className="absolute top-0 left-0 bottom-[-8px] right-[-8px] cursor-pointer">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handlePreferenceUpload(file, idx);
                        }}
                      />
                      <div className="pointer-events-none absolute bottom-[3px] right-[3px] w-[22px] h-[22px] rounded-full bg-[var(--accent)] text-white flex items-center justify-center text-[18px] shadow-sm transition-colors duration-150 group-hover:bg-[var(--accent-hover)]">
                        +
                      </div>
                    </label>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-8 flex justify-between gap-4 w-full max-w-3xl mx-auto">
            <button
              onClick={() => goToStep(8)}
              className="w-1/2 h-12 rounded-xl border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover-surface)] font-medium transition"
            >
              Back
            </button>
            <button
              disabled={!allPrefConfirmed}
              onClick={async () => {
                if (!allPrefConfirmed) return;
                try {
                  const { data: { session } } = await supabase.auth.getSession();
                  const token = session?.access_token;
                  if (token) {
                    await fetch('/api/ask', {
                      method: 'PATCH',
                      headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({ strictness_level: strictnessLevel }), // 1|2|3
                    });
                  }
                } catch {
                  // pas bloquant pour passer à l'étape 10
                } finally {
                  goToStep(10);
                }
              }}
              className={[
                'w-1/2 h-12 rounded-xl text-white font-medium transition',
                allPrefConfirmed
                  ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'
                  : 'bg-[color-mix(in srgb, var(--surface-2) 85%, white 15%)] text-[var(--text-muted)] cursor-not-allowed',
              ].join(' ')}
            >
              Finish
            </button>
          </div>
        </div>
      )}

      {/* Step 10: Page vide avec le symbole du logo centré */}
      {step === 10 && !showMatchTestBubble && (
  <div className="relative w-full h-full flex flex-col items-center justify-center select-none px-4 overflow-hidden">
    {/* Radar background pulse */}
    <div className="absolute w-[80vmin] h-[80vmin] rounded-full bg-[var(--accent)] opacity-10 animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite]" />

    {/* Central Logo */}
    <div className="relative z-10 flex flex-col items-center justify-center">
      <Logo symbolOnly className="h-[28vmin] w-auto fill-black dark:fill-white drop-shadow-[0_0_0px_var(--accent)] animate-[pulse_2s_ease-in-out_infinite]" />
      <p className="mt-6 text-[var(--text-muted)] text-sm tracking-wide uppercase animate-[fadeIn_2s_ease-in-out_infinite]">
        Searching for your perfect match…
      </p>
    </div>

    {/* Keyframes */}
  </div>
)}

      {/* ---------- Settings Modal (post-onboarding) ---------- */}
      {settingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          {/* backdrop (no click to close) */}
          <div className="absolute inset-0 bg-[color-mix(in srgb, var(--bg) 30%, transparent)] backdrop-blur-[3px]" style={{ WebkitBackdropFilter: 'blur(3px)'  as any}} />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-[101] w-[min(100%,1000px)] h-[min(85vh,680px)] rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-xl overflow-hidden flex"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sidebar */}
            <aside className="w-56 shrink-0 border-r border-[var(--border)] p-3 flex flex-col justify-center">
              
              <nav className="space-y-1">
                <SideTabButton active={settingsTab === 'orientation'} onClick={() => setSettingsTab('orientation')}>Orientation</SideTabButton>
                <SideTabButton active={settingsTab === 'age'} onClick={() => setSettingsTab('age')}>Age range</SideTabButton>
                <SideTabButton active={settingsTab === 'distance'} onClick={() => setSettingsTab('distance')}>Distance & location</SideTabButton>
                <SideTabButton active={settingsTab === 'relationship'} onClick={() => setSettingsTab('relationship')}>Relationship</SideTabButton>
                <SideTabButton active={settingsTab === 'photos'} onClick={() => setSettingsTab('photos')}>Your photos</SideTabButton>
                <SideTabButton active={settingsTab === 'preferences'} onClick={() => setSettingsTab('preferences')}>Preferences</SideTabButton>
              </nav>
            </aside>

            {/* Content */}
            <section className="flex-1 flex flex-col">
              <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                {settingsTab === 'orientation' && (
                  <div className="max-w-xl mx-auto">
                    <div className="mb-4">
                      <div className="text-lg font-semibold mb-2">Orientation</div>
                      <div className="text-sm opacity-70">Update who you are and who you’re interested in.</div>
                    </div>
                    <div className="grid gap-6">
                      <div>
                        <label className="block mb-2 text-sm font-medium">I am:</label>
                        <DropdownPicker
                          ariaLabel="Gender"
                          placeholder="Select…"
                          items={genders}
                          valueIndex={draftGenderIdx}
                          onChange={(v) => { setDraftGenderIdx(v); markDirty(); }}
                          heightPx={48}
                        />
                      </div>
                      <div>
                        <label className="block mb-2 text-sm font-medium">Looking for:</label>
                        <DropdownPicker
                          ariaLabel="Preference"
                          placeholder="Select…"
                          items={preferences}
                          valueIndex={draftPreferenceIdx}
                          onChange={(v) => { setDraftPreferenceIdx(v); markDirty(); }}
                          heightPx={48}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {settingsTab === 'age' && (
                  <div className="max-w-xl mx-auto">
                    <div className="mb-4">
                      <div className="text-lg font-semibold mb-2">Age range</div>
                      <div className="text-sm opacity-70">Keep it tight or open it up — your call.</div>
                    </div>
                    <Range
                      values={draftAgeRange}
                      step={1}
                      min={RANGE_MIN}
                      max={RANGE_MAX}
                      onChange={(vals) => { setDraftAgeRange(vals); markDirty(); }}
                      renderTrack={({ props, children }) => {
                        const { key, ...rest } = (props as any);
                        const left = ((draftAgeRange[0] - RANGE_MIN) / (RANGE_MAX - RANGE_MIN)) * 100;
                        const right = ((draftAgeRange[1] - RANGE_MIN) / (RANGE_MAX - RANGE_MIN)) * 100;
                        return (
                          <div
                            key={key}
                            {...rest}
                            className="h-2 rounded-full"
                            style={{
                              ...rest.style,
                              background: `linear-gradient(
                                to right,
                                var(--border) 0%,
                                var(--border) ${left}%,
                                var(--accent) ${left}%,
                                var(--accent) ${right}%,
                                var(--border) ${right}%,
                                var(--border) 100%
                              )`,
                            }}
                          >
                            {children}
                          </div>
                        );
                      }}
                      renderThumb={({ props }) => {
                        const { key, ...rest } = (props as any);
                        return (
                          <div
                            key={key}
                            {...rest}
                            className="w-5 h-5 rounded-full border border-[var(--border)]"
                            style={{ ...rest.style, backgroundColor: 'var(--bg)' }}
                          />
                        );
                      }}
                    />
                    <div className="mt-3 text-sm">
                      From <span className="font-semibold">{draftAgeRange[0]}</span> to{' '}
                      <span className="font-semibold">{draftAgeRange[1]}</span>
                    </div>
                  </div>
                )}

                {settingsTab === 'distance' && (
                  <div className="max-w-xl mx-auto">
                    <div className="mb-4">
                      <div className="text-lg font-semibold mb-2">Distance & location</div>
                      <div className="text-sm opacity-70">Tune how far you’re willing to go and share your position.</div>
                    </div>

                    <Range
                      values={[draftDistanceIdx]}
                      step={1}
                      min={0}
                      max={distanceSteps.length - 1}
                      onChange={([idx]) => {
                        setDraftDistanceIdx(idx);
                        setDraftDistanceMax(distanceSteps[idx]);
                        markDirty();
                      }}
                      renderTrack={({ props, children }) => {
                        const { key, ...rest } = (props as any);
                        return (
                          <div
                            key={key}
                            {...rest}
                            className="h-2 rounded-full"
                            style={{
                              ...rest.style,
                              background: getTrackBackground({
                                values: [draftDistanceIdx],
                                colors: ['var(--accent)', 'var(--border)'],
                                min: 0,
                                max: distanceSteps.length - 1,
                              }),
                            }}
                          >
                            {children}
                          </div>
                        );
                      }}
                      renderThumb={({ props }) => {
                        const { key, ...rest } = (props as any);
                        return (
                          <div
                            key={key}
                            {...rest}
                            className="w-5 h-5 rounded-full border border-[var(--border)]"
                            style={{ ...rest.style, backgroundColor: 'var(--bg)' }}
                          />
                        );
                      }}
                    />

                    <div className="mt-3 text-sm">
                      {draftDistanceMax === DIST_NO_LIMIT ? (
                        <span className="font-semibold">No distance limit</span>
                      ) : (
                        <>
                          Within <span className="font-semibold">{draftDistanceMax} km</span>
                        </>
                      )}
                    </div>

                    <div className="mt-6 p-4 rounded-2xl border border-[var(--border)] bg-[var(--bg)] flex items-center justify-between gap-4">
                      <div className="text-left">
                        <div className="font-medium">Use your location</div>
                        <div className="text-sm opacity-70">Enable to personalize matches with your current position.</div>
                      </div>

                      <button
                        type="button"
                        role="switch"
                        aria-checked={draftGeoEnabled}
                        aria-label="Enable location"
                        disabled={draftGeoBusy}
                        onClick={async () => {
                          if (draftGeoBusy) return;
                          if (draftGeoEnabled) {
                            setDraftGeoEnabled(false);
                            setDraftGeoCoords(null);
                            markDirty();
                            return;
                          }
                          // Request once for modal
                          setDraftGeoBusy(true);
                          try {
                            await new Promise<void>((resolve) => {
                              navigator.geolocation.getCurrentPosition(
                                (pos) => {
                                  setDraftGeoCoords({
                                    lat: pos.coords.latitude,
                                    lng: pos.coords.longitude,
                                    accuracy: pos.coords.accuracy,
                                  });
                                  setDraftGeoEnabled(true);
                                  setDraftGeoBusy(false);
                                  resolve();
                                },
                                () => {
                                  setDraftGeoEnabled(false);
                                  setDraftGeoCoords(null);
                                  setDraftGeoBusy(false);
                                  resolve();
                                },
                                { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
                              );
                            });
                          } finally {
                            markDirty();
                          }
                        }}
                        className={[
                          'relative w-14 h-8 rounded-full border transition-colors select-none',
                          draftGeoEnabled ? 'border-[var(--accent)] bg-[var(--bg)]' : 'border-[var(--border)] bg-[var(--bg)]',
                          draftGeoBusy ? 'opacity-70 cursor-wait' : 'cursor-pointer',
                        ].join(' ')}
                      >
                        {draftGeoBusy ? (
                          <div className="absolute inset-0 flex items-center justify-center text-[var(--accent)]" aria-hidden>
                            <Loader2 className="animate-spin" size={16} />
                          </div>
                        ) : (
                          <span
                            aria-hidden
                            className="absolute top-1 left-1 w-6 h-6 rounded-full shadow-sm border border-[var(--border)] transition-transform"
                            style={{ background: draftGeoEnabled ? 'var(--accent)' : 'var(--bg)', transform: draftGeoEnabled ? 'translateX(24px)' : 'translateX(0px)' }}
                          />
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {settingsTab === 'relationship' && (
                  <div className="max-w-3xl mx-auto">
                    <div className="mb-4">
                      <div className="text-lg font-semibold mb-2">Relationship</div>
                      <div className="text-sm opacity-70">Tell us the kind of connection you want.</div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      {[
                        { icon: '💍', title: 'Long-term serious relationship.', desc: 'Meaningful and stable.', value: 'serious' as const },
                        { icon: '🤔', title: 'Open / Depends on the person', desc: 'Let’s see the vibe.', value: 'open' as const },
                        { icon: '🎉', title: 'Just fun, dating or friends', desc: 'Casual and light.', value: 'casual' as const },
                      ].map((opt) => {
                        const selected = draftRelationshipType === opt.value;
                        return (
                          <button
                            key={opt.value}
                            onClick={() => { setDraftRelationshipType(opt.value); markDirty(); }}
                            aria-pressed={selected}
                            className={[
                              'p-4 rounded-2xl border transition text-left shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]',
                              selected ? 'border-[var(--accent)] bg-[var(--hover-surface)]' : 'border-[var(--border)] hover:bg-[var(--hover-surface)] hover:shadow-md',
                            ].join(' ')}
                          >
                            <div className="text-3xl mb-2">{opt.icon}</div>
                            <div className="font-semibold mb-0.5 text-sm">{opt.title}</div>
                            <div className="text-xs opacity-70 leading-snug">{opt.desc}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {settingsTab === 'photos' && (
                  <div>
                    <div className="mb-4">
                      <div className="text-lg font-semibold mb-2">Your photos</div>
                      <div className="text-sm opacity-70">Keep it real — add or replace your 6 best shots.</div>
                    </div>

                    <div className="grid gap-3 justify-center grid-cols-[repeat(3,140px)]">
                      {Array.from({ length: 6 }).map((_, idx) => {
                        const p = photos[idx];
                        const borderColor =
                          p?.status === 'confirmed'
                            ? 'var(--success)'
                            : p?.status === 'rejected'
                            ? 'var(--danger)'
                            : p?.status === 'duplicate' || p?.status === 'timeout'
                            ? 'var(--warning)'
                            : 'var(--border)';

                        return (
                          <div key={idx} className="relative group" style={{ aspectRatio: '3 / 4' }}>
                            <div
                              className={`absolute inset-0 rounded-xl border ${p ? 'border-solid' : 'border-dashed'} overflow-hidden transition-colors duration-150 group-hover:bg-[var(--hover-surface)]`}
                              style={{ borderColor }}
                            >
                              {!p && null}

                              {p && (
                                <>
                                  <img src={p.url} alt="photo" className="absolute inset-0 w-full h-full object-cover" />

                                  {p.status === 'uploading' && (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                      <ProgressRing value={p.progress} />
                                    </div>
                                  )}

                                  {p.status !== 'uploading' && (
                                    <>
                                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center px-2 text-center">
                                        {p.status === 'confirmed' && (
                                          <div className="text-sm font-medium text-[var(--success)]">Verified</div>
                                        )}
                                        {p.status === 'rejected' && (
                                          <div className="text-sm font-medium text-[var(--danger)]">Doesn’t match your identity</div>
                                        )}
                                        {p.status === 'duplicate' && (
                                          <div className="text-sm font-medium text-[var(--warning)]">Already uploaded</div>
                                        )}
                                        {p.status === 'timeout' && (
                                          <div className="text-sm font-medium text-[var(--warning)]">Timeout. Please try again.</div>
                                        )}
                                      </div>

                                      <div className="absolute bottom-2 right-2">
                                        {p.status === 'confirmed' && <CheckCircle size={20} color="var(--success)" />}
                                        {p.status === 'rejected' && <XCircle size={22} color="var(--danger)" />}
                                        {(p.status === 'duplicate' || p.status === 'timeout') && (
                                          <AlertTriangle size={20} color="var(--warning)" />
                                        )}
                                      </div>
                                    </>
                                  )}

                                  {/* Delete stays active even during upload */}
                                  <button
                                    onClick={() => handleDeletePhoto(idx)}
                                    className="absolute top-1 right-1 bg-black/60 rounded-full px-2 leading-none text-sm"
                                    aria-label="Remove photo"
                                    title="Remove"
                                  >
                                    ✕
                                  </button>
                                </>
                              )}
                            </div>

                            {!p && (
                              <label className="absolute top-0 left-0 bottom-[-8px] right-[-8px] cursor-pointer">
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) void handlePhotoUpload(file, idx);
                                  }}
                                />
                                <div className="pointer-events-none absolute bottom-[3px] right-[3px] w-[22px] h-[22px] rounded-full bg-[var(--accent)] text-white flex items-center justify-center text-[18px] shadow-sm transition-colors duration-150 group-hover:bg-[var(--accent-hover)]">
                                  +
                                </div>
                              </label>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
)}

                {settingsTab === 'preferences' && (
                  <div>
                    <div className="mb-4">
                      <div className="text-lg font-semibold mb-2">Preferences</div>
                      <div className="text-sm opacity-70">Fine-tune your vibe and examples you like.</div>
                    </div>

                    <div className="max-w-xl mx-auto">
                      <Range
                        values={[draftStrictnessLevel]}
                        step={1}
                        min={1}
                        max={3}
                        onChange={([v]) => { setDraftStrictnessLevel(v); markDirty(); }}
                        renderTrack={({ props, children }) => {
                          const { key, ...rest } = (props as any);
                          const pct = ((draftStrictnessLevel - 1) / 2) * 100;
                          return (
                            <div
                              key={key}
                              {...rest}
                              className="h-2 rounded-full"
                              style={{
                                ...rest.style,
                                background: `linear-gradient(
                                  to right,
                                  var(--accent) 0%,
                                  var(--accent) ${pct}%,
                                  var(--border) ${pct}%,
                                  var(--border) 100%
                                )`,
                              }}
                            >
                              {children}
                            </div>
                          );
                        }}
                        renderThumb={({ props }) => {
                          const { key, ...rest } = (props as any);
                          return (
                            <div
                              key={key}
                              {...rest}
                              className="w-5 h-5 rounded-full border border-[var(--border)]"
                              style={{ ...rest.style, backgroundColor: 'var(--bg)' }}
                            />
                          );
                        }}
                      />
                      <div className="mt-3 text-sm">
                        <span className="font-semibold">
                          {draftStrictnessLevel === 1 ? 'Open-minded 🧘‍♂️' : draftStrictnessLevel === 2 ? 'Balanced ⚖️' : 'Specific taste 🔍'}
                        </span>
                      </div>
                    </div>

                    <div className="mt-6 grid gap-3 justify-center grid-cols-[repeat(3,140px)]">
                      {Array.from({ length: 6 }).map((_, idx) => {
                        const p = photosPreference[idx];
                        const borderColor =
                          p?.status === 'confirmed'
                            ? 'var(--success)'
                            : p?.status === 'rejected'
                            ? 'var(--danger)'
                            : p?.status === 'duplicate' || p?.status === 'timeout'
                            ? 'var(--warning)'
                            : 'var(--border)';
                        return (
                          <div key={idx} className="relative group" style={{ aspectRatio: '3 / 4' }}>
                            <div
                              className={`absolute inset-0 rounded-xl border ${p ? 'border-solid' : 'border-dashed'} overflow-hidden transition-colors duration-150 group-hover:bg-[var(--hover-surface)]`}
                              style={{ borderColor }}
                            >
                              {!p && null}
                              {p && (
                                <>
                                  <img src={p.url} alt="preference" className="absolute inset-0 w-full h-full object-cover" />

                                  {p.status === 'uploading' && (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                      <ProgressRing value={p.progress} />
                                    </div>
                                  )}

                                  {p.status !== 'uploading' && (
                                    <>
                                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center px-2 text-center">
                                        {p.status === 'confirmed' && (
                                          <div className="text-sm font-medium text-[var(--success)]">Verified</div>
                                        )}
                                        {p.status === 'rejected' && (
                                          <div className="text-sm font-medium text-[var(--danger)]">Already uploaded as your own photo</div>
                                        )}
                                        {p.status === 'duplicate' && (
                                          <div className="text-sm font-medium text-[var(--warning)]">Already uploaded</div>
                                        )}
                                        {p.status === 'timeout' && (
                                          <div className="text-sm font-medium text-[var(--warning)]">Timeout. Please try again.</div>
                                        )}
                                      </div>

                                      <div className="absolute bottom-2 right-2">
                                        {p.status === 'confirmed' && <CheckCircle size={20} color="var(--success)" />}
                                        {p.status === 'rejected' && <XCircle size={22} color="var(--danger)" />}
                                        {(p.status === 'duplicate' || p.status === 'timeout') && (
                                          <AlertTriangle size={20} color="var(--warning)" />
                                        )}
                                      </div>
                                    </>
                                  )}

                                  {/* Delete stays active even during upload */}
                                  <button
                                    onClick={() => handleDeletePreference(idx)}
                                    className="absolute top-1 right-1 bg-black/60 rounded-full px-2 leading-none text-sm"
                                    aria-label="Remove photo"
                                    title="Remove"
                                  >
                                    ✕
                                  </button>
                                </>
                              )}
                            </div>
                            {!p && (
                              <label className="absolute top-0 left-0 bottom-[-8px] right-[-8px] cursor-pointer">
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) void handlePreferenceUpload(file, idx);
                                  }}
                                />
                                <div className="pointer-events-none absolute bottom-[3px] right-[3px] w-[22px] h-[22px] rounded-full bg-[var(--accent)] text-white flex items-center justify-center text-[18px] shadow-sm transition-colors duration-150 group-hover:bg-[var(--accent-hover)]">
                                  +
                                </div>
                              </label>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
)}
              </div>

              <div className="px-3 sm:px-4 py-3 sm:py-4 flex justify-end gap-3">
                <button
                  onClick={() => setSettingsOpen(false)}
                  className="h-10 px-4 rounded-xl border border-[var(--border)] text-[var(--text)] hover:bg-[var(--hover-surface)] transition"
                >
                  Cancel
                </button>
                <button
                  disabled={!(modalDirty && allConfirmed && allPrefConfirmed)}
                  onClick={async () => {
                    // Build patch of changes
                    const patch: Record<string, any> = {};

                    // Step 2
                    if (draftGenderIdx !== genderIdx || draftPreferenceIdx !== preferenceIdx) {
                      if (draftGenderIdx != null) {
                        const genderLabel = genders[draftGenderIdx] as GenderUILabel;
                        patch.gender = GENDER_CODE[genderLabel];
                      }
                      if (draftPreferenceIdx != null) {
                        const prefLabel = preferences[draftPreferenceIdx] as PrefUILabel;
                        patch.orientation_preference = PREF_CODE[prefLabel];
                      }
                    }

                    // Step 3
                    if (draftAgeRange[0] !== ageRange[0] || draftAgeRange[1] !== ageRange[1]) {
                      patch.age_min = draftAgeRange[0];
                      patch.age_max = draftAgeRange[1];
                    }

                    // Step 4
                    if (draftDistanceMax !== distanceMax) {
                      patch.distance_max_km = draftDistanceMax;
                    }
                    if (draftGeoEnabled && draftGeoCoords) {
                      patch.location = {
                        lat: draftGeoCoords.lat,
                        lng: draftGeoCoords.lng,
                        accuracy: draftGeoCoords.accuracy,
                        source: 'browser',
                      };
                    }

                    // Step 5
                    if (draftRelationshipType !== relationshipType) {
                      patch.relationship = draftRelationshipType;
                    }

                    // Step 9 (strictness)
                    if (draftStrictnessLevel !== strictnessLevel) {
                      patch.strictness_level = draftStrictnessLevel;
                    }

                    try {
                      const {
                        data: { session },
                      } = await supabase.auth.getSession();
                      const token = session?.access_token;
                      if (token && Object.keys(patch).length > 0) {
                        await fetch('/api/ask', {
                          method: 'PATCH',
                          headers: {
                            Authorization: `Bearer ${token}`,
                            'Content-Type': 'application/json',
                          },
                          body: JSON.stringify(patch),
                        });
                      }
                    } catch {
                      // soft-fail — UI state will still update
                    }

                    // Reflect changes locally
                    setGenderIdx(draftGenderIdx);
                    setPreferenceIdx(draftPreferenceIdx);
                    setAgeRange([draftAgeRange[0], draftAgeRange[1]]);
                    setDistanceMax(draftDistanceMax);
                    const idx = distanceSteps.indexOf(draftDistanceMax);
                    if (idx !== -1) setCurrentIdx(idx);
                    setGeoEnabled(draftGeoEnabled);
                    setGeoCoords(draftGeoCoords);
                    setRelationshipType(draftRelationshipType);
                    setStrictnessLevel(draftStrictnessLevel);

                    setSettingsOpen(false);
                  }}
                  className={[
                    'h-10 px-5 rounded-xl text-white font-semibold transition',
                    modalDirty
                      ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]'
                      : 'bg-[color-mix(in srgb, var(--surface-2) 85%, white 15%)] text-[var(--text-muted)] cursor-not-allowed',
                  ].join(' ')}
                >
                  Save changes
                </button>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* ---------- Premium User Bubble (auth only) ---------- */}
      
      {postOnboarding && showMatchTestBubble && (
  <div className="absolute inset-0 z-[20] flex items-center justify-center px-6 pointer-events-none">
    <div className="pointer-events-auto">

          {/* Pulsing circle card */}
<div
  className={`
    relative z-[91] w-[280px] h-[280px] md:w-[320px] md:h-[320px]
    rounded-full border-4 border-[var(--accent)]
    bg-[var(--bg)]
    shadow-[0_0_25px_var(--accent)]
    flex flex-col items-center justify-center text-center
  `}
>
            {/* Pulse ring */}
            <div className="absolute inset-0 rounded-full animate-[ping_1.5s_cubic-bezier(0,0,0.2,1)_infinite] bg-[var(--accent)] opacity-25" aria-hidden />
            {/* Inner glow ring */}
            <div className="absolute inset-0 rounded-full ring-1 ring-[var(--accent)] ring-opacity-30" aria-hidden />

            <div className="relative z-[92] px-6">
              <div className="text-sm uppercase tracking-widest opacity-80">New Match</div>

              {/* Primary line: score if we have it */}
              <div className="mt-2 text-5xl font-extrabold leading-none">
                {(() => {
                  const pct = roundScorePercent(latestMatch?.score_pref_to_self ?? null);
                  return pct != null ? `${pct}%` : '—';
                })()}
              </div>
              <div className="mt-1 text-xs opacity-70">compatibility</div>

              {/* Secondary details */}
              <div className="mt-3 text-sm opacity-90">
                {latestMatch?.match_gender ? latestMatch.match_gender : '—'}
                {latestMatch?.match_age != null ? `  ${latestMatch.match_age}` : ''}
                {(() => {
                  const d = latestMatch?.distance_kilometre;
                  if (typeof d !== 'number' || !Number.isFinite(d)) return '';
                  return d >= 1
                    ? ` · ${Math.round(d)} km away`
                    : ` · ${Math.round(d * 1000)} m away`;
                })()}
              </div>

              {/* Actions */}
              <div className="mt-6 flex items-center justify-center gap-3">
                {/* Dismiss avec double confirmation */}
<button
  onClick={() => setShowConfirmDismiss(true)}
  className="h-10 px-5 rounded-full border border-[var(--border)] hover:bg-[var(--hover-surface)] transition text-sm font-medium"
>
  Dismiss
</button>

{showConfirmDismiss && (
  <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[color-mix(in srgb,var(--bg) 60%,transparent)] backdrop-blur-md">
    <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl shadow-xl p-6 max-w-sm w-[90%] text-center animate-[fadeIn_0.2s_ease-out]">
      <h2 className="text-lg font-semibold mb-2">Are you sure?</h2>
      <p className="text-sm opacity-80 mb-6">
        This action cannot be undone. You will permanently reject this match.
      </p>

      <div className="flex justify-center gap-4">
        <button
          onClick={() => setShowConfirmDismiss(false)}
          className="h-10 px-5 rounded-full border border-[var(--border)] hover:bg-[var(--hover-surface)] transition text-sm font-medium"
        >
          Cancel
        </button>

        <button
  onClick={async () => {
    try {
      // 1) Fermer la mini-modale (⚠️ on NE ferme PAS la bulle tout de suite)
      setShowConfirmDismiss(false);

      // 2) Identifier le match affiché
      const current = matchesQueue[currentMatchIndex];
      const dismissedId = current?.id ? String(current.id) : null;

      if (dismissedId) {
        // 3) Calculer la nouvelle file SANS ce match
        const nextQueue = matchesQueue.filter((m) => String(m?.id) !== dismissedId);
        const nextIndex = Math.min(
          currentMatchIndex,
          Math.max(0, nextQueue.length - 1)
        );

        // 4) Appliquer localement (immédiat)
        setMatchesQueue(nextQueue);
        setCurrentMatchIndex(nextIndex);
        setConfirmButtonStates((prev) => {
          const copy = { ...prev };
          delete copy[dismissedId];
          return copy;
        });
        setShowConfirmedMatchBubble(false);

        // 5) Bulle "New Match" :
        //    - s'il reste d'autres matchs → on affiche le suivant
        //    - sinon → on ferme la bulle
        if (nextQueue.length > 0) {
          const r = nextQueue[nextIndex];
          setLatestMatch({
            match_user_id: r.match_user_id ?? null,
            match_gender: r.match_gender ?? null,
            match_age: r.match_age != null ? Number(r.match_age) : null,
            distance_kilometre: r.distance_km != null ? Number(r.distance_km) : null,
            score_pref_to_self: r.score_pref_to_self != null ? Number(r.score_pref_to_self) : null,
          });
          setShowMatchTestBubble(true);
        } else {
          setShowMatchTestBubble(false);
        }

        // 6) Écrire côté serveur (sécurité)
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (token) {
          await fetch('/api/ask', {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ fn: 'dismiss_match', match_id: dismissedId }),
          });
        }
      }
    } catch (err) {
      console.error('Erreur dismiss_match:', err);
    }
  }}
  className="h-10 px-5 rounded-full bg-[var(--danger-solid)] hover:bg-[var(--danger-hover)] text-[var(--danger-on-solid)] transition text-sm font-semibold"
>
  OK
</button>

      </div>
    </div>
  </div>
)}

                {getConfirmStateForMatch(matchesQueue[currentMatchIndex]?.id) === 'idle' ? (
  <button
  onClick={async () => {
    try {
      // 1) Récupère le match AFFICHÉ (celui qu'on confirme)
      const current = matchesQueue[currentMatchIndex];
      const id = current?.id;
      const matchUserId = current?.match_user_id ?? latestMatch?.match_user_id;

      if (!id || !matchUserId) {
        console.error('❌ Match courant introuvable (id/match_user_id manquant).');
        return;
      }

      // 2) Passe CE match en "In Review…" côté UI (local, par id)
      setConfirmButtonStates(prev => ({ ...prev, [String(id)]: 'waiting' }));

      // 3) Appel API ciblé : confirme TA ligne pour CE match
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;

      await fetch('/api/ask', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fn: 'confirm_match',
          match_id: String(id),               // 👈 indispensable en multi-match
          match_user_id: String(matchUserId), // 👈 recoupe optionnelle côté back
        }),
      });

      // Le passage en "Confirmed" viendra via le listener quand `match` = true (trigger SQL).
    } catch (err) {
      console.error('Erreur confirm_match:', err);
      // soft fallback : si erreur on remet ce match en idle
      const curId = matchesQueue[currentMatchIndex]?.id;
      if (curId) setConfirmButtonStates(prev => ({ ...prev, [String(curId)]: 'idle' }));
    }
  }}
  className="h-10 px-5 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white transition text-sm font-semibold"
>
  Confirm
</button>

) : getConfirmStateForMatch(matchesQueue[currentMatchIndex]?.id) === 'waiting' ? (
  <button
    disabled
    className="h-10 px-5 rounded-full border border-[var(--border)] text-[var(--text-muted)] bg-[var(--hover-surface)] cursor-wait transition text-sm font-medium"
  >
    In Review…
  </button>
) : getConfirmStateForMatch(matchesQueue[currentMatchIndex]?.id) === 'rejected' ? (
  <button
    disabled
    className="h-10 px-5 rounded-full bg-[var(--danger)] text-white cursor-not-allowed transition text-sm font-semibold"
  >
    Rejected
  </button>
  ) : getConfirmStateForMatch(matchesQueue[currentMatchIndex]?.id) === 'confirmed' ? (
  <button
    disabled
    className="h-10 px-5 rounded-full bg-[var(--success)] text-white cursor-default transition text-sm font-semibold"
  >
    Confirmed
  </button>
) : null}

              </div>
            </div>
          </div>
        </div>
      </div>
  )}
{postOnboarding && confirmedMatches.length > 0 &&
  confirmedMatches.map((m: any, i: number) => {
    // où se trouve ce match dans la file principale
    const idx = matchesQueue.findIndex((x: any) => x?.id === m?.id);

        // empilement vertical : 118px pour la 1ère pastille, +94px par pastille (même écart à chaque fois)
    // 48px (h-12) + 24px (gap) = 72px de pas ; base = 24 (bottom de la pastille principale) + 48 + 24 = 96
const PILL_H = 48;
const GAP = 24;
const bottomPx = 24 + PILL_H + GAP + i * (PILL_H + GAP); // => 96 + i*72

    // lettres à afficher dans la pastille (fallback "••")
    const initials =
      (typeof m?.match_initials === 'string' && m.match_initials.trim()) ? m.match_initials.trim() : '••';

    return (
      <button
        key={m?.id ?? i}
        onClick={() => {
          if (idx >= 0) setCurrentMatchIndex(idx); // focus le match lié à la pastille cliquée
          setShowMatchGallery(true);               // ouvre la modale
        }}
        className="fixed left-6 z-[20] ai-btn focus:outline-none"
        style={{ bottom: `${bottomPx}px` }}
        aria-label={`Confirmed match ${i + 1}`}
        title={`Confirmed match ${i + 1}`}
      >
        <span className="relative block">
          <span className="ai-halo" aria-hidden />
          <span className="ai-pill inline-flex items-center justify-center h-12 min-w-12 px-3 rounded-full">
            <span className="ai-text text-sm font-semibold tracking-wide select-none">
              {initials}
            </span>
          </span>
        </span>
      </button>
    );
  })
}

{/* 🪩 Modale premium du match */}
{showMatchGallery && (
  <div className="fixed inset-0 z-[90] flex items-center justify-center">
    {/* Frosted backdrop */}
    <div
      className="absolute inset-0 bg-[color-mix(in srgb,var(--bg) 60%,transparent)] backdrop-blur-[3px]"
      style={{ WebkitBackdropFilter: 'blur(8px)'  as any}}
    />
    {/* Modal card with left sidebar menu */}
    <div
      role="dialog"
      aria-modal="true"
      className="relative z-[91] w-[min(95vw,1000px)] h-[min(85vh,680px)] rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-xl overflow-hidden flex"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Sidebar (reuse Settings visual language) */}
      <aside className="w-56 shrink-0 border-r border-[var(--border)] p-3 flex flex-col justify-center">
        <nav className="space-y-1">
          <SideTabButton active={matchModalTab === 'gallery'} onClick={() => setMatchModalTab('gallery')}>Gallery</SideTabButton>
          <SideTabButton active={matchModalTab === 'details'} onClick={() => setMatchModalTab('details')}>Profile</SideTabButton>
          <SideTabButton active={matchModalTab === 'chat'} onClick={() => setMatchModalTab('chat')}>Chat</SideTabButton>
        </nav>
      </aside>

      {/* Content area */}
      <section className="relative flex-1 overflow-y-auto p-4 sm:p-6">
        {/* Minimal close */}
        <button
          onClick={() => setShowMatchGallery(false)}
          className="absolute top-3 right-3 h-8 w-8 inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg)]/70 hover:bg-[var(--hover-surface)] focus:outline-none"
          title="Close"
          aria-label="Close"
        >
          <X size={16} />
        </button>

        {/* Gallery */}
        {matchModalTab === 'gallery' && (
          <div className="h-full w-full flex items-center justify-center">
            {matchPhotos.length > 0 ? (
              <div className="grid gap-4 justify-center grid-cols-[repeat(3,160px)] md:grid-cols-[repeat(3,180px)]">
                {matchPhotos.map((url, idx) => (
                  <button
                    key={idx}
                    onClick={() => setZoomedPhoto(url)}
                    className="relative group rounded-2xl overflow-hidden focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition-transform duration-200"
                    aria-label={`Open photo ${idx + 1}`}
                  >
                    <img
                      src={url}
                      alt={`Photo ${idx + 1}`}
                      className="w-full aspect-[3/4] object-cover rounded-2xl border border-[var(--border)] transition-transform duration-200 group-hover:scale-[1.02]"
                    />
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-[var(--text-muted)] text-sm">No photos available</div>
            )}
          </div>
        )}

        {/* Details */}
        {matchModalTab === 'details' && (
          <div className="max-w-xl">
            <div className="text-lg font-semibold mb-3">Match overview</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div className="opacity-70">Gender</div>
              <div className="font-medium">{latestMatch?.match_gender ?? '—'}</div>

              <div className="opacity-70">Age</div>
              <div className="font-medium">{latestMatch?.match_age ?? '—'}</div>

              <div className="opacity-70">Distance</div>
              <div className="font-medium">
                {typeof latestMatch?.distance_kilometre === 'number'
                  ? (latestMatch.distance_kilometre >= 1
                      ? `${Math.round(latestMatch.distance_kilometre)} km`
                      : `${Math.round(latestMatch.distance_kilometre * 1000)} m`)
                  : '—'}
              </div>

              <div className="opacity-70">Compatibility</div>
              <div className="font-medium">
                {(() => {
                  const pct = roundScorePercent(latestMatch?.score_pref_to_self ?? null);
                  return pct != null ? `${pct}%` : '—';
                })()}
              </div>
            </div>
            <div className="mt-6 text-xs opacity-60">
              We keep names private. Details shown are minimal to protect privacy.
            </div>
          </div>
        )}

        {/* Chat placeholder */}
{matchModalTab === 'chat' && (
  <div className="relative h-full flex flex-col">
    {!chatReady ? (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
        <div className="text-lg font-semibold mb-1">Chat is locked</div>
        <div className="text-sm opacity-70 max-w-sm">
          Chat becomes available once both of you confirm the match.
        </div>
      </div>
    ) : (
      <>
        <div
          ref={chatListRef}
          className="flex-1 overflow-y-auto space-y-2 pr-4"
          style={{ ['scrollbarGutter' as any]: 'stable both-edges' }}
        >
          {chatBooting && (
            <div className="text-sm opacity-60 text-center mt-6">Loading messages…</div>
          )}
          {!chatBooting && chatMessages.length === 0 && (
            <div className="text-sm opacity-60 text-center mt-6">Say hi and break the ice ✦</div>
          )}
          {!chatBooting &&
            chatMessages.map((m) => {
              const mine = chatMeId != null && m.sender_id === chatMeId;
              return (
                <div
                  key={m.id}
                  className={`w-full flex ${mine ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[75%] rounded-2xl px-3 py-2 shadow-sm ${
                      mine
                        ? 'bg-[var(--accent)] text-white'
                        : 'border border-[var(--border)] bg-[var(--bg)]'
                    }`}
                  >
                    <div className="whitespace-pre-wrap leading-relaxed text-sm">
                      {m.body}
                    </div>
                    <div
                      className={`mt-1 text-[10px] opacity-70 ${
                        mine ? 'text-white/80' : 'text-[var(--text-muted)]'
                      }`}
                    >
                      {new Date(m.created_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                </div>
              );
            })}

          {otherTyping && (
            <div className="mt-1 mb-1 flex justify-start">
              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-sm">
                <TypingDots />
              </div>
            </div>
          )}
        </div>

        <div className="mt-3 border-t border-[var(--border)] pt-3 sticky bottom-0 bg-[var(--bg)]">
          {chatError && (
            <div className="text-xs text-[var(--danger)] mb-2">{chatError}</div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={chatInput}
              onChange={(e) => {
                setChatInput(e.target.value.slice(0, 4000));
                emitTyping();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void sendChat();
                }
              }}
              placeholder="Write a message…"
              rows={1}
              className="flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              disabled={!chatReady || chatSending}
            />
            <button
              onClick={sendChat}
              disabled={!chatReady || chatSending || chatInput.trim().length === 0}
              className={[
                'h-10 px-4 rounded-xl text-sm font-semibold transition',
                chatReady && chatInput.trim().length > 0
                  ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white'
                  : 'bg-[color-mix(in srgb, var(--surface-2) 85%, white 15%)] text-[var(--text-muted)] cursor-not-allowed',
              ].join(' ')}
            >
              {chatSending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </>
    )}
  </div>
)}
</section>
</div>
</div>
)}
{/* 🪞 Zoom premium sur photo */}
{zoomedPhoto && (
  <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[color-mix(in srgb,var(--bg) 70%,transparent)] backdrop-blur-[10px] animate-[fadeIn_0.25s_ease-out]">
    {/* Bouton ✕ */}
    <button
      onClick={() => setZoomedPhoto(null)}
      className="absolute top-6 right-6 text-[var(--text)] opacity-80 hover:opacity-100 text-1xl"
      title="Close zoom"
    >
      ✕
    </button>

    {/* Image zoomée */}
    <img
      src={zoomedPhoto}
      alt="Zoomed match photo"
      className="max-h-[85vh] max-w-[90vw] rounded-3xl shadow-[0_12px_48px_color-mix(in_srgb,var(--accent)_30%,transparent)] object-contain transition-transform duration-300"
    />
  </div>
)}

      <UserBubble
        initials={userInitials}
        fullName={userFullName ?? undefined}
        onLogout={handleLogout}
        setTheme={setTheme}
        theme={theme as 'light' | 'dark' | undefined}
        postOnboarding={postOnboarding}
        onOpenSettings={openSettings}
      />
      {/* ⬇️ Place ceci tout en bas, juste avant </main> */}
<style jsx global>{`
  /* Animations partagées */
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  @keyframes pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.05); opacity: 0.85; } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes halo-rotate { to { transform: rotate(360deg); } }
  @keyframes pop-in { from { opacity: 0; transform: translateY(8px) scale(0.98);} to{opacity:1; transform: translateY(0) scale(1);} }

  /* Halo/pastille premium réutilisés (UserBubble + pastille confirmée) */
  .ai-halo {
    position: absolute;
    inset: -10px;
    border-radius: 9999px;
    background: var(--accent-gradient);
    filter: blur(12px);
    opacity: 0.55;
    animation: halo-rotate 6s linear infinite;
    -webkit-mask-image: radial-gradient(transparent 56%, black 58%);
            mask-image: radial-gradient(transparent 56%, black 58%);
    pointer-events: none;
  }
  .ai-pill {
    position: relative;
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    border: 1px solid var(--border);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 12%, transparent),
      0 10px 26px color-mix(in srgb, var(--accent) 16%, transparent);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    transition: transform .2s ease, box-shadow .2s ease, background .2s ease, border-color .2s ease;
    will-change: transform, box-shadow;
  }
  .ai-text {
    background: var(--accent-gradient);
    -webkit-background-clip: text;
            background-clip: text;
    color: transparent;
  }
  .ai-btn:hover .ai-halo,
  .ai-btn:focus-visible .ai-halo { opacity: 0.85; }
  .ai-btn:hover .ai-pill {
    transform: translateY(-1px) scale(1.02);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 12%, transparent),
      0 14px 32px color-mix(in srgb, var(--accent) 22%, transparent);
  }
  .ai-btn:active .ai-pill { transform: translateY(0) scale(0.98); }

  /* Carte/popover du UserBubble */
  .ai-popover {
    position: relative;
    border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    background: color-mix(in srgb, var(--surface-2) 90%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    box-shadow: 0 18px 46px color-mix(in srgb, var(--accent) 18%, transparent);
    transform-origin: bottom left;
    animation: pop-in .18s ease-out;
  }
  .ai-popover::before {
    content: "";
    position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
    background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 18%, transparent) 0%, transparent 60%);
    opacity: .35;
  }
  .ai-sep { height: 1px; margin: .5rem .5rem; background: color-mix(in srgb, var(--border) 70%, transparent); }
`}</style>
{/* ⬅️➡️ Flèches globales de navigation multi-match (provisoire) */}
{postOnboarding && matchesQueue.length > 1 && (
  <div
    className="fixed bottom-6 left-0 right-0 z-[40] flex items-center justify-center gap-4 pointer-events-none"
  >
    <button
      onClick={() => setCurrentMatchIndex((i) => Math.max(0, i - 1))}
      className="h-10 w-10 rounded-full border border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--hover-surface)] text-xl leading-none pointer-events-auto"
      aria-label="Previous match"
      title="Previous"
    >
      ←
    </button>

    <div className="text-sm opacity-70 select-none pointer-events-none">
      {currentMatchIndex + 1} / {matchesQueue.length}
    </div>

    <button
      onClick={() => setCurrentMatchIndex((i) => Math.min(matchesQueue.length - 1, i + 1))}
      className="h-10 w-10 rounded-full border border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--hover-surface)] text-xl leading-none pointer-events-auto"
      aria-label="Next match"
      title="Next"
    >
      →
    </button>
  </div>
)}
    </main>
  );
}

/* =========================
 * UI helpers
 * =======================*/
function Slash() {
  return (
    <div
      aria-hidden
      className="flex items-center justify-center select-none text-2xl sm:text-3xl opacity-60"
    >
      /
    </div>
  );
}

type DropdownPickerProps = {
  items: string[];
  valueIndex: number | null;
  onChange: (index: number) => void;
  placeholder: string;
  ariaLabel: string;
  heightPx?: number; // default 56
};

function DropdownPicker({
  items,
  valueIndex,
  onChange,
  placeholder,
  ariaLabel,
  heightPx = 56,
}: DropdownPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open || valueIndex == null || !listRef.current) return;
    const ITEM_H = heightPx;
    listRef.current.scrollTo({ top: valueIndex * ITEM_H - ITEM_H, behavior: 'auto' });
  }, [open, valueIndex, heightPx]);

  const selectedLabel = valueIndex != null && items[valueIndex] ? items[valueIndex] : null;

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
          }
        }}
        className={[
          'w-full rounded-2xl border border-[var(--border)]',
          'flex items-center justify-center',
          'px-4 tabular-nums text-xl sm:text-2xl',
          'hover:bg-[var(--hover-surface)] transition',
        ].join(' ')}
        style={{ height: `${heightPx}px` }}
      >
        <span className={selectedLabel ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}>
          {selectedLabel ?? placeholder}
        </span>
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          className={[
            'absolute z-10 left-0 right-0 mt-2',
            'max-h-56 overflow-y-auto rounded-xl border border-[var(--border)]',
            'bg-[var(--bg)] shadow-lg',
          ].join(' ')}
        >
          {items.map((label, idx) => {
            const selected = idx === valueIndex;
            return (
              <div
                key={`${ariaLabel}-${label}-${idx}`}
                role="option"
                aria-selected={selected}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(idx);
                  setOpen(false);
                }}
                className={[
                  'px-4 h-14 flex items-center justify-center tabular-nums cursor-pointer text-xl sm:text-2xl',
                  selected ? 'bg-[var(--hover-surface)]' : 'hover:bg-[var(--hover-surface)]',
                ].join(' ')}
              >
                {label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProgressRing({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, Math.floor(value)));
  return (
    <div
      className="relative"
      style={{
        width: 64,
        height: 64,
        borderRadius: '9999px',
        background: `conic-gradient(var(--accent) ${clamped}%, var(--border) ${clamped}% 100%)`,
      }}
      aria-label={`Uploading ${clamped}%`}
    >
      <div
        className="absolute inset-2 rounded-full"
        style={{ background: 'var(--bg)' }}
      />
      <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold">
        {clamped}%
      </div>
    </div>
  );
}

function SideTabButton({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'w-full px-3 py-2 rounded-xl text-left text-sm',
        active ? 'bg-[var(--hover-surface)] border border-[var(--border)]' : 'hover:bg-[var(--hover-surface)] border border-transparent',
        'transition-colors',
      ].join(' ')}
    >
      {children}
    </button>
  );
}


/* Small animated typing dots (scoped styles) */
function TypingDots() {
  return (
    <>
      <span className="inline-flex items-center gap-1 h-4" aria-label="typing">
        <span className="tdot" />
        <span className="tdot" style={{ animationDelay: '0.12s' }} />
        <span className="tdot" style={{ animationDelay: '0.24s' }} />
      </span>
      <style jsx>{`
        .tdot {
          width: 6px;
          height: 6px;
          border-radius: 9999px;
          background: color-mix(in srgb, var(--text) 70%, transparent);
          display: inline-block;
          animation: tdot-bounce 1.1s infinite ease-in-out;
        }
        @keyframes tdot-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: .6; }
          40% { transform: translateY(-3px); opacity: 1; }
        }
      `}</style>
    </>
  );
}

/* =========================
 * Premium User Bubble (avatar + menu)
 * =======================*/
function UserBubble({
  initials,
  fullName,
  onLogout,
  setTheme,
  theme,
  postOnboarding,
  onOpenSettings,
}: {
  initials: string;
  fullName?: string;
  onLogout: () => void;
  setTheme: (t: 'light' | 'dark') => void;
  theme?: 'light' | 'dark';
  postOnboarding?: boolean;
  onOpenSettings?: () => void;
}) {
  const [open, setOpen] = useState(false);

  // Fermer avec Échap
  useEffect(() => {
  if (!open) return;
  const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}, [open]);

  const nextTheme = theme === 'light' ? 'dark' : 'light';
  const ThemeIcon = theme === 'light' ? Moon : Sun;
  const themeLabel = theme === 'light' ? 'Switch to Dark mode' : 'Switch to Light mode';

  return (
    <>
      {/* Pastille avatar */}
      <button
  onClick={() => setOpen(v => !v)}
  aria-expanded={open}
  aria-haspopup="menu"
  aria-label="Open user menu"
  title={fullName ? fullName : 'Account'}
  className="ai-btn fixed bottom-6 left-6 z-[100] focus:outline-none"
>
  <span className="relative block">
    {/* Halo IA (anneau conique) */}
    <span className="ai-halo" aria-hidden />

    {/* Pastille glass */}
    <span className="ai-pill inline-flex items-center justify-center h-12 min-w-12 px-3 rounded-full">
      <span className="ai-text text-sm font-semibold tracking-wide select-none">
        {initials}
      </span>
    </span>
  </span>
</button>

      {/* Backdrop + Popover */}
      {open && (
        <>
          <div
            className="fixed inset-0 z-40 backdrop-blur-[3px] bg-transparent"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            className="fixed z-50 left-6"
            style={{ bottom: '88px' }} // équivalent de bottom-[88px]
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ai-popover rounded-2xl overflow-hidden">
              <div className="px-4 pt-3 pb-2">
                <div className="text-xs opacity-70">{fullName ? fullName : 'Account'}</div>
              </div>

              <div className="px-2 pb-2">
                {/* Toggle Light/Dark */}
                <MenuItem onClick={() => setTheme(nextTheme)}>
                  <ThemeIcon size={16} />
                  <span>{themeLabel}</span>
                </MenuItem>

                {/* Options visibles après onboarding */}
                {postOnboarding && (
                  <>
                    <MenuItem onClick={() => { setOpen(false); onOpenSettings?.(); }}>
                      <SettingsIcon size={16} />
                      <span>Settings</span>
                    </MenuItem>
                    <MenuItem onClick={() => { /* reserved for later */ }}>
                      <HelpCircle size={16} />
                      <span>Help</span>
                    </MenuItem>
                    <div className="ai-sep" />
                  </>
                )}

                {/* Logout */}
                <MenuItem onClick={() => { setOpen(false); onLogout(); }}>
                  <LogOut size={16} />
                  <span>Logout</span>
                </MenuItem>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function MenuItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'w-full px-3 py-2 rounded-xl',
        'flex items-center gap-3 text-sm',
        'hover:bg-[var(--hover-surface)]',
        'transition-colors',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

function initialsFromFullName(name: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return 'U';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  const first = parts[0].charAt(0);
  const last = parts[parts.length - 1].charAt(0);
  return (first + last).toUpperCase();
}