"use client";

import { useEffect, useRef, useState, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const ANAM_SDK = "https://esm.sh/@anam-ai/js-sdk";
const FRAME_INTERVAL_MS = 4000;

interface Message  { role: "veda" | "user"; content: string; time: string; }
interface LocationInfo { matched: boolean; node_id: string | null; name: string | null; confidence: number; }
interface AvatarOption { name: string; label: string; gender: "male" | "female"; }

type CallStatus = "idle" | "connecting" | "live" | "ended";
type Language   = "en" | "te" | "hi";

const LANG_LABELS: Record<Language, string> = { en: "EN", te: "తె", hi: "हि" };
const LANG_CODE:   Record<Language, string> = { en: "en-IN", te: "te-IN", hi: "hi-IN" };

const AVATARS: AvatarOption[] = [
  { name: "finn",   label: "Finn",   gender: "male"   },
  { name: "hunter", label: "Hunter", gender: "male"   },
  { name: "kevin",  label: "Kevin",  gender: "male"   },
  { name: "mia",    label: "Mia",    gender: "female" },
  { name: "layla",  label: "Layla",  gender: "female" },
  { name: "emily",  label: "Emily",  gender: "female" },
];

export default function TraversePage() {
  // ── Refs ────────────────────────────────────────────────────────
  const videoRef        = useRef<HTMLVideoElement>(null);
  const avatarVideoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const chatRef         = useRef<HTMLDivElement>(null);
  const streamRef       = useRef<MediaStream | null>(null);
  const frameTimerRef   = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef  = useRef<any>(null);
  const anamClientRef   = useRef<any>(null);

  // ── State ───────────────────────────────────────────────────────
  const [callStatus,   setCallStatus]   = useState<CallStatus>("idle");
  const [sessionId,    setSessionId]    = useState("");
  const [messages,     setMessages]     = useState<Message[]>([]);
  const [location,     setLocation]     = useState<LocationInfo | null>(null);
  const [language,     setLanguage]     = useState<Language>("en");
  const [isSpeaking,   setIsSpeaking]   = useState(false);
  const [isListening,  setIsListening]  = useState(false);
  const [sceneText,    setSceneText]    = useState("");
  const [irisLog,      setIrisLog]      = useState<string[]>([]);
  const [facingMode,   setFacingMode]   = useState<"environment"|"user">("environment");
  const [showIrisLog,  setShowIrisLog]  = useState(false);
  const [showChat,     setShowChat]     = useState(true);
  const [lastVedaMsg,  setLastVedaMsg]  = useState("");
  const [selectedAvatar, setSelectedAvatar] = useState<string>("finn");
  const [avatarReady,  setAvatarReady]  = useState(false);
  const [avatarError,  setAvatarError]  = useState(false);

  // ── Refs that closures need fresh ───────────────────────────────
  const isSpeakingRef   = useRef(false);
  const callStatusRef   = useRef<CallStatus>("idle");
  const sessionIdRef    = useRef("");
  const languageRef     = useRef<Language>("en");
  const isProcessingRef = useRef(false);
  const speechQueueRef  = useRef<string[]>([]);
  const isSpeakingQRef  = useRef(false);

  useEffect(() => { isSpeakingRef.current  = isSpeaking;  }, [isSpeaking]);
  useEffect(() => { callStatusRef.current  = callStatus;  }, [callStatus]);
  useEffect(() => { sessionIdRef.current   = sessionId;   }, [sessionId]);
  useEffect(() => { languageRef.current    = language;    }, [language]);

  // ── Add message ─────────────────────────────────────────────────
  const addMessage = useCallback((role: "veda"|"user", content: string) => {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages(prev => [...prev, { role, content, time }]);
    if (role === "veda") setLastVedaMsg(content);
    setTimeout(() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" }), 100);
  }, []);

  // ── Anam: speak via avatar ──────────────────────────────────────
  const anamTalk = useCallback(async (text: string) => {
    if (!anamClientRef.current || !avatarReady) return false;
    try {
      await anamClientRef.current.talk(text);
      return true;
    } catch (e) {
      console.error("[anam] talk error:", e);
      return false;
    }
  }, [avatarReady]);

  const anamStop = useCallback(() => {
    if (!anamClientRef.current) return;
    try { anamClientRef.current.interruptPersona(); } catch {}
  }, []);

  // ── Speech queue ────────────────────────────────────────────────
  const processQueue = useCallback(() => {
    if (isSpeakingQRef.current) return;
    if (speechQueueRef.current.length === 0) return;

    const text = speechQueueRef.current.shift()!;
    isSpeakingQRef.current = true;
    isSpeakingRef.current  = true;
    setIsSpeaking(true);

    try { recognitionRef.current?.stop(); } catch {}

    // Try Anam first, fall back to browser TTS
    const speakWithFallback = async () => {
      const usedAnam = await anamTalk(text);
      if (!usedAnam) {
        // Browser TTS fallback
        const synth = window.speechSynthesis;
        synth.cancel();
        const utt    = new SpeechSynthesisUtterance(text);
        utt.lang     = LANG_CODE[languageRef.current];
        utt.rate     = 0.92;
        utt.pitch    = 1.05;
        const voices = synth.getVoices();
        const match  = voices.find(v => v.lang.startsWith(languageRef.current === "te" ? "te" : languageRef.current === "hi" ? "hi" : "en"));
        if (match) utt.voice = match;

        return new Promise<void>(resolve => {
          utt.onend  = () => resolve();
          utt.onerror = () => resolve();
          synth.speak(utt);
        });
      }

      // Wait for Anam to finish (estimate from text length)
      return new Promise<void>(resolve => {
        setTimeout(resolve, Math.max(2000, text.length * 60));
      });
    };

    speakWithFallback().then(() => {
      isSpeakingQRef.current = false;
      isSpeakingRef.current  = false;
      setIsSpeaking(false);
      setTimeout(() => {
        if (callStatusRef.current === "live") restartListening();
        processQueue();
      }, 1200);
    });
  }, [anamTalk]);

  const vedaSpeak = useCallback((text: string) => {
    if (!text) return;
    addMessage("veda", text);
    speechQueueRef.current.push(text);
    processQueue();
  }, [addMessage, processQueue]);

  // ── STT ─────────────────────────────────────────────────────────
  const restartListening = useCallback(() => {
    if (isSpeakingRef.current)            return;
    if (callStatusRef.current !== "live") return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    try { recognitionRef.current?.stop(); } catch {}
    recognitionRef.current = null;
    const rec = new SR();
    rec.lang = LANG_CODE[languageRef.current];
    rec.continuous = false;
    rec.interimResults = false;
    rec.onstart  = () => setIsListening(true);
    rec.onend    = () => {
      setIsListening(false);
      setTimeout(() => {
        if (!isSpeakingRef.current && callStatusRef.current === "live") restartListening();
      }, 500);
    };
    rec.onresult = async (e: any) => {
      if (isSpeakingRef.current) return;
      const result = e.results[0];
      if (!result?.isFinal) return;
      const transcript = result[0].transcript.trim();
      if (!transcript || transcript.length < 2) return;
      // Stop avatar while user speaks
      anamStop();
      addMessage("user", transcript);
      const sid = sessionIdRef.current;
      if (sid) await sendSpeech(transcript, sid);
    };
    rec.onerror = (e: any) => {
      setIsListening(false);
      if (e.error !== "aborted") {
        setTimeout(() => {
          if (!isSpeakingRef.current && callStatusRef.current === "live") restartListening();
        }, 1000);
      }
    };
    try { rec.start(); recognitionRef.current = rec; } catch {}
  }, [addMessage, anamStop]);

  // ── Init Anam avatar ────────────────────────────────────────────
  const initAnamAvatar = useCallback(async (avatarName: string) => {
    if (anamClientRef.current) return;
    try {
      const res = await fetch(`${API}/api/avatar/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar_name: avatarName }),
      });
      const data = await res.json();
      if (data.provider === "simli") return;

      const { createClient: _cc, AnamEvent: _AE } = await import(
        /* webpackIgnore: true */ ANAM_SDK as any
      );
      const client = _cc(data.sessionToken, { disableInputAudio: true });
      anamClientRef.current = client;

      // Stop Anam's own greeting immediately on connect
      client.addListener(_AE.CONNECTION_ESTABLISHED, () => {
        try { client.interruptPersona(); } catch {}
      });

      // Stop again when session is ready (in case greeting already started)
      client.addListener(_AE.SESSION_READY, () => {
        try { client.interruptPersona(); } catch {}
        setAvatarReady(true);
      });

      // Attach stream directly to ref when video starts
      client.addListener(_AE.VIDEO_STREAM_STARTED, (stream: MediaStream) => {
        if (avatarVideoRef.current) {
          avatarVideoRef.current.srcObject = stream;
          avatarVideoRef.current.style.display = "block";
          avatarVideoRef.current.play()
            .then(() => setAvatarReady(true))
            .catch(() => setAvatarReady(true));
        }
      });

      client.addListener(_AE.VIDEO_PLAY_STARTED, () => setAvatarReady(true));

      // Start streaming
      const streams = await client.stream();
      if (streams.length > 0 && avatarVideoRef.current) {
        const videoStream = streams.find((s: MediaStream) => s.getVideoTracks().length > 0) || streams[0];
        avatarVideoRef.current.srcObject = videoStream;
        avatarVideoRef.current.style.display = "block";
        avatarVideoRef.current.play()
          .then(() => setAvatarReady(true))
          .catch(() => setAvatarReady(true));
      }

    } catch {
      setAvatarError(true);
    }
  }, []);

  // ── Camera ──────────────────────────────────────────────────────
  const startCamera = async (facing: "environment"|"user" = "environment") => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      return true;
    } catch { return false; }
  };

  const captureFrame = (): string | null => {
    const video = videoRef.current, canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;
    canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, 320, 240);
    return canvas.toDataURL("image/jpeg", 0.75).split(",")[1];
  };

  // ── API calls ───────────────────────────────────────────────────
  const sendFrame = async (image_b64: string, sid: string) => {
    if (isProcessingRef.current || isSpeakingRef.current) return;
    isProcessingRef.current = true;
    try {
      const res  = await fetch(`${API}/api/traverse/frame`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sid, image_b64, image_mime: "image/jpeg", language: languageRef.current }),
      });
      const data = await res.json();
      if (data.location) setLocation(data.location);
      if (data.scene) {
        setSceneText(data.scene);
        const t    = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const conf = data.location?.confidence ? ` ${Math.round(data.location.confidence * 100)}%` : "";
        const loc  = data.location?.matched ? ` [${data.location.name}${conf}]` : " [scanning]";
        setIrisLog(prev => [`${t}${loc}: ${data.scene}`, ...prev].slice(0, 8));
      }
      if (data.has_response && data.veda_response) vedaSpeak(data.veda_response);
    } catch {}
    finally { isProcessingRef.current = false; }
  };

  const sendSpeech = async (transcript: string, sid: string) => {
    try {
      const res  = await fetch(`${API}/api/traverse/speech`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sid, user_speech: transcript, language: languageRef.current }),
      });
      const data = await res.json();
      if (data.veda_response) vedaSpeak(data.veda_response);
    } catch {}
  };

  // ── Start call ──────────────────────────────────────────────────
  const startCall = async () => {
    setCallStatus("connecting");
    callStatusRef.current = "connecting";

    // Start camera first
    const camOk = await startCamera(facingMode);
    if (!camOk) { setCallStatus("idle"); callStatusRef.current = "idle"; return; }

    try {
      const res  = await fetch(`${API}/api/traverse/start`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: null, language }),
      });
      const data = await res.json();
      setSessionId(data.session_id);
      sessionIdRef.current = data.session_id;
      setCallStatus("live");
      callStatusRef.current = "live";

      if (data.veda_response) vedaSpeak(data.veda_response);

      const sid = data.session_id;
      frameTimerRef.current = setInterval(() => {
        const frame = captureFrame();
        if (frame) sendFrame(frame, sid);
      }, FRAME_INTERVAL_MS);

      setTimeout(() => restartListening(), 3000);

      // Init Anam AFTER React renders the live call UI (so avatarVideoRef exists in DOM)
      setTimeout(() => initAnamAvatar(selectedAvatar), 300);

    } catch {
      setCallStatus("idle");
      callStatusRef.current = "idle";
    }
  };

  // ── End call ────────────────────────────────────────────────────
  const endCall = useCallback(() => {
    callStatusRef.current = "ended";
    if (frameTimerRef.current) clearInterval(frameTimerRef.current);
    try { recognitionRef.current?.stop(); } catch {}
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    try { anamClientRef.current?.stopStreaming(); } catch {}
    window.speechSynthesis?.cancel();
    speechQueueRef.current  = [];
    isSpeakingQRef.current  = false;
    isProcessingRef.current = false;
    anamClientRef.current   = null;
    setCallStatus("ended");
    setIsListening(false);
    setIsSpeaking(false);
    setAvatarReady(false);
  }, []);

  const switchCamera = async () => {
    const newMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newMode);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: newMode }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
    } catch {}
  };

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.speechSynthesis?.getVoices();
      window.speechSynthesis?.addEventListener?.("voiceschanged", () => window.speechSynthesis.getVoices());
    }
    return () => { endCall(); };
  }, []);

  const resetCall = () => {
    setCallStatus("idle"); setMessages([]); setLocation(null);
    setSceneText(""); setSessionId(""); sessionIdRef.current = "";
    speechQueueRef.current = []; setLastVedaMsg("");
    setAvatarReady(false); setAvatarError(false);
  };

  // ── Avatar PiP ──────────────────────────────────────────────────
  const AvatarPiP = () => {
    const avatar = AVATARS.find(a => a.name === selectedAvatar);
    const initials = avatar?.label.slice(0, 2).toUpperCase() || "VE";

    return (
      <div className="veda-pip">
        {/* Real avatar video — shown when Anam is ready */}
        <video
          ref={avatarVideoRef}
          id="anam-avatar-video"
          autoPlay
          playsInline
          style={{
            width: "100%", height: "100%",
            objectFit: "cover", borderRadius: "50%",
            display: avatarReady ? "block" : "none",
          }}
        />
        {/* Letter avatar — shown while connecting or on fallback */}
        {!avatarReady && (
          <div style={{
            width: "100%", height: "100%", borderRadius: "50%",
            background: "linear-gradient(135deg, #1a3a38 0%, #0d2220 100%)",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: "2px",
          }}>
            <span style={{ fontFamily: "'Bebas Neue'", fontSize: "22px", color: "var(--accent)", letterSpacing: "0.05em" }}>
              {initials}
            </span>
            {isSpeaking && (
              <div style={{ display: "flex", gap: "2px", alignItems: "center" }}>
                {[1,2,3].map(i => (
                  <div key={i} style={{
                    width: "2px", borderRadius: "1px", background: "var(--accent)",
                    height: `${4 + i * 2}px`,
                    animation: `wave ${0.5 + i * 0.1}s ease-in-out infinite alternate`,
                  }} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── IDLE screen — Choose Your Guide ─────────────────────────────
  if (callStatus === "idle") {
    return (
      <div style={{
        height: "calc(100vh - 56px)", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        background: "var(--bg)", gap: "28px", padding: "24px",
      }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontFamily: "'Bebas Neue'", fontSize: "32px", color: "var(--accent)", letterSpacing: "0.1em" }}>
            Choose Your Guide
          </p>
          <p style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>
            Your AI spatial navigator
          </p>
        </div>

        {/* Male avatars */}
        <div style={{ width: "100%", maxWidth: "420px" }}>
          <p className="label" style={{ marginBottom: "10px", textAlign: "center" }}>Male</p>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
            {AVATARS.filter(a => a.gender === "male").map(avatar => (
              <button key={avatar.name} onClick={() => setSelectedAvatar(avatar.name)} style={{
                width: "100px", padding: "14px 0", borderRadius: "16px",
                border: `2px solid ${selectedAvatar === avatar.name ? "var(--accent)" : "var(--border)"}`,
                background: selectedAvatar === avatar.name ? "var(--accent-glow)" : "var(--surface)",
                color: selectedAvatar === avatar.name ? "var(--accent)" : "var(--text-muted)",
                cursor: "pointer", transition: "all 0.15s",
                display: "flex", flexDirection: "column", alignItems: "center", gap: "8px",
              }}>
                {/* Avatar circle */}
                <div style={{
                  width: "48px", height: "48px", borderRadius: "50%",
                  background: `linear-gradient(135deg, ${selectedAvatar === avatar.name ? "#1a3a38" : "#1a1a1a"}, #0d0d0d)`,
                  border: `1.5px solid ${selectedAvatar === avatar.name ? "var(--accent)" : "var(--border)"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "18px", fontWeight: 700, color: selectedAvatar === avatar.name ? "var(--accent)" : "var(--text-dim)",
                  fontFamily: "'Bebas Neue'",
                }}>
                  {avatar.label.slice(0, 2)}
                </div>
                <span style={{ fontSize: "13px", fontWeight: 600 }}>{avatar.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Female avatars */}
        <div style={{ width: "100%", maxWidth: "420px" }}>
          <p className="label" style={{ marginBottom: "10px", textAlign: "center" }}>Female</p>
          <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
            {AVATARS.filter(a => a.gender === "female").map(avatar => (
              <button key={avatar.name} onClick={() => setSelectedAvatar(avatar.name)} style={{
                width: "100px", padding: "14px 0", borderRadius: "16px",
                border: `2px solid ${selectedAvatar === avatar.name ? "var(--accent)" : "var(--border)"}`,
                background: selectedAvatar === avatar.name ? "var(--accent-glow)" : "var(--surface)",
                color: selectedAvatar === avatar.name ? "var(--accent)" : "var(--text-muted)",
                cursor: "pointer", transition: "all 0.15s",
                display: "flex", flexDirection: "column", alignItems: "center", gap: "8px",
              }}>
                <div style={{
                  width: "48px", height: "48px", borderRadius: "50%",
                  background: `linear-gradient(135deg, ${selectedAvatar === avatar.name ? "#1a3a38" : "#1a1a1a"}, #0d0d0d)`,
                  border: `1.5px solid ${selectedAvatar === avatar.name ? "var(--accent)" : "var(--border)"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "18px", fontWeight: 700, color: selectedAvatar === avatar.name ? "var(--accent)" : "var(--text-dim)",
                  fontFamily: "'Bebas Neue'",
                }}>
                  {avatar.label.slice(0, 2)}
                </div>
                <span style={{ fontSize: "13px", fontWeight: 600 }}>{avatar.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Language */}
        <div style={{ display: "flex", gap: "8px" }}>
          {(["en", "te", "hi"] as Language[]).map(lang => (
            <button key={lang} onClick={() => { setLanguage(lang); languageRef.current = lang; }} style={{
              padding: "7px 16px", borderRadius: "20px",
              border: `1px solid ${language === lang ? "var(--accent)" : "var(--border)"}`,
              background: language === lang ? "var(--accent-glow)" : "transparent",
              color: language === lang ? "var(--accent)" : "var(--text-muted)",
              fontSize: "12px", fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
            }}>
              {lang === "en" ? "English" : lang === "te" ? "తెలుగు" : "हिंदी"}
            </button>
          ))}
        </div>

        {/* Start button */}
        <button onClick={startCall} style={{
          display: "flex", alignItems: "center", gap: "12px",
          background: "var(--accent)", color: "#000",
          border: "none", borderRadius: "48px",
          padding: "14px 40px", fontSize: "15px", fontWeight: 700,
          cursor: "pointer", boxShadow: "0 4px 24px rgba(46,196,182,0.3)",
          fontFamily: "'Inter', sans-serif",
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
          </svg>
          Start Navigation with {AVATARS.find(a => a.name === selectedAvatar)?.label}
        </button>
      </div>
    );
  }

  // ── CONNECTING ───────────────────────────────────────────────────
  if (callStatus === "connecting") {
    const avatar = AVATARS.find(a => a.name === selectedAvatar);
    return (
      <div style={{
        height: "calc(100vh - 56px)", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", background: "#000", gap: "20px",
      }}>
        <div style={{
          width: "80px", height: "80px", borderRadius: "50%",
          background: "linear-gradient(135deg, #1a3a38, #0d2220)",
          border: "2px solid var(--accent)",
          boxShadow: "0 0 24px rgba(46,196,182,0.3)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "'Bebas Neue'", fontSize: "28px", color: "var(--accent)",
        }}>
          {avatar?.label.slice(0, 2).toUpperCase()}
        </div>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontFamily: "'Bebas Neue'", fontSize: "20px", color: "var(--accent)", letterSpacing: "0.1em" }}>
            {avatar?.label}
          </p>
          <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>Connecting...</p>
        </div>
      </div>
    );
  }

  // ── LIVE CALL ────────────────────────────────────────────────────
  return (
    <div style={{ height: "calc(100vh - 56px)", background: "#111", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>

      {/* Camera feed */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <video ref={videoRef} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        <canvas ref={canvasRef} style={{ display: "none" }} />

        {/* Gradient overlays */}
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, transparent 20%, transparent 60%, rgba(0,0,0,0.7) 100%)",
          pointerEvents: "none",
        }} />

        {/* ── Top bar ── */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
          {/* Left: LIVE + location */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "5px", background: "rgba(0,0,0,0.55)", borderRadius: "20px", padding: "5px 10px", backdropFilter: "blur(8px)" }}>
              <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: callStatus === "live" ? "#ff4444" : "var(--text-dim)", boxShadow: callStatus === "live" ? "0 0 5px #ff4444" : "none", animation: callStatus === "live" ? "pulse 2s infinite" : "none" }} />
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#fff", letterSpacing: "0.06em" }}>{callStatus === "live" ? "LIVE" : "ENDED"}</span>
            </div>
            {location?.matched && (
              <div style={{ display: "flex", alignItems: "center", gap: "5px", background: "rgba(46,196,182,0.15)", borderRadius: "20px", padding: "5px 10px", backdropFilter: "blur(8px)", border: "1px solid rgba(46,196,182,0.3)", maxWidth: "130px", overflow: "hidden" }}>
                <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
                <span style={{ fontSize: "10px", fontWeight: 600, color: "var(--accent)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{location.name}</span>
              </div>
            )}
          </div>

          {/* Right: controls */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: "2px", background: "rgba(0,0,0,0.55)", borderRadius: "20px", padding: "3px", backdropFilter: "blur(8px)" }}>
              {(["en", "te", "hi"] as Language[]).map(lang => (
                <button key={lang} onClick={() => { setLanguage(lang); languageRef.current = lang; }} style={{
                  padding: "4px 8px", borderRadius: "14px", border: "none",
                  background: language === lang ? "var(--accent)" : "transparent",
                  color: language === lang ? "#000" : "rgba(255,255,255,0.6)",
                  fontSize: "10px", fontWeight: 700, cursor: "pointer", minWidth: "28px",
                }}>
                  {LANG_LABELS[lang]}
                </button>
              ))}
            </div>
            <button onClick={switchCamera} style={{ width: "34px", height: "34px", borderRadius: "50%", background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(8px)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px" }}>🔄</button>
            <button onClick={() => setShowIrisLog(p => !p)} style={{ width: "34px", height: "34px", borderRadius: "50%", background: showIrisLog ? "rgba(46,196,182,0.2)" : "rgba(0,0,0,0.55)", border: `1px solid ${showIrisLog ? "rgba(46,196,182,0.5)" : "rgba(255,255,255,0.12)"}`, backdropFilter: "blur(8px)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px" }}>👁</button>
          </div>
        </div>

        {/* ── Avatar PiP — right side, large ── */}
        <div className="veda-pip-wrap" style={{
          position: "absolute", top: "62px", right: "14px",
          display: "flex", flexDirection: "column", alignItems: "center", gap: "8px",
        }}>
          {/* Avatar video container */}
          <div style={{
            width: "140px", height: "160px",
            borderRadius: "20px", overflow: "hidden",
            border: `2px solid ${isSpeaking ? "var(--accent)" : avatarReady ? "rgba(46,196,182,0.5)" : "rgba(255,255,255,0.1)"}`,
            boxShadow: isSpeaking
              ? "0 0 0 4px rgba(46,196,182,0.15), 0 8px 32px rgba(0,0,0,0.6)"
              : "0 8px 32px rgba(0,0,0,0.5)",
            transition: "border-color 0.3s ease, box-shadow 0.3s ease",
            background: "#0a0a0a",
            position: "relative",
          }}>
            {/* Real Anam avatar video */}
            <video
              ref={avatarVideoRef}
              id="anam-avatar-video"
              autoPlay
              playsInline
              style={{
                width: "100%", height: "100%",
                objectFit: "cover",
                display: avatarReady ? "block" : "none",
              }}
            />

            {/* Placeholder while connecting */}
            {!avatarReady && (
              <div style={{
                width: "100%", height: "100%",
                background: "linear-gradient(160deg, #111a19 0%, #0d0d0d 100%)",
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: "12px",
              }}>
                {/* Spinning ring while connecting */}
                <div style={{
                  width: "56px", height: "56px", borderRadius: "50%",
                  border: "2px solid #1a1a1a",
                  borderTop: "2px solid var(--accent)",
                  animation: "spin 1s linear infinite",
                }} />
                <div style={{ textAlign: "center" }}>
                  <p style={{ fontFamily: "'Bebas Neue'", fontSize: "18px", color: "var(--accent)", letterSpacing: "0.1em" }}>
                    {AVATARS.find(a => a.name === selectedAvatar)?.label?.toUpperCase()}
                  </p>
                  <p style={{ fontSize: "9px", color: "rgba(255,255,255,0.3)", marginTop: "2px" }}>
                    connecting...
                  </p>
                </div>
              </div>
            )}

            {/* Speaking indicator overlay on video */}
            {avatarReady && isSpeaking && (
              <div style={{
                position: "absolute", bottom: "8px", left: "50%", transform: "translateX(-50%)",
                display: "flex", gap: "3px", alignItems: "center",
                background: "rgba(0,0,0,0.6)", borderRadius: "10px", padding: "4px 8px",
              }}>
                {[1,2,3,4].map(i => (
                  <div key={i} style={{
                    width: "3px", borderRadius: "2px", background: "var(--accent)",
                    height: `${6 + i * 3}px`,
                    animation: `wave ${0.4 + i * 0.1}s ease-in-out infinite alternate`,
                  }} />
                ))}
              </div>
            )}
          </div>

          {/* Name + status label */}
          <div style={{
            background: "rgba(0,0,0,0.7)", borderRadius: "12px",
            padding: "5px 12px", backdropFilter: "blur(8px)",
            textAlign: "center", border: "1px solid rgba(255,255,255,0.06)",
          }}>
            <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--accent)", letterSpacing: "0.06em" }}>
              {AVATARS.find(a => a.name === selectedAvatar)?.label?.toUpperCase() || "VEDA"}
            </p>
            <p style={{ fontSize: "9px", color: "rgba(255,255,255,0.4)", marginTop: "1px" }}>
              {isSpeaking ? "● speaking" : isListening ? "◉ listening" : avatarReady ? "● ready" : "◌ connecting"}
            </p>
          </div>
        </div>

        {/* IRIS log */}
        {showIrisLog && (
          <div className="iris-log-panel" style={{ position: "absolute", top: "60px", left: "14px", maxHeight: "200px", overflowY: "auto", background: "rgba(0,0,0,0.8)", borderRadius: "12px", padding: "12px", backdropFilter: "blur(12px)", border: "1px solid rgba(46,196,182,0.2)" }}>
            <p style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", color: "var(--accent)", marginBottom: "8px", textTransform: "uppercase" }}>IRIS Vision Log</p>
            {irisLog.length === 0
              ? <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)" }}>Waiting for frames...</p>
              : irisLog.map((log, i) => (
                  <p key={i} style={{ fontSize: "10px", color: i === 0 ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.35)", marginBottom: "4px", lineHeight: 1.5 }}>{log}</p>
                ))
            }
          </div>
        )}

        {/* Last VEDA message bubble */}
        {lastVedaMsg && callStatus === "live" && !showChat && (
          <div className="veda-bubble" style={{ position: "absolute", bottom: "88px", left: "12px", background: "rgba(0,0,0,0.75)", borderRadius: "16px", padding: "10px 14px", backdropFilter: "blur(12px)", border: "1px solid rgba(46,196,182,0.2)", animation: "fadeIn 0.3s ease" }}>
            <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.9)", lineHeight: 1.6 }}>{lastVedaMsg}</p>
          </div>
        )}

        {/* Chat overlay */}
        {showChat && (
          <div className="chat-panel" style={{ position: "absolute", bottom: "88px", left: "12px", maxHeight: "260px", background: "rgba(0,0,0,0.82)", borderRadius: "16px", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>Conversation</p>
              <button onClick={() => setShowChat(false)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: "14px" }}>×</button>
            </div>
            <div ref={chatRef} style={{ flex: 1, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
              {messages.length === 0 && <p style={{ color: "rgba(255,255,255,0.2)", fontSize: "12px", textAlign: "center", marginTop: "12px" }}>Waiting for {AVATARS.find(a => a.name === selectedAvatar)?.label}...</p>}
              {messages.map((msg, i) => (
                <div key={i} style={{ display: "flex", gap: "8px", flexDirection: msg.role === "user" ? "row-reverse" : "row", alignItems: "flex-end" }}>
                  {msg.role === "veda" && (
                    <div style={{ width: "24px", height: "24px", borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg, #1a3a38, #0d2220)", border: "1px solid var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", fontWeight: 700, color: "var(--accent)" }}>
                      {AVATARS.find(a => a.name === selectedAvatar)?.label.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div style={{ maxWidth: "80%", background: msg.role === "veda" ? "rgba(255,255,255,0.08)" : "var(--accent)", color: msg.role === "veda" ? "rgba(255,255,255,0.9)" : "#000", padding: "7px 11px", borderRadius: msg.role === "veda" ? "4px 12px 12px 12px" : "12px 4px 12px 12px", fontSize: "12px", lineHeight: 1.5 }}>
                    {msg.content}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom bar ── */}
      <div style={{ height: "72px", flexShrink: 0, background: "#161616", borderTop: "1px solid #222", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", paddingBottom: "env(safe-area-inset-bottom)" }}>
        {/* Left: mic status */}
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0, background: isListening ? "var(--success)" : isSpeaking ? "var(--accent)" : "#444", boxShadow: isListening ? "0 0 6px var(--success)" : isSpeaking ? "0 0 6px var(--accent)" : "none" }} />
          <span className="mic-label" style={{ fontSize: "11px", color: "#555" }}>
            {isListening ? "Listening" : isSpeaking ? "Speaking" : "Standby"}
          </span>
        </div>

        {/* Center: buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button onClick={() => setShowChat(p => !p)} style={{ width: "44px", height: "44px", borderRadius: "50%", background: showChat ? "rgba(46,196,182,0.2)" : "#252525", border: `1px solid ${showChat ? "rgba(46,196,182,0.4)" : "#333"}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "17px" }}>💬</button>

          {callStatus === "live" && (
            <button onClick={endCall} style={{ width: "52px", height: "52px", borderRadius: "50%", background: "#e05555", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(224,85,85,0.4)" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="white" style={{ transform: "rotate(135deg)" }}>
                <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
              </svg>
            </button>
          )}

          {callStatus === "ended" && (
            <button onClick={resetCall} style={{ width: "52px", height: "52px", borderRadius: "50%", background: "var(--accent)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(46,196,182,0.3)" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#000">
                <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
              </svg>
            </button>
          )}

          <button onClick={() => setShowIrisLog(p => !p)} style={{ width: "44px", height: "44px", borderRadius: "50%", background: showIrisLog ? "rgba(46,196,182,0.2)" : "#252525", border: `1px solid ${showIrisLog ? "rgba(46,196,182,0.4)" : "#333"}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>👁</button>
        </div>

        {/* Right: location */}
        <div className="conf-label" style={{ textAlign: "right" }}>
          {location?.matched
            ? <><p style={{ fontSize: "10px", color: "var(--accent)", fontWeight: 600, maxWidth: "80px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{location.name}</p>
               <p style={{ fontSize: "9px", color: "#444", marginTop: "1px" }}>{Math.round(location.confidence * 100)}%</p></>
            : <p style={{ fontSize: "10px", color: "#444" }}>Scanning</p>
          }
        </div>
      </div>

      <style>{`
        @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes spin   { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes wave   { from{transform:scaleY(0.5)} to{transform:scaleY(1.5)} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }

        .iris-log-panel { width: 290px; }
        .chat-panel     { width: min(360px, calc(100vw - 100px)); }
        .veda-bubble    { max-width: 340px; }
        .mic-label      { display: inline; }
        .conf-label     { min-width: 80px; }

        @media (max-width: 480px) {
          .iris-log-panel { width: calc(100vw - 28px); }
          .chat-panel     { width: calc(100vw - 24px); left: 12px !important; }
          .veda-bubble    { max-width: calc(100vw - 100px); }
          .mic-label      { display: none; }
          .conf-label     { display: none; }
          .veda-pip-wrap  { top: 58px !important; right: 8px !important; }
          .veda-pip-wrap > div:first-child { width: 100px !important; height: 120px !important; }
        }
      `}</style>
    </div>
  );
}