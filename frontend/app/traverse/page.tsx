"use client";

import { useEffect, useRef, useState, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Message {
  role: "veda" | "user";
  content: string;
  time: string;
}

interface LocationInfo {
  matched: boolean;
  node_id: string | null;
  name: string | null;
  confidence: number;
}

type CallStatus = "idle" | "connecting" | "live" | "ended";
type Language = "en" | "te" | "hi";

const LANG_LABELS: Record<Language, string> = {
  en: "EN",
  te: "తె",
  hi: "हि",
};

const LANG_FULL: Record<Language, string> = {
  en: "English",
  te: "తెలుగు",
  hi: "हिंदी",
};

const LANG_CODE: Record<Language, string> = {
  en: "en-IN",
  te: "te-IN",
  hi: "hi-IN",
};

const FRAME_INTERVAL_MS = 4000;

export default function TraversePage() {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const chatRef       = useRef<HTMLDivElement>(null);
  const streamRef     = useRef<MediaStream | null>(null);
  const frameTimerRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = useRef<any>(null);

  const [callStatus, setCallStatus]   = useState<CallStatus>("idle");
  const [sessionId, setSessionId]     = useState<string>("");
  const [messages, setMessages]       = useState<Message[]>([]);
  const [location, setLocation]       = useState<LocationInfo | null>(null);
  const [language, setLanguage]       = useState<Language>("en");
  const [isSpeaking, setIsSpeaking]   = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [sceneText, setSceneText]     = useState("");
  const [irisLog, setIrisLog]         = useState<string[]>([]);
  const [facingMode, setFacingMode]   = useState<"environment" | "user">("environment");
  const [showIrisLog, setShowIrisLog] = useState(false);
  const [showChat, setShowChat]       = useState(true);
  const [lastVedaMsg, setLastVedaMsg] = useState<string>("");

  // Refs for fresh closure access
  const isSpeakingRef   = useRef(false);
  const callStatusRef   = useRef<CallStatus>("idle");
  const sessionIdRef    = useRef<string>("");
  const languageRef     = useRef<Language>("en");
  const isProcessingRef = useRef(false);

  // Speech queue
  const speechQueueRef  = useRef<string[]>([]);
  const isSpeakingQRef  = useRef(false);

  useEffect(() => { isSpeakingRef.current  = isSpeaking;  }, [isSpeaking]);
  useEffect(() => { callStatusRef.current  = callStatus;  }, [callStatus]);
  useEffect(() => { sessionIdRef.current   = sessionId;   }, [sessionId]);
  useEffect(() => { languageRef.current    = language;    }, [language]);

  // ── Add message ──────────────────────────────────────
  const addMessage = useCallback((role: "veda" | "user", content: string) => {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages(prev => [...prev, { role, content, time }]);
    if (role === "veda") setLastVedaMsg(content);
    setTimeout(() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" }), 100);
  }, []);

  // ── Speech queue processor ────────────────────────────
  const processQueue = useCallback(() => {
    if (isSpeakingQRef.current) return;
    if (speechQueueRef.current.length === 0) return;

    const text = speechQueueRef.current.shift()!;
    isSpeakingQRef.current = true;
    isSpeakingRef.current  = true;
    setIsSpeaking(true);

    try { recognitionRef.current?.stop(); } catch {}

    const synth = window.speechSynthesis;
    synth.cancel();

    const utt    = new SpeechSynthesisUtterance(text);
    utt.lang     = LANG_CODE[languageRef.current];
    utt.rate     = 0.92;
    utt.pitch    = 1.05;

    const voices     = synth.getVoices();
    const langPrefix = languageRef.current === "te" ? "te" : languageRef.current === "hi" ? "hi" : "en";
    const match      = voices.find(v => v.lang.startsWith(langPrefix)) || voices.find(v => v.lang.startsWith("en"));
    if (match) utt.voice = match;

    utt.onend = () => {
      isSpeakingQRef.current = false;
      isSpeakingRef.current  = false;
      setIsSpeaking(false);
      setTimeout(() => {
        if (callStatusRef.current === "live") restartListening();
        processQueue();
      }, 1200);
    };

    utt.onerror = () => {
      isSpeakingQRef.current = false;
      isSpeakingRef.current  = false;
      setIsSpeaking(false);
      setTimeout(() => {
        if (callStatusRef.current === "live") restartListening();
        processQueue();
      }, 800);
    };

    synth.speak(utt);
  }, []);

  const vedaSpeak = useCallback((text: string) => {
    if (!text || typeof window === "undefined") return;
    addMessage("veda", text);
    speechQueueRef.current.push(text);
    processQueue();
  }, [addMessage, processQueue]);

  // ── STT ──────────────────────────────────────────────
  const restartListening = useCallback(() => {
    if (isSpeakingRef.current)            return;
    if (callStatusRef.current !== "live") return;

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    try { recognitionRef.current?.stop(); } catch {}
    recognitionRef.current = null;

    const rec          = new SR();
    rec.lang           = LANG_CODE[languageRef.current];
    rec.continuous     = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onstart = () => setIsListening(true);

    rec.onend = () => {
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
  }, [addMessage]);

  // ── Camera ───────────────────────────────────────────
  const startCamera = async (facing: "environment" | "user" = "environment") => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
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

  // ── API ──────────────────────────────────────────────
  const sendFrame = async (image_b64: string, sid: string) => {
    if (isProcessingRef.current || isSpeakingRef.current) return;
    isProcessingRef.current = true;
    try {
      const res  = await fetch(`${API}/api/traverse/frame`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sid, image_b64, image_mime: "image/jpeg", language: languageRef.current }),
      });
      const data = await res.json();
      if (data.location) setLocation(data.location);
      if (data.scene) {
        setSceneText(data.scene);
        const t = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sid, user_speech: transcript, language: languageRef.current }),
      });
      const data = await res.json();
      if (data.veda_response) vedaSpeak(data.veda_response);
    } catch {}
  };

  // ── Call control ─────────────────────────────────────
  const startCall = async () => {
    setCallStatus("connecting");
    callStatusRef.current = "connecting";

    const camOk = await startCamera(facingMode);
    if (!camOk) { setCallStatus("idle"); callStatusRef.current = "idle"; return; }

    try {
      const res  = await fetch(`${API}/api/traverse/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    } catch {
      setCallStatus("idle");
      callStatusRef.current = "idle";
    }
  };

  const endCall = useCallback(() => {
    callStatusRef.current = "ended";
    if (frameTimerRef.current) clearInterval(frameTimerRef.current);
    try { recognitionRef.current?.stop(); } catch {}
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    window.speechSynthesis?.cancel();
    speechQueueRef.current  = [];
    isSpeakingQRef.current  = false;
    isProcessingRef.current = false;
    setCallStatus("ended");
    setIsListening(false);
    setIsSpeaking(false);
  }, []);

  const switchCamera = async () => {
    const newMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newMode);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: newMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
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

  // ── VEDA avatar initials ──────────────────────────────
  const VedaAvatar = ({ size = 80, speaking = false }: { size?: number; speaking?: boolean }) => (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: "linear-gradient(135deg, #1a3a38 0%, #0d2220 100%)",
      border: `2px solid ${speaking ? "var(--accent)" : "#2a2a2a"}`,
      boxShadow: speaking ? "0 0 0 4px rgba(46,196,182,0.2), 0 0 20px rgba(46,196,182,0.15)" : "none",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexDirection: "column", gap: "2px",
      transition: "all 0.3s ease",
      flexShrink: 0,
    }}>
      <span style={{
        fontFamily: "'Bebas Neue', sans-serif",
        fontSize: size * 0.32,
        color: "var(--accent)",
        letterSpacing: "0.05em",
        lineHeight: 1,
      }}>V</span>
      {speaking && (
        <div style={{ display: "flex", gap: "2px", alignItems: "center" }}>
          {[1,2,3].map(i => (
            <div key={i} style={{
              width: "2px", borderRadius: "1px",
              background: "var(--accent)",
              height: `${4 + i * 2}px`,
              animation: `wave ${0.5 + i * 0.1}s ease-in-out infinite alternate`,
            }} />
          ))}
        </div>
      )}
    </div>
  );

  // ── Idle screen ───────────────────────────────────────
  if (callStatus === "idle") {
    return (
      <div style={{
        height: "calc(100vh - 56px)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        background: "var(--bg)", gap: "32px",
      }}>
        {/* VEDA avatar */}
        <VedaAvatar size={100} />

        <div style={{ textAlign: "center" }}>
          <p style={{ fontFamily: "'Bebas Neue'", fontSize: "28px", color: "var(--accent)", letterSpacing: "0.1em" }}>
            VEDA
          </p>
          <p style={{ fontSize: "14px", color: "var(--text-muted)", marginTop: "4px" }}>
            AI Spatial Guide · Inevi
          </p>
        </div>

        <p style={{ fontSize: "13px", color: "var(--text-dim)", textAlign: "center", maxWidth: "280px", lineHeight: 1.7 }}>
          VEDA sees through your camera, identifies where you are, and guides you to your destination.
        </p>

        {/* Language selector */}
        <div style={{ display: "flex", gap: "8px" }}>
          {(["en", "te", "hi"] as Language[]).map(lang => (
            <button key={lang} onClick={() => { setLanguage(lang); languageRef.current = lang; }} style={{
              padding: "7px 16px", borderRadius: "20px", border: "1px solid",
              borderColor: language === lang ? "var(--accent)" : "var(--border)",
              background:  language === lang ? "var(--accent-glow)" : "transparent",
              color:       language === lang ? "var(--accent)" : "var(--text-muted)",
              fontSize: "12px", fontWeight: 600, cursor: "pointer",
              transition: "all 0.15s",
            }}>
              {LANG_FULL[lang]}
            </button>
          ))}
        </div>

        {/* Start call button */}
        <button onClick={startCall} style={{
          display: "flex", alignItems: "center", gap: "12px",
          background: "var(--accent)", color: "#000",
          border: "none", borderRadius: "48px",
          padding: "14px 36px", fontSize: "15px", fontWeight: 700,
          cursor: "pointer", letterSpacing: "0.02em",
          fontFamily: "'Inter', sans-serif",
          boxShadow: "0 4px 24px rgba(46,196,182,0.3)",
          transition: "all 0.2s",
        }}>
          {/* Phone icon */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
          </svg>
          Start Navigation
        </button>
      </div>
    );
  }

  // ── Connecting ───────────────────────────────────────
  if (callStatus === "connecting") {
    return (
      <div style={{
        height: "calc(100vh - 56px)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        background: "#000", gap: "24px",
      }}>
        <VedaAvatar size={90} speaking />
        <div style={{ textAlign: "center" }}>
          <p style={{ fontFamily: "'Bebas Neue'", fontSize: "22px", color: "var(--accent)", letterSpacing: "0.1em" }}>VEDA</p>
          <p style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>Connecting...</p>
        </div>
      </div>
    );
  }

  // ── Live / Ended call ────────────────────────────────
  return (
    <div style={{ height: "calc(100vh - 56px)", background: "#111", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>

      {/* ── Main video area ── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>

        {/* User camera feed — full screen */}
        <video ref={videoRef} autoPlay muted playsInline style={{
          width: "100%", height: "100%", objectFit: "cover",
          display: "block",
        }} />
        <canvas ref={canvasRef} style={{ display: "none" }} />

        {/* Dark gradient overlay — top and bottom */}
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, transparent 20%, transparent 60%, rgba(0,0,0,0.7) 100%)",
          pointerEvents: "none",
        }} />

        {/* ── Top bar ── */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0,
          padding: "16px 20px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          {/* Left: LIVE + location */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {/* Live dot */}
            <div style={{
              display: "flex", alignItems: "center", gap: "6px",
              background: "rgba(0,0,0,0.5)", borderRadius: "20px",
              padding: "5px 12px", backdropFilter: "blur(8px)",
            }}>
              <div style={{
                width: "7px", height: "7px", borderRadius: "50%",
                background: callStatus === "live" ? "#ff4444" : "var(--text-dim)",
                boxShadow: callStatus === "live" ? "0 0 6px #ff4444" : "none",
                animation: callStatus === "live" ? "pulse 2s infinite" : "none",
              }} />
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#fff", letterSpacing: "0.06em" }}>
                {callStatus === "live" ? "LIVE" : "ENDED"}
              </span>
            </div>

            {/* Location pill */}
            {location?.matched && (
              <div style={{
                display: "flex", alignItems: "center", gap: "6px",
                background: "rgba(46,196,182,0.15)", borderRadius: "20px",
                padding: "5px 12px", backdropFilter: "blur(8px)",
                border: "1px solid rgba(46,196,182,0.3)",
              }}>
                <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "var(--accent)" }} />
                <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--accent)" }}>
                  {location.name} · {Math.round(location.confidence * 100)}%
                </span>
              </div>
            )}
          </div>

          {/* Right: Language + controls */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {/* Language toggle */}
            <div style={{ display: "flex", gap: "4px", background: "rgba(0,0,0,0.5)", borderRadius: "20px", padding: "4px", backdropFilter: "blur(8px)" }}>
              {(["en", "te", "hi"] as Language[]).map(lang => (
                <button key={lang} onClick={() => { setLanguage(lang); languageRef.current = lang; }} style={{
                  padding: "4px 10px", borderRadius: "16px", border: "none",
                  background: language === lang ? "var(--accent)" : "transparent",
                  color: language === lang ? "#000" : "rgba(255,255,255,0.6)",
                  fontSize: "11px", fontWeight: 700, cursor: "pointer",
                  transition: "all 0.15s",
                }}>
                  {LANG_LABELS[lang]}
                </button>
              ))}
            </div>

            {/* Flip camera */}
            <button onClick={switchCamera} style={{
              width: "36px", height: "36px", borderRadius: "50%",
              background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.15)",
              backdropFilter: "blur(8px)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: "14px",
            }} title="Flip camera">
              🔄
            </button>

            {/* IRIS log toggle */}
            <button onClick={() => setShowIrisLog(p => !p)} style={{
              width: "36px", height: "36px", borderRadius: "50%",
              background: showIrisLog ? "rgba(46,196,182,0.2)" : "rgba(0,0,0,0.5)",
              border: `1px solid ${showIrisLog ? "rgba(46,196,182,0.5)" : "rgba(255,255,255,0.15)"}`,
              backdropFilter: "blur(8px)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "13px",
            }} title="IRIS log">
              👁
            </button>
          </div>
        </div>

        {/* ── VEDA PiP — top right ── */}
        <div style={{
          position: "absolute", top: "72px", right: "20px",
          display: "flex", flexDirection: "column", alignItems: "center", gap: "6px",
        }}>
          <VedaAvatar size={72} speaking={isSpeaking} />
          <div style={{
            background: "rgba(0,0,0,0.6)", borderRadius: "12px",
            padding: "4px 10px", backdropFilter: "blur(8px)",
            textAlign: "center",
          }}>
            <p style={{ fontSize: "10px", fontWeight: 700, color: "var(--accent)", letterSpacing: "0.06em" }}>VEDA</p>
            <p style={{ fontSize: "9px", color: "rgba(255,255,255,0.5)", marginTop: "1px" }}>
              {isSpeaking ? "speaking" : isListening ? "listening" : "ready"}
            </p>
          </div>
        </div>

        {/* ── IRIS Log overlay (togglable) ── */}
        {showIrisLog && (
          <div style={{
            position: "absolute", top: "72px", left: "20px",
            width: "300px", maxHeight: "220px", overflowY: "auto",
            background: "rgba(0,0,0,0.75)", borderRadius: "12px",
            padding: "12px", backdropFilter: "blur(12px)",
            border: "1px solid rgba(46,196,182,0.2)",
          }}>
            <p style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", color: "var(--accent)", marginBottom: "8px", textTransform: "uppercase" }}>
              IRIS Vision Log
            </p>
            {irisLog.length === 0 ? (
              <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)" }}>Waiting for frames...</p>
            ) : irisLog.map((log, i) => (
              <p key={i} style={{ fontSize: "10px", color: i === 0 ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.35)", marginBottom: "4px", lineHeight: 1.5 }}>
                {log}
              </p>
            ))}
          </div>
        )}

        {/* ── Last VEDA message — floating bottom left ── */}
        {lastVedaMsg && callStatus === "live" && !showChat && (
          <div style={{
            position: "absolute", bottom: "90px", left: "20px",
            maxWidth: "360px",
            background: "rgba(0,0,0,0.7)", borderRadius: "16px",
            padding: "12px 16px", backdropFilter: "blur(12px)",
            border: "1px solid rgba(46,196,182,0.2)",
            animation: "fadeIn 0.3s ease",
          }}>
            <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.9)", lineHeight: 1.6 }}>
              {lastVedaMsg}
            </p>
          </div>
        )}

        {/* ── Chat overlay — bottom left when open ── */}
        {showChat && (
          <div style={{
            position: "absolute", bottom: "90px", left: "20px",
            width: "min(380px, calc(100vw - 120px))",
            maxHeight: "300px",
            background: "rgba(0,0,0,0.75)", borderRadius: "16px",
            backdropFilter: "blur(16px)",
            border: "1px solid rgba(255,255,255,0.08)",
            display: "flex", flexDirection: "column", overflow: "hidden",
          }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <p style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.06em", color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>
                Conversation
              </p>
              <button onClick={() => setShowChat(false)} style={{
                background: "none", border: "none", color: "rgba(255,255,255,0.3)",
                cursor: "pointer", fontSize: "14px", lineHeight: 1,
              }}>×</button>
            </div>
            <div ref={chatRef} style={{ flex: 1, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
              {messages.length === 0 && (
                <p style={{ color: "rgba(255,255,255,0.2)", fontSize: "12px", textAlign: "center", marginTop: "12px" }}>
                  Waiting for VEDA...
                </p>
              )}
              {messages.map((msg, i) => (
                <div key={i} style={{
                  display: "flex", gap: "8px",
                  flexDirection: msg.role === "user" ? "row-reverse" : "row",
                  alignItems: "flex-end",
                }}>
                  {msg.role === "veda" && (
                    <div style={{
                      width: "24px", height: "24px", borderRadius: "50%", flexShrink: 0,
                      background: "linear-gradient(135deg, #1a3a38, #0d2220)",
                      border: "1px solid var(--accent)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "9px", fontWeight: 700, color: "var(--accent)",
                    }}>V</div>
                  )}
                  <div style={{
                    maxWidth: "80%",
                    background: msg.role === "veda" ? "rgba(255,255,255,0.08)" : "var(--accent)",
                    color: msg.role === "veda" ? "rgba(255,255,255,0.9)" : "#000",
                    padding: "7px 11px", borderRadius: msg.role === "veda" ? "4px 12px 12px 12px" : "12px 4px 12px 12px",
                    fontSize: "12px", lineHeight: 1.5,
                  }}>
                    {msg.content}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom control bar ── (Google Meet style) */}
      <div style={{
        height: "80px", flexShrink: 0,
        background: "#1a1a1a", borderTop: "1px solid #222",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px",
      }}>

        {/* Left: mic status */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: "140px" }}>
          <div style={{
            width: "8px", height: "8px", borderRadius: "50%",
            background: isListening ? "var(--success)" : isSpeaking ? "var(--accent)" : "#444",
            boxShadow: isListening ? "0 0 6px var(--success)" : isSpeaking ? "0 0 6px var(--accent)" : "none",
          }} />
          <span style={{ fontSize: "12px", color: "#666" }}>
            {isListening ? "Listening..." : isSpeaking ? "VEDA speaking" : "Mic standby"}
          </span>
        </div>

        {/* Center: action buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>

          {/* Chat toggle */}
          <button onClick={() => setShowChat(p => !p)} title="Chat" style={{
            width: "48px", height: "48px", borderRadius: "50%",
            background: showChat ? "rgba(46,196,182,0.2)" : "#2a2a2a",
            border: `1px solid ${showChat ? "rgba(46,196,182,0.4)" : "#333"}`,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "18px", transition: "all 0.2s",
          }}>
            💬
          </button>

          {/* End call */}
          {callStatus === "live" && (
            <button onClick={endCall} title="End call" style={{
              width: "56px", height: "56px", borderRadius: "50%",
              background: "#e05555", border: "none",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 4px 16px rgba(224,85,85,0.4)",
              transition: "all 0.2s",
            }}>
              {/* Hang up icon */}
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white" style={{ transform: "rotate(135deg)" }}>
                <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/>
              </svg>
            </button>
          )}

          {/* New call (after ended) */}
          {callStatus === "ended" && (
            <button onClick={() => {
              setCallStatus("idle"); setMessages([]); setLocation(null);
              setSceneText(""); setSessionId(""); sessionIdRef.current = "";
              speechQueueRef.current = []; setLastVedaMsg("");
            }} style={{
              padding: "12px 28px", borderRadius: "28px",
              background: "var(--accent)", color: "#000",
              border: "none", fontSize: "14px", fontWeight: 700,
              cursor: "pointer", fontFamily: "'Inter', sans-serif",
            }}>
              New Call
            </button>
          )}

          {/* IRIS log toggle */}
          <button onClick={() => setShowIrisLog(p => !p)} title="Vision log" style={{
            width: "48px", height: "48px", borderRadius: "50%",
            background: showIrisLog ? "rgba(46,196,182,0.2)" : "#2a2a2a",
            border: `1px solid ${showIrisLog ? "rgba(46,196,182,0.4)" : "#333"}`,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "18px", transition: "all 0.2s",
          }}>
            👁
          </button>
        </div>

        {/* Right: session info */}
        <div style={{ minWidth: "140px", textAlign: "right" }}>
          {location?.matched ? (
            <div>
              <p style={{ fontSize: "11px", color: "var(--accent)", fontWeight: 600 }}>{location.name}</p>
              <p style={{ fontSize: "10px", color: "#444", marginTop: "2px" }}>{Math.round(location.confidence * 100)}% match</p>
            </div>
          ) : (
            <p style={{ fontSize: "11px", color: "#444" }}>Scanning...</p>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes wave    { from{transform:scaleY(0.5)} to{transform:scaleY(1.5)} }
        @keyframes fadeIn  { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
      `}</style>
    </div>
  );
}