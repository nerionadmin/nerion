/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { X, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

type MatchInfo = {
  match_user_id?: string | null;
  match_gender?: string | null;
  match_age?: number | null;
  distance_kilometre?: number | null;
  score_pref_to_self?: number | null;
};

type ChatMessage = { id: string; sender_id: string; body: string; created_at: string };

function roundScorePercent(score?: number | null): number | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return Math.round(score * 100);
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
        active
          ? 'bg-[var(--hover-surface)] border border-[var(--border)]'
          : 'hover:bg-[var(--hover-surface)] border border-transparent',
        'transition-colors',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

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

export default function MatchCard() {
  // Supabase + auth
  const supabase = createClientComponentClient();
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);
  const [postOnboarding, setPostOnboarding] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth
      .getSession()
      .then(async ({ data: { session } }) => {
        if (!mounted) return;
        setIsAuthed(!!session?.user);
        if (session?.access_token) {
          await supabase.realtime.setAuth(session.access_token);
        }
      })
      .catch(() => setIsAuthed(false));

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_e, session) => {
      setIsAuthed(!!session?.user);
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token);
      }
    });
    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, [supabase]);

  // Gating post-onboarding via /api/ask?fn=me (step_index >= 10)
  useEffect(() => {
    if (!isAuthed) return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;
        const res = await fetch('/api/ask?fn=me', { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json();
        const raw = json?.profile?.step_index ?? json?.step_index;
        const si = Number(raw);
        setPostOnboarding(Number.isFinite(si) ? si >= 10 : false);
      } catch {
        setPostOnboarding(false);
      }
    })();
  }, [isAuthed, supabase]);

  // === Local states (tout ce qui était en props avant)
  const [showMatchTestBubble, setShowMatchTestBubble] = useState(false);
  const [showConfirmDismiss, setShowConfirmDismiss] = useState(false);
  const [confirmButtonState, setConfirmButtonState] =
    useState<'idle' | 'waiting' | 'rejected' | 'confirmed'>('idle');
  const mirrorMatchChannelsRef = useRef<Record<string, any>>({});

  const [showConfirmedMatchBubble, setShowConfirmedMatchBubble] = useState(false);
  const [matchInitials, setMatchInitials] = useState<string | null>(null);

  const [showMatchGallery, setShowMatchGallery] = useState(false);
  const [matchModalTab, setMatchModalTab] = useState<'gallery' | 'details' | 'chat'>('gallery');

  const [matchPhotos, setMatchPhotos] = useState<string[]>([]);
  const [currentMatchPhoto, setCurrentMatchPhoto] = useState(0);
  const [zoomedPhoto, setZoomedPhoto] = useState<string | null>(null);

  const [latestMatch, setLatestMatch] = useState<MatchInfo | null>(null);

  // Chat
  const [otherTyping, setOtherTyping] = useState(false);
  const typingChannelRef = useRef<any>(null);
  const typingHideTimerRef = useRef<any>(null);
  const lastTypingSentRef = useRef<number>(0);

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

  // Typing channel (broadcast)
  useEffect(() => {
    if (!(showMatchGallery && matchModalTab === 'chat' && chatReady && chatMeId && chatOtherId)) {
      if (typingChannelRef.current) {
        try { supabase.removeChannel(typingChannelRef.current); } catch {}
        typingChannelRef.current = null;
      }
      return;
    }

    (async () => {
      try {
        const a = chatMeId! < chatOtherId! ? chatMeId! : chatOtherId!;
        const b = chatMeId! < chatOtherId! ? chatOtherId! : chatMeId!;

        if (typingChannelRef.current) {
          try { supabase.removeChannel(typingChannelRef.current); } catch {}
          typingChannelRef.current = null;
        }

        const ch = supabase
          .channel(`typing-${a}-${b}`, { config: { broadcast: { ack: false }}})
          .on('broadcast', { event: 'typing' }, (payload: any) => {
            const from = payload?.payload?.sender_id;
            if (!from || from === chatMeId) return;
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

  // Mark messages read when chat tab visible
  useEffect(() => {
    if (!(chatReady && chatMatchId && showMatchGallery && matchModalTab === 'chat')) return;
    (async () => {
      try {
        await supabase.rpc('chat_mark_read', { p_match_id: chatMatchId, p_at: new Date().toISOString() });
      } catch {}
    })();
  }, [chatReady, chatMatchId, showMatchGallery, matchModalTab, chatMessages, supabase]);

  // Bootstrap chat
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

        // Autre utilisateur
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

        // Vérif miroir confirmée
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

        // Charger les messages
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

        // Realtime INSERT
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

  function emitTyping() {
    try {
      const now = Date.now();
      if (!typingChannelRef.current || !chatMeId) return;
      if (now - (lastTypingSentRef.current || 0) < 1500) return;
      lastTypingSentRef.current = now;
      typingChannelRef.current.send({
        type: 'broadcast',
        event: 'typing',
        payload: { sender_id: chatMeId, at: now },
      });
    } catch {}
  }

  // -------- Matches: realtime INSERT + miroir + reloads --------

  // Écoute INSERT sur mes lignes 'matches'
  useEffect(() => {
    if (!postOnboarding) return;
    let channel: any;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      const token = session?.access_token;
      if (!user || !token) return;
      void supabase.realtime.setAuth(token);

      channel = supabase
        .channel('realtime-test-match')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'matches', filter: `user_id=eq.${user.id}` },
          async (payload: any) => {
            const row = payload?.new || {};
            setLatestMatch({
              match_user_id: row.match_user_id ?? null,
              match_gender: row.match_gender ?? null,
              match_age: row.match_age != null ? Number(row.match_age) : null,
              distance_kilometre: (row.distance_kilometre ?? row.distance_km) != null ? Number(row.distance_kilometre ?? row.distance_km) : null,
              score_pref_to_self: row.score_pref_to_self != null ? Number(row.score_pref_to_self) : null,
            });
            setShowMatchTestBubble(true);

            // Hook miroir
            const matchUserId = row?.match_user_id as string | null;
            if (matchUserId && user?.id) {
              const mirrorChannel = supabase
                .channel(`mirror-match-${matchUserId}`)
                .on(
                  'postgres_changes',
                  { event: 'UPDATE', schema: 'public', table: 'matches', filter: `user_id=eq.${matchUserId}` },
                  (mirrorPayload: any) => {
                    const newRow = mirrorPayload?.new;
                    if (!newRow) return;
                    if (newRow.match_user_id === user.id) {
                      const newStatus = newRow.status;
                      if (newStatus === 'deleted') {
                        setConfirmButtonState('rejected');
                        // Persister "mirror_rejected"
                        (async () => {
                          try {
                            const { data: { session } } = await supabase.auth.getSession();
                            const token = session?.access_token;
                            if (!token) return;
                            await fetch('/api/ask', {
                              method: 'PATCH',
                              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                              body: JSON.stringify({ fn: 'mirror_rejected' }),
                            });
                          } catch {}
                        })();
                      }
                      if (newStatus === 'confirmed') {
                        (async () => {
                          try {
                            const { data: { session } } = await supabase.auth.getSession();
                            const me = session?.user;
                            if (!me) return;

                            const { data: rows } = await supabase
                              .from('matches')
                              .select('user_id, match_user_id, status')
                              .in('user_id', [me.id, matchUserId])
                              .or(`match_user_id.eq.${me.id},match_user_id.eq.${matchUserId}`);

                            const mine = rows?.find(r => r.user_id === me.id);
                            const other = rows?.find(r => r.user_id === matchUserId);
                            if (mine?.status === 'confirmed' && other?.status === 'confirmed') {
                              setConfirmButtonState('confirmed');
                            }
                          } catch {}
                        })();
                      }
                    }
                  }
                )
                .subscribe();

              mirrorMatchChannelsRef.current[matchUserId] = mirrorChannel;
            }
          }
        )
        .subscribe();
    })();

    return () => { if (channel) supabase.removeChannel(channel); };
  }, [postOnboarding, supabase]);

  // Persistance au reload: /api/ask?fn=incoming_match
  useEffect(() => {
    if (!postOnboarding || !isAuthed) return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;
        const res = await fetch('/api/ask?fn=incoming_match', { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json();
        if (json?.hasIncomingMatch) {
          setShowMatchTestBubble(true);
          setLatestMatch({
            match_user_id: json?.match_user_id ?? null,
            match_gender: json?.match_gender ?? null,
            match_age: json?.match_age != null ? Number(json.match_age) : null,
            distance_kilometre: json?.distance_km != null ? Number(json.distance_km) : null,
            score_pref_to_self: json?.score_pref_to_self != null ? Number(json.score_pref_to_self) : null,
          });
        }
        // Fallback match_user_id
        if (!json?.match_user_id) {
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
        }
      } catch {}
    })();
  }, [postOnboarding, isAuthed, supabase]);

  // Au reload : rebrancher le miroir si bulle affichée
  useEffect(() => {
    if (!postOnboarding || !isAuthed || !showMatchTestBubble) return;

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;
        const token = session?.access_token;
        if (!user || !token) return;

        const { data: last } = await supabase
          .from('matches')
          .select('match_user_id')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const matchUserId = (last as any)?.match_user_id as string | null;
        if (!matchUserId) return;
        setLatestMatch((prev) => ({ ...prev, match_user_id: matchUserId }));

        if (mirrorMatchChannelsRef.current[matchUserId]) return;
        await supabase.realtime.setAuth(token);

        // Check immédiat du miroir
        try {
          const { data: mirrorNow } = await supabase
            .from('matches')
            .select('status, match_user_id')
            .eq('user_id', matchUserId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (mirrorNow && mirrorNow.match_user_id === user.id) {
            const s0 = mirrorNow.status as string | undefined;
            if (s0 === 'deleted') {
              setConfirmButtonState('rejected');
              (async () => {
                try {
                  const { data: { session } } = await supabase.auth.getSession();
                  const token = session?.access_token;
                  if (!token) return;
                  await fetch('/api/ask', {
                    method: 'PATCH',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ fn: 'mirror_rejected' }),
                  });
                } catch {}
              })();
            }
            if (s0 === 'confirmed') {
              (async () => {
                try {
                  const { data: { session } } = await supabase.auth.getSession();
                  const me = session?.user;
                  if (!me) return;
                  const { data: rows } = await supabase
                    .from('matches')
                    .select('user_id, match_user_id, status')
                    .or(
                      `and(user_id.eq.${me.id},match_user_id.eq.${matchUserId}),` +
                      `and(user_id.eq.${matchUserId},match_user_id.eq.${me.id})`
                    );
                  const mine  = rows?.find(r => r.user_id === me.id       && r.match_user_id === matchUserId);
                  const other = rows?.find(r => r.user_id === matchUserId  && r.match_user_id === me.id);
                  if (mine?.status === 'confirmed' && other?.status === 'confirmed') {
                    setConfirmButtonState('confirmed');
                  }
                } catch {}
              })();
            }
          }
        } catch {}

        const mirrorChannel = supabase
          .channel(`mirror-match-${matchUserId}`)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'matches', filter: `user_id=eq.${matchUserId}` },
            (mirrorPayload: any) => {
              const newRow = mirrorPayload?.new;
              if (!newRow) return;
              if (newRow.match_user_id === user.id) {
                const newStatus = newRow.status;

                if (newStatus === 'deleted') {
                  setConfirmButtonState('rejected');
                  (async () => {
                    try {
                      const { data: { session } } = await supabase.auth.getSession();
                      const token = session?.access_token;
                      if (!token) return;
                      await fetch('/api/ask', {
                        method: 'PATCH',
                        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fn: 'mirror_rejected' }),
                      });
                    } catch {}
                  })();
                }

                if (newStatus === 'confirmed') {
                  (async () => {
                    try {
                      const { data: { session } } = await supabase.auth.getSession();
                      const me = session?.user;
                      if (!me) return;
                      const { data: rows } = await supabase
                        .from('matches')
                        .select('user_id, match_user_id, status')
                        .or(
                          `and(user_id.eq.${me.id},match_user_id.eq.${matchUserId}),` +
                          `and(user_id.eq.${matchUserId},match_user_id.eq.${me.id})`
                        );
                      const mine  = rows?.find(r => r.user_id === me.id       && r.match_user_id === matchUserId);
                      const other = rows?.find(r => r.user_id === matchUserId  && r.match_user_id === me.id);
                      if (mine?.status === 'confirmed' && other?.status === 'confirmed') {
                        setConfirmButtonState('confirmed');
                      }
                    } catch {}
                  })();
                }
              }
            }
          )
          .subscribe();

        mirrorMatchChannelsRef.current[matchUserId] = mirrorChannel;
      } catch (err) {
        console.error('mirror reload hookup error:', err);
      }
    })();

    return () => {
      // cleanup mirror channels
      Object.values(mirrorMatchChannelsRef.current).forEach((ch: any) => {
        try { supabase.removeChannel(ch); } catch {}
      });
      mirrorMatchChannelsRef.current = {};
    };
  }, [postOnboarding, isAuthed, showMatchTestBubble, supabase]);

  // Lecture statut dernière ligne pour initialiser le bouton
  useEffect(() => {
    if (!postOnboarding || !isAuthed) return;

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) return;

        const { data: last } = await supabase
          .from('matches')
          .select('status')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!last) { setShowMatchTestBubble(false); return; }

        const status = last?.status ?? 'pending';

        if (status === 'confirmed') {
          setConfirmButtonState('waiting'); // même logique qu’avant
          setShowMatchTestBubble(true);
        } else if (status === 'rejected') {
          setConfirmButtonState('rejected');
          setShowMatchTestBubble(true);
        } else if (status === 'deleted') {
          setShowMatchTestBubble(false);
        } else if (status === 'pending') {
          setConfirmButtonState('idle');
          setShowMatchTestBubble(true);
        }
      } catch (err) {
        console.error('Erreur lecture statut match:', err);
      }
    })();
  }, [postOnboarding, isAuthed, supabase]);

  // Si bulle ouverte mais détails manquent → compléter
  useEffect(() => {
    if (!postOnboarding || !isAuthed) return;
    if (!showMatchTestBubble || latestMatch) return;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: m } = await supabase
          .from('matches')
          .select('match_gender, match_age, distance_kilometre, score_pref_to_self')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (m) {
          setLatestMatch({
            match_gender: (m as any).match_gender ?? null,
            match_age: (m as any).match_age != null ? Number((m as any).match_age) : null,
            distance_kilometre: (m as any).distance_kilometre != null ? Number((m as any).distance_kilometre) : null,
            score_pref_to_self: (m as any).score_pref_to_self != null ? Number((m as any).score_pref_to_self) : null,
          });
        }
      } catch {}
    })();
  }, [postOnboarding, isAuthed, showMatchTestBubble, latestMatch, supabase]);

  // Pastille confirmée → charge initiales + affiche
  useEffect(() => {
    if (!postOnboarding) return;
    if (confirmButtonState === 'confirmed') {
      setShowConfirmedMatchBubble(true);
      (async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;
          const me = session?.user?.id;
          if (!me || !token) return;

          // trouver l’autre
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

          // (vérif miroir confirmée omise ici — déjà faite)
          // 🔧 IMPORTANT: l’API renvoie désormais { initials }, pas { full_name }
          const res = await fetch(`/api/ask?fn=user_name&id=${otherId}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const json = await res.json();
          const initials = (json?.initials ?? null) as string | null;
          setMatchInitials(initials);
        } catch (err) {
          console.error('Erreur noms miroir:', err);
        }
      })();
    } else {
      setShowConfirmedMatchBubble(false);
      setMatchInitials(null);
    }
  }, [confirmButtonState, postOnboarding, supabase, latestMatch]);

  // Photos du match confirmé
  useEffect(() => {
    if (!postOnboarding || !isAuthed || !showConfirmedMatchBubble) return;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const me = session?.user?.id;
        if (!me || !token) return;

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

        const res = await fetch(`/api/ask?fn=match_photos&id=${otherId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        setMatchPhotos(Array.isArray(json.photos) ? json.photos : []);
        setCurrentMatchPhoto(0);
      } catch (err) {
        console.error('💥 Erreur chargement photos match sécurisé:', err);
        setMatchPhotos([]);
      }
    })();
  }, [postOnboarding, isAuthed, showConfirmedMatchBubble, latestMatch, supabase]);

  // Cacher pastille si mon statut devient deleted/rejected
  useEffect(() => {
    if (!postOnboarding || !isAuthed) return;
    let channel: any;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user) return;
        channel = supabase
          .channel(`match-status-${user.id}`)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'matches', filter: `user_id=eq.${user.id}` },
            (payload: any) => {
              const newStatus = payload?.new?.status;
              if (newStatus === 'deleted' || newStatus === 'rejected') {
                setShowConfirmedMatchBubble(false);
                setMatchInitials(null);
              }
            }
          )
          .subscribe();
      } catch (err) {
        console.error('💥 Erreur Realtime match-status:', err);
      }
    })();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [postOnboarding, isAuthed, supabase]);

  // Fermer modale avec Échap
  useEffect(() => {
    if (!showMatchGallery) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowMatchGallery(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showMatchGallery]);

  // === Render ===
  return (
    <>
      {/* Bulle "New Match" */}
      {postOnboarding && showMatchTestBubble && (
        <div className="absolute inset-0 z-[20] flex items-center justify-center px-6 pointer-events-none">
          <div className="pointer-events-auto">
            <div
              className={`
                relative z-[91] w-[280px] h-[280px] md:w-[320px] md:h-[320px]
                rounded-full border-4 border-[var(--accent)]
                bg-[var(--bg)]
                shadow-[0_0_25px_var(--accent)]
                flex flex-col items-center justify-center text-center
              `}
            >
              <div className="absolute inset-0 rounded-full animate-[ping_1.5s_cubic-bezier(0,0,0.2,1)_infinite] bg-[var(--accent)] opacity-25" aria-hidden />
              <div className="absolute inset-0 rounded-full ring-1 ring-[var(--accent)] ring-opacity-30" aria-hidden />
              <div className="relative z-[92] px-6">
                <div className="text-sm uppercase tracking-widest opacity-80">New Match</div>
                <div className="mt-2 text-5xl font-extrabold leading-none">
                  {(() => {
                    const pct = roundScorePercent(latestMatch?.score_pref_to_self ?? null);
                    return pct != null ? `${pct}%` : '—';
                  })()}
                </div>
                <div className="mt-1 text-xs opacity-70">compatibility</div>
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
                        <p className="text-sm opacity-80 mb-6">This action cannot be undone. You will permanently reject this match.</p>
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
                                setShowConfirmDismiss(false);
                                setShowMatchTestBubble(false);
                                const { data: { session } } = await supabase.auth.getSession();
                                const token = session?.access_token;
                                if (!token) return;
                                await fetch('/api/ask', {
                                  method: 'PATCH',
                                  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ fn: 'dismiss_match' }),
                                });
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

                  {confirmButtonState === 'idle' ? (
                    <button
                      onClick={async () => {
                        try {
                          setConfirmButtonState('waiting');
                          const { data: { session } } = await supabase.auth.getSession();
                          const token = session?.access_token;
                          if (!token) return;

                          // match_user_id safe
                          let safeMatchUserId = latestMatch?.match_user_id ?? null;
                          if (!safeMatchUserId) {
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
                                if (last?.match_user_id) safeMatchUserId = last.match_user_id;
                              }
                            } catch (err) {
                              console.error('⚠️ Fallback match_user_id:', err);
                            }
                          }
                          if (!safeMatchUserId) return;

                          await fetch('/api/ask', {
                            method: 'PATCH',
                            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ fn: 'confirm_match' }),
                          });

                          // vérif symétrique immédiate
                          (async () => {
                            try {
                              const { data: { session } } = await supabase.auth.getSession();
                              const user = session?.user;
                              if (!user) return;

                              const targetId = safeMatchUserId as string;
                              const { data: rows } = await supabase
                                .from('matches')
                                .select('user_id, match_user_id, status')
                                .in('user_id', [user.id, targetId])
                                .or(`match_user_id.eq.${user.id},match_user_id.eq.${targetId}`);

                              const mine = rows?.find((r: any) => r.user_id === user.id && r.match_user_id === targetId);
                              const other = rows?.find((r: any) => r.user_id === targetId && r.match_user_id === user.id);

                              if (mine?.status === 'confirmed' && other?.status === 'confirmed') {
                                setConfirmButtonState('confirmed');
                              }
                            } catch (err) {
                              console.error('Erreur vérif symétrique immédiate après confirm:', err);
                            }
                          })();
                        } catch (err) {
                          console.error('Erreur confirm_match:', err);
                          setConfirmButtonState('idle');
                        }
                      }}
                      className="h-10 px-5 rounded-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white transition text-sm font-semibold"
                    >
                      Confirm
                    </button>
                  ) : confirmButtonState === 'waiting' ? (
                    <button
                      disabled
                      className="h-10 px-5 rounded-full border border-[var(--border)] text-[var(--text-muted)] bg-[var(--hover-surface)] cursor-wait transition text-sm font-medium"
                    >
                      In Review…
                    </button>
                  ) : confirmButtonState === 'rejected' ? (
                    <button
                      disabled
                      className="h-10 px-5 rounded-full bg-[var(--danger)] text-white cursor-not-allowed transition text-sm font-semibold"
                    >
                      Rejected
                    </button>
                  ) : (
                    <button
                      disabled
                      className="h-10 px-5 rounded-full bg-[var(--success)] text-white cursor-default transition text-sm font-semibold"
                    >
                      Confirmed
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pastille confirmée */}
      {postOnboarding && showConfirmedMatchBubble && (
        <button
          onClick={() => setShowMatchGallery((prev) => !prev)}
          className="fixed bottom-[118px] left-6 z-[20] ai-btn focus:outline-none"
          aria-label="Confirmed match"
        >
          <span className="relative block">
            <span className="ai-halo" aria-hidden />
            <span className="ai-pill inline-flex items-center justify-center h-12 min-w-12 px-3 rounded-full">
              <span className="ai-text text-sm font-semibold tracking-wide select-none">
                {matchInitials ?? '••'}
              </span>
            </span>
          </span>
        </button>
      )}

      {/* Modale match */}
      {showMatchGallery && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-[color-mix(in srgb,var(--bg) 60%,transparent)] backdrop-blur-[3px]"
            style={{ WebkitBackdropFilter: 'blur(8px)' as any }}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative z-[91] w-[min(95vw,1000px)] h-[min(85vh,680px)] rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-xl overflow-hidden flex"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sidebar */}
            <aside className="w-56 shrink-0 border-r border-[var(--border)] p-3 flex flex-col justify-center">
              <nav className="space-y-1">
                <SideTabButton active={matchModalTab === 'gallery'} onClick={() => setMatchModalTab('gallery')}>Gallery</SideTabButton>
                <SideTabButton active={matchModalTab === 'details'} onClick={() => setMatchModalTab('details')}>Profile</SideTabButton>
                <SideTabButton active={matchModalTab === 'chat'} onClick={() => setMatchModalTab('chat')}>Chat</SideTabButton>
              </nav>
            </aside>

            {/* Content */}
            <section className="relative flex-1 overflow-y-auto p-4 sm:p-6">
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

              {/* Chat */}
              {matchModalTab === 'chat' && (
                <div className="relative h-full flex flex-col">
                  {!chatReady ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
                      <div className="text-lg font-semibold mb-1">Chat is locked</div>
                      <div className="text-sm opacity-70 max-w-sm">Chat becomes available once both of you confirm the match.</div>
                    </div>
                  ) : (
                    <>
                      <div
                        ref={chatListRef}
                        className="flex-1 overflow-y-auto space-y-2 pr-4"
                        style={{ ['scrollbarGutter' as any]: 'stable both-edges' }}
                      >
                        {chatBooting && <div className="text-sm opacity-60 text-center mt-6">Loading messages…</div>}
                        {!chatBooting && chatMessages.length === 0 && <div className="text-sm opacity-60 text-center mt-6">Say hi and break the ice ✦</div>}
                        {!chatBooting && chatMessages.map((m) => {
                          const mine = chatMeId != null && m.sender_id === chatMeId;
                          return (
                            <div key={m.id} className={`w-full flex ${mine ? 'justify-end' : 'justify-start'}`}>
                              <div className={`max-w-[75%] rounded-2xl px-3 py-2 shadow-sm ${mine ? 'bg-[var(--accent)] text-white' : 'border border-[var(--border)] bg-[var(--bg)]'}`}>
                                <div className="whitespace-pre-wrap leading-relaxed text-sm">{m.body}</div>
                                <div className={`mt-1 text-[10px] opacity-70 ${mine ? 'text-white/80' : 'text-[var(--text-muted)]'}`}>
                                  {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
                        {chatError && <div className="text-xs text-[var(--danger)] mb-2">{chatError}</div>}
                        <div className="flex items-end gap-2">
                          <textarea
                            value={chatInput}
                            onChange={(e) => { setChatInput(e.target.value.slice(0, 4000)); emitTyping(); }}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendChat(); } }}
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

      {/* Zoom photo */}
      {zoomedPhoto && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[color-mix(in srgb,var(--bg) 70%,transparent)] backdrop-blur-[10px] animate-[fadeIn_0.25s_ease-out]">
          <button
            onClick={() => setZoomedPhoto(null)}
            className="absolute top-6 right-6 text-[var(--text)] opacity-80 hover:opacity-100 text-1xl"
            title="Close zoom"
          >
            ✕
          </button>
          <img
            src={zoomedPhoto}
            alt="Zoomed match photo"
            className="max-h-[85vh] max-w-[90vw] rounded-3xl shadow-[0_12px_48px_color-mix(in_srgb,var(--accent)_30%,transparent)] object-contain transition-transform duration-300"
          />
        </div>
      )}
    </>
  );
}
