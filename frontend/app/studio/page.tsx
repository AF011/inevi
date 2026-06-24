"use client";

import { useState, useRef, useCallback } from "react";
import { Upload, MapPin, GitBranch, Plus, Trash2, ChevronRight, Loader } from "lucide-react";

const API = "http://localhost:8000";

// ── Types ─────────────────────────────────────────────
interface Message {
  role: "user" | "assistant";
  content: string;
}

interface Node {
  node_id: string;
  name: string;
  description: string;
  visual_keywords: string;
  signs_visible: string;
  facts: string;
  is_start: boolean;
  images: { id: string; image_path: string; ai_description: string; angle: string }[];
  connections: { id: string; from_node: string; to_node: string; direction: string; instruction: string; distance_meters: number }[];
}

type Tab = "upload" | "nodes" | "connections";

// ── Sidebar ───────────────────────────────────────────
function Sidebar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "upload",      label: "Upload",      icon: <Upload size={15} /> },
    { id: "nodes",       label: "Nodes",       icon: <MapPin size={15} /> },
    { id: "connections", label: "Connections", icon: <GitBranch size={15} /> },
  ];

  return (
    <aside
      style={{
        width: "200px",
        minHeight: "calc(100vh - 56px)",
        background: "var(--surface)",
        borderRight: "1px solid var(--border)",
        padding: "24px 12px",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        flexShrink: 0,
      }}
    >
      <p className="label" style={{ paddingLeft: "8px", marginBottom: "12px" }}>
        Map Studio
      </p>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "9px 12px",
            borderRadius: "8px",
            border: "none",
            background: active === t.id ? "var(--accent-glow)" : "transparent",
            color: active === t.id ? "var(--accent)" : "var(--text-muted)",
            fontWeight: active === t.id ? 600 : 400,
            fontSize: "13px",
            cursor: "pointer",
            textAlign: "left",
            width: "100%",
            transition: "all 0.15s",
            borderLeft: active === t.id ? "2px solid var(--accent)" : "2px solid transparent",
          }}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </aside>
  );
}

// ── Upload Tab ────────────────────────────────────────
function UploadTab() {
  const [file, setFile]               = useState<File | null>(null);
  const [preview, setPreview]         = useState<string>("");
  const [locationName, setLocationName] = useState("");
  const [messages, setMessages]       = useState<Message[]>([]);
  const [input, setInput]             = useState("");
  const [sessionId, setSessionId]     = useState("");
  const [msgHistory, setMsgHistory]   = useState<any[]>([]);
  const [loading, setLoading]         = useState(false);
  const [started, setStarted]         = useState(false);
  const [imagePath, setImagePath]     = useState("");
  const inputRef                      = useRef<HTMLInputElement>(null);
  const chatRef                       = useRef<HTMLDivElement>(null);

  const handleFile = (f: File) => {
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setStarted(false);
    setMessages([]);
    setMsgHistory([]);
    setSessionId("");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/")) handleFile(f);
  };

  const startSession = async () => {
    if (!file || !locationName.trim()) return;
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("location_name", locationName);

      const res  = await fetch(`${API}/api/studio/analyze`, { method: "POST", body: fd });
      const data = await res.json();

      setSessionId(data.session_id);
      setMsgHistory(data.messages || []);
      setMessages([{ role: "assistant", content: data.response }]);
      setImagePath(data.image_path || "");
      setStarted(true);      
    } catch (e) {
      setMessages([{ role: "assistant", content: "Failed to connect to backend. Make sure FastAPI is running." }]);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages((m) => [...m, { role: "user", content: userMsg }]);
    setLoading(true);

    try {
      const res  = await fetch(`${API}/api/studio/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id:  sessionId,
          message:     userMsg,
          messages:    msgHistory,
          image_path:  imagePath,
        }),
      });
      const data = await res.json();
      setMsgHistory(data.messages || []);
      setMessages((m) => [...m, { role: "assistant", content: data.response }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Error communicating with agent." }]);
    } finally {
      setLoading(false);
      setTimeout(() => chatRef.current?.scrollTo(0, chatRef.current.scrollHeight), 100);
    }
  };

  return (
    <div style={{ display: "flex", gap: "24px", height: "calc(100vh - 56px)", padding: "24px", overflow: "hidden" }}>

      {/* Left — Image upload */}
      <div style={{ width: "340px", flexShrink: 0, display: "flex", flexDirection: "column", gap: "16px" }}>
        <div>
          <p className="label">Location Image</p>

          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            style={{
              border: `2px dashed ${file ? "var(--accent)" : "var(--border)"}`,
              borderRadius: "10px",
              padding: "24px",
              textAlign: "center",
              cursor: "pointer",
              background: "var(--surface)",
              transition: "border-color 0.2s",
              minHeight: "160px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
            }}
          >
            {preview ? (
              <img src={preview} alt="preview" style={{ width: "100%", borderRadius: "6px", objectFit: "cover", maxHeight: "200px" }} />
            ) : (
              <>
                <Upload size={24} style={{ color: "var(--text-dim)" }} />
                <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>Drop image here or click to upload</p>
                <p style={{ fontSize: "11px", color: "var(--text-dim)" }}>PNG, JPG supported</p>
              </>
            )}
          </div>
          <input ref={inputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </div>

        {/* Location name */}
        <div>
          <p className="label">Location Name</p>
          <input
            className="input"
            placeholder="e.g. Main Entrance Gate"
            value={locationName}
            onChange={(e) => setLocationName(e.target.value)}
            autoComplete="off"
            disabled={started}
          />
        </div>

        {/* Start button */}
        {!started && (
          <button
            className="btn-primary"
            onClick={startSession}
            disabled={!file || !locationName.trim() || loading}
            style={{ width: "100%" }}
          >
            {loading ? "Analyzing..." : "Analyze with BUILDER Agent"}
          </button>
        )}

        {started && (
          <div style={{ padding: "10px 14px", background: "var(--accent-glow)", border: "1px solid rgba(46,196,182,0.3)", borderRadius: "8px" }}>
            <p style={{ fontSize: "12px", color: "var(--accent)", fontWeight: 600 }}>BUILDER Agent Active</p>
            <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>Answer the questions to build this node</p>
          </div>
        )}
      </div>

      {/* Right — Chat */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--surface)", borderRadius: "12px", border: "1px solid var(--border)", overflow: "hidden" }}>

        {/* Chat header */}
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: started ? "var(--success)" : "var(--text-dim)" }} />
          <p style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)" }}>BUILDER Agent</p>
          <span className="badge badge-accent" style={{ marginLeft: "auto", fontSize: "10px" }}>Powered by LangGraph</span>
        </div>

        {/* Messages */}
        <div ref={chatRef} style={{ flex: 1, overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          {messages.length === 0 && (
            <div style={{ textAlign: "center", marginTop: "40px" }}>
              <p style={{ color: "var(--text-dim)", fontSize: "13px" }}>Upload an image and provide a location name to start.</p>
              <p style={{ color: "var(--text-dim)", fontSize: "12px", marginTop: "6px" }}>BUILDER agent will analyze your image and ask smart questions.</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                maxWidth: "80%",
                alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                padding: "12px 16px",
                borderRadius: msg.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                background: msg.role === "user" ? "var(--accent)" : "var(--surface-2)",
                color: msg.role === "user" ? "#000" : "var(--text)",
                fontSize: "13px",
                lineHeight: 1.6,
                border: msg.role === "assistant" ? "1px solid var(--border)" : "none",
              }}
            >
              {msg.content}
            </div>
          ))}
          {loading && (
            <div style={{ alignSelf: "flex-start", padding: "12px 16px", borderRadius: "12px 12px 12px 4px", background: "var(--surface-2)", border: "1px solid var(--border)", display: "flex", gap: "6px", alignItems: "center" }}>
              <Loader size={12} style={{ color: "var(--accent)", animation: "spin 1s linear infinite" }} />
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>BUILDER is thinking...</span>
            </div>
          )}
        </div>

        {/* Input */}
        <div style={{ padding: "14px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: "10px" }}>
          <input
            className="input"
            placeholder={started ? "Type your answer..." : "Start a session first"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            disabled={!started || loading}
            autoComplete="off"
          />
          <button
            className="btn-primary"
            onClick={sendMessage}
            disabled={!started || loading || !input.trim()}
            style={{ padding: "10px 16px", flexShrink: 0 }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Nodes Tab ─────────────────────────────────────────
function NodesTab() {
  const [nodes, setNodes]   = useState<Node[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Node | null>(null);

  const fetchNodes = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${API}/api/studio/nodes`);
      const data = await res.json();
      setNodes(data.nodes || []);
    } catch {
      setNodes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteNode = async (node_id: string) => {
    await fetch(`${API}/api/studio/nodes/${node_id}`, { method: "DELETE" });
    fetchNodes();
    if (selected?.node_id === node_id) setSelected(null);
  };

  return (
    <div style={{ display: "flex", gap: "0", height: "calc(100vh - 56px)", overflow: "hidden" }}>

      {/* Node list */}
      <div style={{ width: "300px", borderRight: "1px solid var(--border)", overflow: "auto", flexShrink: 0 }}>
        <div style={{ padding: "16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <p style={{ fontSize: "13px", fontWeight: 600 }}>Locations</p>
          <button className="btn-secondary" style={{ padding: "5px 12px", fontSize: "12px" }} onClick={fetchNodes}>
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {nodes.length === 0 && !loading && (
          <div style={{ padding: "32px 16px", textAlign: "center" }}>
            <p style={{ color: "var(--text-dim)", fontSize: "13px" }}>No nodes yet.</p>
            <p style={{ color: "var(--text-dim)", fontSize: "12px", marginTop: "4px" }}>Use the Upload tab to add locations.</p>
          </div>
        )}

        {nodes.map((node) => (
          <div
            key={node.node_id}
            onClick={() => setSelected(node)}
            style={{
              padding: "14px 16px",
              borderBottom: "1px solid var(--border)",
              cursor: "pointer",
              background: selected?.node_id === node.node_id ? "var(--accent-glow)" : "transparent",
              borderLeft: selected?.node_id === node.node_id ? "2px solid var(--accent)" : "2px solid transparent",
              transition: "all 0.15s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <p style={{ fontSize: "13px", fontWeight: 600, color: selected?.node_id === node.node_id ? "var(--accent)" : "var(--text)" }}>
                {node.name}
              </p>
              {node.is_start && <span className="badge badge-success" style={{ fontSize: "10px" }}>Start</span>}
            </div>
            <p style={{ fontSize: "11px", color: "var(--text-dim)", marginTop: "3px" }}>{node.node_id}</p>
            <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
              {node.images?.length || 0} images · {node.connections?.length || 0} connections
            </p>
          </div>
        ))}
      </div>

      {/* Node details */}
      <div style={{ flex: 1, overflow: "auto", padding: "24px" }}>
        {!selected ? (
          <div style={{ textAlign: "center", marginTop: "80px" }}>
            <p style={{ color: "var(--text-dim)", fontSize: "14px" }}>Select a node to view details</p>
          </div>
        ) : (
          <div style={{ maxWidth: "680px", display: "flex", flexDirection: "column", gap: "20px" }}>

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <h2 style={{ fontSize: "20px", fontWeight: 700 }}>{selected.name}</h2>
                <p style={{ fontSize: "12px", color: "var(--text-dim)", marginTop: "2px" }}>{selected.node_id}</p>
              </div>
              <button className="btn-danger" style={{ padding: "7px 14px", fontSize: "12px" }} onClick={() => deleteNode(selected.node_id)}>
                <Trash2 size={13} />
              </button>
            </div>

            {/* Description */}
            <div className="card">
              <p className="label">Description</p>
              <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.7 }}>{selected.description || "No description"}</p>
            </div>

            {/* Signs + Keywords */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div className="card">
                <p className="label">Signs Visible</p>
                <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>{selected.signs_visible || "None"}</p>
              </div>
              <div className="card">
                <p className="label">Visual Keywords</p>
                <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>{selected.visual_keywords || "None"}</p>
              </div>
            </div>

            {/* Images */}
            {selected.images?.length > 0 && (
              <div>
                <p className="label" style={{ marginBottom: "10px" }}>Images ({selected.images.length})</p>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  {selected.images.map((img) => (
                    <div key={img.id} style={{ width: "140px", height: "100px", background: "var(--surface)", borderRadius: "8px", border: "1px solid var(--border)", overflow: "hidden" }}>
                      {img.image_path && img.image_path.startsWith("http") ? (
                        <img src={img.image_path} alt={img.angle} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: "8px" }}>
                          <p style={{ fontSize: "10px", color: "var(--text-dim)", textAlign: "center" }}>{img.image_path || "No image"}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Connections */}
            {selected.connections?.length > 0 && (
              <div>
                <p className="label" style={{ marginBottom: "10px" }}>Connections ({selected.connections.length})</p>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {selected.connections.map((c) => (
                    <div key={c.id} style={{ padding: "10px 14px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", display: "flex", alignItems: "center", gap: "12px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", minWidth: "50px" }}>{c.direction}</span>
                      <span style={{ fontSize: "13px", color: "var(--text)" }}>{c.to_node}</span>
                      <span style={{ fontSize: "12px", color: "var(--text-muted)", marginLeft: "auto" }}>{c.instruction}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Connections Tab ───────────────────────────────────
function ConnectionsTab() {
  const [nodes, setNodes]     = useState<Node[]>([]);
  const [fromNode, setFromNode] = useState("");
  const [toNode, setToNode]   = useState("");
  const [direction, setDirection] = useState("");
  const [instruction, setInstruction] = useState("");
  const [distance, setDistance] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");

  const fetchNodes = async () => {
    const res  = await fetch(`${API}/api/studio/nodes`);
    const data = await res.json();
    setNodes(data.nodes || []);
  };

  const addConnection = async () => {
    if (!fromNode || !toNode || !direction) return;
    setLoading(true);
    try {
      await fetch(`${API}/api/studio/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_node:       fromNode,
          to_node:         toNode,
          direction:       direction,
          instruction:     instruction,
          distance_meters: parseInt(distance) || 0,
        }),
      });
      setSuccess("Connection added successfully!");
      setFromNode(""); setToNode(""); setDirection(""); setInstruction(""); setDistance("");
      setTimeout(() => setSuccess(""), 3000);
    } catch {
      setSuccess("Failed to add connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "32px", maxWidth: "560px" }}>
      <p style={{ fontSize: "16px", fontWeight: 700, marginBottom: "4px" }}>Add Connection</p>
      <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "28px" }}>
        Manually connect two location nodes with a direction and instruction.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div>
            <p className="label">From Node</p>
            <input className="input" placeholder="e.g. main_entrance" value={fromNode} onChange={(e) => setFromNode(e.target.value)} autoComplete="off" onFocus={fetchNodes} />
          </div>
          <div>
            <p className="label">To Node</p>
            <input className="input" placeholder="e.g. library" value={toNode} onChange={(e) => setToNode(e.target.value)} autoComplete="off" />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <div>
            <p className="label">Direction</p>
            <select
              className="input"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              style={{ cursor: "pointer" }}
            >
              <option value="">Select direction</option>
              {["north", "south", "east", "west", "left", "right", "straight", "ahead"].map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div>
            <p className="label">Distance (meters)</p>
            <input className="input" placeholder="e.g. 200" value={distance} onChange={(e) => setDistance(e.target.value)} autoComplete="off" />
          </div>
        </div>

        <div>
          <p className="label">Navigation Instruction</p>
          <input className="input" placeholder="e.g. Walk straight past the fountain, library is on the right" value={instruction} onChange={(e) => setInstruction(e.target.value)} autoComplete="off" />
        </div>

        {success && (
          <div style={{ padding: "10px 14px", background: "rgba(76,175,125,0.1)", border: "1px solid rgba(76,175,125,0.3)", borderRadius: "8px" }}>
            <p style={{ fontSize: "13px", color: "var(--success)" }}>{success}</p>
          </div>
        )}

        <button className="btn-primary" onClick={addConnection} disabled={!fromNode || !toNode || !direction || loading}>
          {loading ? "Adding..." : "Add Connection"}
        </button>
      </div>

      {nodes.length > 0 && (
        <div style={{ marginTop: "32px" }}>
          <p className="label" style={{ marginBottom: "12px" }}>Existing Nodes</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            {nodes.map((n) => (
              <span key={n.node_id} style={{ padding: "4px 10px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "12px", color: "var(--text-muted)", cursor: "pointer" }}
                onClick={() => setFromNode(n.node_id)}>
                {n.node_id}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────
export default function StudioPage() {
  const [tab, setTab] = useState<Tab>("upload");

  return (
    <div style={{ display: "flex", height: "calc(100vh - 56px)" }}>
      <Sidebar active={tab} onChange={setTab} />
      <div style={{ flex: 1, overflow: "hidden" }}>
        {tab === "upload"      && <UploadTab />}
        {tab === "nodes"       && <NodesTab />}
        {tab === "connections" && <ConnectionsTab />}
      </div>
    </div>
  );
}