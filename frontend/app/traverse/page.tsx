"use client";

import { useEffect, useRef, useState, useCallback } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────
interface Message {
  role:    "veda" | "user";
  content: string;
  time:    string;
}

interface LocationInfo {
  matched:    boolean;
  node_id:    string | null;
  name:       string | null;
  confidence: number;
}

type CallStatus = "idle" | "connecting" | "live" | "ended";
type Language   = "en" | "te" | "hi";

const LANG_LABELS: Record<Language, string> = {
  en: "English",
  te: "తెలుగు",
  hi: "हिंदी",
};


const FRAME_INTERVAL_MS = 4000; // send frame every 4 seconds

// ── Traverse Page ─────────────────────────────────────────
export default function TraversePage() {
  const videoRef        = useRef<HTMLVideoElement>(null);
  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const chatRef         = useRef<HTMLDivElement>(null);
  const streamRef       = useRef<MediaStream | null>(null);
  const frameTimerRef   = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef  = useRef<any>(null);
  const synthRef        = useRef<SpeechSynthesis | null>(null);

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

  // ── Speech synthesis ──────────────────────────────────
  const speak = useCallback((text: string) => {
    if (!text || typeof window === "undefined") return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const utt   = new SpeechSynthesisUtterance(text);
    const langCode = { en: "en-IN", te: "te-IN", hi: "hi-IN" }[language];
    utt.lang    = langCode;
    utt.rate    = 0.92;
    utt.pitch   = 1.05;
    const voices = synth.getVoices();
    const match  = voices.find(v => v.lang.startsWith(language === "te" ? "te" : language === "hi" ? "hi" : "en"));
    if (match) utt.voice = match;
    utt.onstart = () => {
      setIsSpeaking(true);
      // Pause recognition while VEDA speaks
      try { recognitionRef.current?.stop(); } catch {}
    };
    utt.onend   = () => {
      setIsSpeaking(false);
      // Resume recognition after VEDA finishes - longer delay to avoid echo
      setTimeout(() => {
        try { recognitionRef.current?.start(); } catch {}
      }, 1500);
    };
    synth.speak(utt);
  }, [language]);

  const addMessage = useCallback((role: "veda" | "user", content: string) => {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setMessages(prev => [...prev, { role, content, time }]);
    setTimeout(() => chatRef.current?.scrollTo(0, chatRef.current.scrollHeight), 100);
    if (role === "veda") speak(content);
  }, [speak]);

  // ── Camera ────────────────────────────────────────────
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode }, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      return true;
    } catch {
      return false;
    }
  };

  const captureFrame = (): string | null => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;
    canvas.width  = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, 320, 240);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
    return dataUrl.split(",")[1];
  };

  // ── Continuous Speech Recognition ─────────────────────
  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    const rec = new SR();
    rec.lang         = { en: "en-IN", te: "te-IN", hi: "hi-IN" }[language];
    rec.continuous   = true;
    rec.interimResults = false;

    rec.onstart  = () => setIsListening(true);
    rec.onend    = () => {
      setIsListening(false);
      // Always restart unless call ended or VEDA is speaking
      setTimeout(() => {
        if (!isSpeaking) {
          try { rec.start(); } catch {}
        }
      }, 800);
    };

    rec.onresult = async (e: any) => {
      // Ignore if VEDA is speaking (prevents echo)
      if (isSpeaking) return;
      const result = e.results[e.results.length - 1];
      // Only process final results
      if (!result.isFinal) return;
      const transcript = result[0].transcript.trim();
      if (!transcript || transcript.length < 3) return;
      addMessage("user", transcript);
      // Send to backend only if session exists
      if (sessionId) await sendSpeech(transcript);
    };

    rec.onerror = () => setIsListening(false);
    rec.start();
    recognitionRef.current = rec;
  }, [language, callStatus]);

  // ── API Calls ─────────────────────────────────────────
  const startSession = async (lang: Language) => {
    const res  = await fetch(`${API}/api/traverse/start`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ session_id: null, language: lang }),
    });
    const data = await res.json();
    return data;
  };

  const sendFrame = async (image_b64: string, sid: string) => {
    try {
      const res  = await fetch(`${API}/api/traverse/frame`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ session_id: sid, image_b64, image_mime: "image/jpeg" }),
      });
      const data = await res.json();

      if (data.location) setLocation(data.location);
      if (data.scene) {
        setSceneText(data.scene);
        const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const confidence = data.location?.confidence ? ` ${Math.round(data.location.confidence * 100)}%` : "";
        const locLabel = data.location?.matched ? ` [${data.location.name}${confidence}]` : " [no match]";
        setIrisLog(prev => [`${time}${locLabel}: ${data.scene}`, ...prev].slice(0, 8));
      }
      if (data.has_response && data.veda_response) {
        addMessage("veda", data.veda_response);
      }
    } catch { /* silent fail */ }
  };

  const sendSpeech = async (transcript: string) => {
    try {
      const res  = await fetch(`${API}/api/traverse/speech`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ session_id: sessionId, user_speech: transcript, language }),
      });
      const data = await res.json();
      if (data.veda_response) addMessage("veda", data.veda_response);
    } catch { /* silent fail */ }
  };

  // ── Start Call ────────────────────────────────────────
  const startCall = async () => {
    setCallStatus("connecting");

    const camOk = await startCamera();
    if (!camOk) {
      setCallStatus("idle");
      return;
    }

    const data = await startSession(language);
    setSessionId(data.session_id);
    setCallStatus("live");

    if (data.veda_response) addMessage("veda", data.veda_response);

    // Start frame loop
    const sid = data.session_id;
    frameTimerRef.current = setInterval(async () => {
      const frame = captureFrame();
      if (frame) await sendFrame(frame, sid);
    }, FRAME_INTERVAL_MS);

    // Start listening after session is confirmed
    setTimeout(() => startListening(), 2000);
  };

  // ── End Call ──────────────────────────────────────────
  const endCall = () => {
    if (frameTimerRef.current)  clearInterval(frameTimerRef.current);
    if (recognitionRef.current) recognitionRef.current.stop();
    if (streamRef.current)      streamRef.current.getTracks().forEach(t => t.stop());
    window.speechSynthesis?.cancel();
    setCallStatus("ended");
    setIsListening(false);
    setIsSpeaking(false);
  };

  useEffect(() => {
    window.speechSynthesis?.getVoices();
    return () => { endCall(); };
  }, []);

  // ── Render ────────────────────────────────────────────
  return (
    <div style={{ display: "flex", height: "calc(100vh - 56px)", background: "var(--bg)" }}>

      {/* Left sidebar */}
      <aside style={{
        width: "200px", flexShrink: 0,
        background: "var(--surface)", borderRight: "1px solid var(--border)",
        padding: "24px 12px", display: "flex", flexDirection: "column", gap: "4px",
      }}>
        <p className="label" style={{ paddingLeft: "8px", marginBottom: "12px" }}>Traverse</p>

        {/* Language selector */}
        <p className="label" style={{ paddingLeft: "8px", marginTop: "16px" }}>Language</p>
        {(["en", "te", "hi"] as Language[]).map(lang => (
          <button key={lang} onClick={() => setLanguage(lang)} style={{
            display: "flex", alignItems: "center", gap: "10px",
            padding: "9px 12px", borderRadius: "8px", border: "none",
            background: language === lang ? "var(--accent-glow)" : "transparent",
            color: language === lang ? "var(--accent)" : "var(--text-muted)",
            fontWeight: language === lang ? 600 : 400,
            fontSize: "13px", cursor: "pointer", textAlign: "left", width: "100%",
            borderLeft: language === lang ? "2px solid var(--accent)" : "2px solid transparent",
            transition: "all 0.15s",
          }}>
            {LANG_LABELS[lang]}
          </button>
        ))}

        {/* Location info */}
        {location?.matched && (
          <div style={{ marginTop: "auto", padding: "12px", background: "var(--bg)", borderRadius: "8px", border: "1px solid var(--border)" }}>
            <p className="label" style={{ marginBottom: "6px" }}>Current Location</p>
            <p style={{ fontSize: "12px", fontWeight: 600, color: "var(--accent)" }}>{location.name}</p>
            <p style={{ fontSize: "10px", color: "var(--text-dim)", marginTop: "2px" }}>
              {Math.round(location.confidence * 100)}% confident
            </p>
          </div>
        )}
      </aside>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>

        {/* Idle screen */}
        {callStatus === "idle" && (
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: "24px",
          }}>
            <div style={{ textAlign: "center" }}>
              <p style={{ fontSize: "32px", fontFamily: "'Bebas Neue'", letterSpacing: "0.1em", color: "var(--accent)" }}>VEDA</p>
              <p style={{ fontSize: "14px", color: "var(--text-muted)", marginTop: "8px" }}>Your AI Spatial Guide</p>
            </div>
            <p style={{ fontSize: "13px", color: "var(--text-dim)", textAlign: "center", maxWidth: "300px" }}>
              VEDA will see through your camera, identify where you are, and guide you to your destination in real time.
            </p>
            <button className="btn-primary" onClick={startCall} style={{ padding: "14px 48px", fontSize: "15px" }}>
              Start Navigation
            </button>
          </div>
        )}

        {/* Connecting */}
        {callStatus === "connecting" && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center" }}>
              <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>Connecting to VEDA...</p>
            </div>
          </div>
        )}

        {/* Live call */}
        {(callStatus === "live" || callStatus === "ended") && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative" }}>

            {/* Camera feed */}
            <div style={{ position: "relative", height: "calc(100vh - 56px - 180px - 100px - 58px)", overflow: "hidden", background: "#000", flexShrink: 0 }}>
              <video ref={videoRef} autoPlay muted playsInline
                style={{ width: "100%", height: "100%", objectFit: "cover" }} />

              {/* Hidden canvas */}
              <canvas ref={canvasRef} style={{ display: "none" }} />

              {/* Live indicator */}
              <div style={{
                position: "absolute", top: "16px", left: "16px",
                display: "flex", alignItems: "center", gap: "8px",
                background: "rgba(0,0,0,0.6)", borderRadius: "20px",
                padding: "6px 14px", backdropFilter: "blur(10px)",
              }}>
                <div style={{
                  width: "8px", height: "8px", borderRadius: "50%",
                  background: callStatus === "live" ? "#ff4444" : "var(--text-dim)",
                  boxShadow: callStatus === "live" ? "0 0 8px #ff4444" : "none",
                  animation: callStatus === "live" ? "pulse 2s infinite" : "none",
                }} />
                <span style={{ fontSize: "12px", fontWeight: 600, color: "white" }}>
                  {callStatus === "live" ? "LIVE" : "ENDED"}
                </span>
              </div>

              {/* VEDA label */}
              <div style={{
                position: "absolute", top: "16px", right: "16px",
                background: "rgba(0,0,0,0.6)", borderRadius: "20px",
                padding: "6px 14px", backdropFilter: "blur(10px)",
                display: "flex", alignItems: "center", gap: "8px",
              }}>
                {isSpeaking && (
                  <div style={{ display: "flex", gap: "2px", alignItems: "center" }}>
                    {[1,2,3].map(i => (
                      <div key={i} style={{
                        width: "3px", borderRadius: "2px",
                        background: "var(--accent)",
                        height: `${8 + i * 4}px`,
                        animation: `wave ${0.6 + i * 0.1}s ease-in-out infinite alternate`,
                      }} />
                    ))}
                  </div>
                )}
                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--accent)" }}>VEDA</span>
              </div>

              {/* Scene text + Location */}
              <div style={{
                position: "absolute", bottom: "0", left: "0", right: "0",
                background: "linear-gradient(transparent, rgba(0,0,0,0.85))",
                padding: "24px 16px 12px",
              }}>
                {location?.matched && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--accent)" }} />
                    <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--accent)" }}>
                      {location.name} ({Math.round((location.confidence || 0) * 100)}% match)
                    </span>
                  </div>
                )}
                {sceneText && (
                  <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.65)", lineHeight: 1.5 }}>
                    {sceneText}
                  </p>
                )}
                {!sceneText && !location?.matched && (
                  <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)" }}>
                    Scanning environment...
                  </p>
                )}
              </div>
            </div>

            {/* Chat log */}
            <div ref={chatRef} style={{
              height: "180px", overflowY: "auto",
              background: "var(--surface)", borderTop: "1px solid var(--border)",
              padding: "12px 16px", display: "flex", flexDirection: "column", gap: "10px",
            }}>
              {messages.length === 0 && (
                <p style={{ color: "var(--text-dim)", fontSize: "12px", textAlign: "center", marginTop: "16px" }}>
                  Waiting for VEDA...
                </p>
              )}
              {messages.map((msg, i) => (
                <div key={i} style={{
                  display: "flex", gap: "8px",
                  flexDirection: msg.role === "user" ? "row-reverse" : "row",
                  alignItems: "flex-start",
                }}>
                  <div style={{
                    width: "28px", height: "28px", borderRadius: "50%", flexShrink: 0,
                    background: msg.role === "veda" ? "var(--accent)" : "var(--surface-2)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "10px", fontWeight: 700,
                    color: msg.role === "veda" ? "#000" : "var(--text-muted)",
                  }}>
                    {msg.role === "veda" ? "V" : "Y"}
                  </div>
                  <div style={{
                    maxWidth: "75%",
                    background: msg.role === "veda" ? "var(--surface-2)" : "var(--accent)",
                    color: msg.role === "veda" ? "var(--text)" : "#000",
                    padding: "8px 12px", borderRadius: "10px",
                    fontSize: "13px", lineHeight: 1.5,
                  }}>
                    {msg.content}
                  </div>
                  <span style={{ fontSize: "10px", color: "var(--text-dim)", alignSelf: "flex-end", flexShrink: 0 }}>
                    {msg.time}
                  </span>
                </div>
              ))}
            </div>

            {/* IRIS Frame Log */}
            <div style={{
              height: "100px", overflowY: "auto",
              background: "#0a0a0a", borderTop: "1px solid var(--border)",
              padding: "8px 12px",
            }}>
              <p style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em", color: "var(--accent)", marginBottom: "6px", textTransform: "uppercase" }}>
                IRIS Vision Log
              </p>
              {irisLog.length === 0 && (
                <p style={{ fontSize: "10px", color: "var(--text-dim)" }}>Waiting for frames...</p>
              )}
              {irisLog.map((log, i) => (
                <p key={i} style={{ fontSize: "10px", color: i === 0 ? "var(--text)" : "var(--text-dim)", marginBottom: "3px", lineHeight: 1.4 }}>
                  {log}
                </p>
              ))}
            </div>

            {/* Bottom bar */}
            <div style={{
              padding: "12px 16px",
              background: "var(--surface)", borderTop: "1px solid var(--border)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              {/* Mic status + Camera toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <div style={{
                    width: "8px", height: "8px", borderRadius: "50%",
                    background: isListening ? "var(--success)" : "var(--text-dim)",
                  }} />
                  <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                    {isListening ? "Listening..." : "Mic off"}
                  </span>
                </div>
                <button onClick={async () => {
                  const newMode = facingMode === "environment" ? "user" : "environment";
                  setFacingMode(newMode);
                  // Restart camera with new facing mode
                  if (streamRef.current) {
                    streamRef.current.getTracks().forEach(t => t.stop());
                  }
                  try {
                    const stream = await navigator.mediaDevices.getUserMedia({
                      video: { facingMode: { ideal: newMode }, width: { ideal: 640 }, height: { ideal: 480 } },
                      audio: false,
                    });
                    streamRef.current = stream;
                    if (videoRef.current) {
                      videoRef.current.srcObject = stream;
                      await videoRef.current.play();
                    }
                  } catch(e) { console.error("Camera switch failed:", e); }
                }} style={{
                  background: "var(--surface-2)", border: "1px solid var(--border)",
                  borderRadius: "6px", padding: "4px 10px",
                  fontSize: "11px", color: "var(--text-muted)", cursor: "pointer",
                }}>
                  {facingMode === "environment" ? "Back Cam" : "Front Cam"}
                </button>
              </div>

              {/* End call button */}
              {callStatus === "live" && (
                <button onClick={endCall} style={{
                  background: "#e05555", border: "none", borderRadius: "50%",
                  width: "48px", height: "48px", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "18px", transition: "opacity 0.2s",
                }}>
                  📵
                </button>
              )}

              {callStatus === "ended" && (
                <button className="btn-primary" onClick={() => {
                  setCallStatus("idle");
                  setMessages([]);
                  setLocation(null);
                  setSceneText("");
                  setSessionId("");
                }} style={{ padding: "8px 20px", fontSize: "13px" }}>
                  New Call
                </button>
              )}

              {/* VEDA speaking indicator */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  {isSpeaking ? "VEDA speaking..." : "VEDA ready"}
                </span>
                <div style={{
                  width: "8px", height: "8px", borderRadius: "50%",
                  background: isSpeaking ? "var(--accent)" : "var(--text-dim)",
                }} />
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes wave  { from{transform:scaleY(0.5)} to{transform:scaleY(1.5)} }
      `}</style>
    </div>
  );
}