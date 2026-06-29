"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, MapPin, GitBranch, ChevronRight, Loader, Trash2, RefreshCw } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Message   { role: "user" | "assistant"; content: string; }
interface NodeImage { id: string; image_path: string; ai_description: string; angle: string; }
interface NodeConn  { id: string; from_node: string; to_node: string; direction: string; instruction: string; distance_meters: number; }
interface Node {
  node_id: string; name: string; description: string;
  visual_keywords: string; signs_visible: string; facts: string; is_start: boolean;
  images: NodeImage[]; connections: NodeConn[];
}
type Tab = "upload" | "nodes" | "connections";

// ── Upload Tab ────────────────────────────────────────────
function UploadTab() {
  const [file, setFile]             = useState<File | null>(null);
  const [preview, setPreview]       = useState("");
  const [locationName, setLocationName] = useState("");
  const [messages, setMessages]     = useState<Message[]>([]);
  const [input, setInput]           = useState("");
  const [sessionId, setSessionId]   = useState("");
  const [msgHistory, setMsgHistory] = useState<any[]>([]);
  const [loading, setLoading]       = useState(false);
  const [started, setStarted]       = useState(false);
  const [imagePath, setImagePath]   = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const chatRef  = useRef<HTMLDivElement>(null);

  const handleFile = (f: File) => {
    setFile(f); setPreview(URL.createObjectURL(f));
    setStarted(false); setMessages([]); setMsgHistory([]); setSessionId("");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f?.type.startsWith("image/")) handleFile(f);
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
      setSessionId(data.session_id); setMsgHistory(data.messages || []);
      setMessages([{ role: "assistant", content: data.response }]);
      setImagePath(data.image_path || ""); setStarted(true);
    } catch {
      setMessages([{ role: "assistant", content: "Failed to connect to backend." }]);
    } finally { setLoading(false); }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim(); setInput("");
    setMessages(m => [...m, { role: "user", content: userMsg }]);
    setLoading(true);
    try {
      const res  = await fetch(`${API}/api/studio/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, message: userMsg, messages: msgHistory, image_path: imagePath }),
      });
      const data = await res.json();
      setMsgHistory(data.messages || []);
      setMessages(m => [...m, { role: "assistant", content: data.response }]);
    } catch {
      setMessages(m => [...m, { role: "assistant", content: "Error communicating with agent." }]);
    } finally {
      setLoading(false);
      setTimeout(() => chatRef.current?.scrollTo(0, chatRef.current.scrollHeight), 100);
    }
  };

  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px", height: "100%", overflow: "auto" }}>

      {/* Image upload */}
      <div>
        <p className="label">Location Image</p>
        <div
          onDrop={handleDrop} onDragOver={e => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${file ? "var(--accent)" : "var(--border)"}`,
            borderRadius: "10px", padding: "16px", textAlign: "center",
            cursor: "pointer", background: "var(--surface)", transition: "border-color 0.2s",
            minHeight: "120px", display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: "8px",
          }}
        >
          {preview
            ? <img src={preview} alt="preview" style={{ maxWidth: "100%", maxHeight: "160px", borderRadius: "6px", objectFit: "cover" }} />
            : <>
                <Upload size={22} style={{ color: "var(--text-dim)" }} />
                <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>Tap to upload image</p>
                <p style={{ fontSize: "11px", color: "var(--text-dim)" }}>PNG, JPG supported</p>
              </>
          }
        </div>
        <input ref={inputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
          onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
      </div>

      {/* Location name */}
      <div>
        <p className="label">Location Name</p>
        <input className="input" placeholder="e.g. Main Entrance Gate"
          value={locationName} onChange={e => setLocationName(e.target.value)}
          autoComplete="off" disabled={started} />
      </div>

      {/* Start button */}
      {!started && (
        <button className="btn-primary" onClick={startSession}
          disabled={!file || !locationName.trim() || loading} style={{ width: "100%" }}>
          {loading ? "Analyzing..." : "Analyze with BUILDER Agent"}
        </button>
      )}

      {started && (
        <div style={{ padding: "10px 14px", background: "var(--accent-glow)", border: "1px solid rgba(46,196,182,0.3)", borderRadius: "8px" }}>
          <p style={{ fontSize: "12px", color: "var(--accent)", fontWeight: 600 }}>BUILDER Agent Active</p>
          <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>Answer questions to build this node</p>
        </div>
      )}

      {/* Chat */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--surface)", borderRadius: "12px", border: "1px solid var(--border)", overflow: "hidden", minHeight: "300px" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: started ? "var(--success)" : "var(--text-dim)" }} />
          <p style={{ fontSize: "13px", fontWeight: 600 }}>BUILDER Agent</p>
          <span className="badge badge-accent" style={{ marginLeft: "auto", fontSize: "10px" }}>AI</span>
        </div>

        <div ref={chatRef} style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
          {messages.length === 0 && (
            <div style={{ textAlign: "center", marginTop: "32px" }}>
              <p style={{ color: "var(--text-dim)", fontSize: "13px" }}>Upload an image and name to start.</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} style={{
              maxWidth: "85%", alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
              padding: "10px 14px",
              borderRadius: msg.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
              background: msg.role === "user" ? "var(--accent)" : "var(--surface-2)",
              color: msg.role === "user" ? "#000" : "var(--text)",
              fontSize: "13px", lineHeight: 1.6,
              border: msg.role === "assistant" ? "1px solid var(--border)" : "none",
            }}>{msg.content}</div>
          ))}
          {loading && (
            <div style={{ alignSelf: "flex-start", padding: "10px 14px", borderRadius: "12px 12px 12px 4px", background: "var(--surface-2)", border: "1px solid var(--border)", display: "flex", gap: "6px", alignItems: "center" }}>
              <Loader size={12} style={{ color: "var(--accent)", animation: "spin 1s linear infinite" }} />
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Thinking...</span>
            </div>
          )}
        </div>

        <div style={{ padding: "12px", borderTop: "1px solid var(--border)", display: "flex", gap: "8px" }}>
          <input className="input" placeholder={started ? "Type your answer..." : "Start a session first"}
            value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && sendMessage()}
            disabled={!started || loading} autoComplete="off" />
          <button className="btn-primary" onClick={sendMessage}
            disabled={!started || loading || !input.trim()} style={{ padding: "10px 14px", flexShrink: 0 }}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }`}</style>
    </div>
  );
}

// ── Nodes Tab ─────────────────────────────────────────────
function NodesTab() {
  const [nodes, setNodes]     = useState<Node[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Node | null>(null);
  const [showDetail, setShowDetail] = useState(false); // mobile: show detail panel

  const fetchNodes = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${API}/api/studio/nodes`);
      const data = await res.json();
      setNodes(data.nodes || []);
    } catch { setNodes([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchNodes(); }, [fetchNodes]);

  const deleteNode = async (node_id: string) => {
    await fetch(`${API}/api/studio/nodes/${node_id}`, { method: "DELETE" });
    fetchNodes(); setSelected(null); setShowDetail(false);
  };

  const selectNode = (node: Node) => {
    setSelected(node); setShowDetail(true);
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Mobile: show list or detail */}
      {/* Desktop: show both side by side via CSS */}

      <div className="nodes-layout" style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Node list */}
        <div className={`nodes-list ${showDetail ? "nodes-list--hidden" : ""}`}
          style={{ borderRight: "1px solid var(--border)", overflow: "auto", flexShrink: 0 }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "var(--bg)", zIndex: 1 }}>
            <p style={{ fontSize: "13px", fontWeight: 600 }}>Locations ({nodes.length})</p>
            <button className="btn-secondary" style={{ padding: "5px 10px", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }} onClick={fetchNodes}>
              <RefreshCw size={11} />{loading ? "..." : "Refresh"}
            </button>
          </div>

          {nodes.length === 0 && !loading && (
            <div style={{ padding: "40px 16px", textAlign: "center" }}>
              <p style={{ color: "var(--text-dim)", fontSize: "13px" }}>No nodes yet.</p>
              <p style={{ color: "var(--text-dim)", fontSize: "12px", marginTop: "4px" }}>Use Upload tab to add locations.</p>
            </div>
          )}

          {nodes.map(node => (
            <div key={node.node_id} onClick={() => selectNode(node)} style={{
              padding: "14px 16px", borderBottom: "1px solid var(--border)",
              cursor: "pointer",
              background: selected?.node_id === node.node_id ? "var(--accent-glow)" : "transparent",
              borderLeft: selected?.node_id === node.node_id ? "2px solid var(--accent)" : "2px solid transparent",
              transition: "all 0.15s",
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p style={{ fontSize: "13px", fontWeight: 600, color: selected?.node_id === node.node_id ? "var(--accent)" : "var(--text)" }}>
                  {node.name}
                </p>
                {node.is_start && <span className="badge badge-success" style={{ fontSize: "10px" }}>Start</span>}
              </div>
              <p style={{ fontSize: "11px", color: "var(--text-dim)", marginTop: "2px" }}>{node.node_id}</p>
              <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
                {node.images?.length || 0} images · {node.connections?.length || 0} connections
              </p>
            </div>
          ))}
        </div>

        {/* Node detail */}
        <div className={`nodes-detail ${!showDetail ? "nodes-detail--hidden" : ""}`} style={{ flex: 1, overflow: "auto", padding: "20px" }}>
          {/* Mobile back button */}
          {selected && (
            <button className="nodes-back" onClick={() => setShowDetail(false)} style={{
              display: "none", marginBottom: "16px", padding: "7px 14px",
              background: "transparent", border: "1px solid var(--border)",
              borderRadius: "8px", color: "var(--text-muted)", fontSize: "13px",
              cursor: "pointer", alignItems: "center", gap: "6px",
            }}>
              ← Back to list
            </button>
          )}

          {!selected ? (
            <div style={{ textAlign: "center", marginTop: "80px" }}>
              <p style={{ color: "var(--text-dim)", fontSize: "14px" }}>Select a node to view details</p>
            </div>
          ) : (
            <div style={{ maxWidth: "680px", display: "flex", flexDirection: "column", gap: "18px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
                <div>
                  <h2 style={{ fontSize: "18px", fontWeight: 700 }}>{selected.name}</h2>
                  <p style={{ fontSize: "12px", color: "var(--text-dim)", marginTop: "2px" }}>{selected.node_id}</p>
                </div>
                <button className="btn-danger" style={{ padding: "7px 12px", fontSize: "12px", flexShrink: 0, display: "flex", alignItems: "center", gap: "4px" }}
                  onClick={() => deleteNode(selected.node_id)}>
                  <Trash2 size={13} /> Delete
                </button>
              </div>

              <div className="card">
                <p className="label">Description</p>
                <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.7 }}>{selected.description || "No description"}</p>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div className="card">
                  <p className="label">Signs Visible</p>
                  <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>{selected.signs_visible || "None"}</p>
                </div>
                <div className="card">
                  <p className="label">Visual Keywords</p>
                  <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>{selected.visual_keywords || "None"}</p>
                </div>
              </div>

              {selected.images?.length > 0 && (
                <div>
                  <p className="label" style={{ marginBottom: "10px" }}>Images ({selected.images.length})</p>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {selected.images.map(img => (
                      <div key={img.id} style={{ width: "100px", height: "80px", background: "var(--surface)", borderRadius: "8px", border: "1px solid var(--border)", overflow: "hidden" }}>
                        {img.image_path?.startsWith("http")
                          ? <img src={img.image_path} alt={img.angle} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          : <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", padding: "6px" }}>
                              <p style={{ fontSize: "10px", color: "var(--text-dim)", textAlign: "center" }}>{img.image_path || "No image"}</p>
                            </div>
                        }
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selected.connections?.length > 0 && (
                <div>
                  <p className="label" style={{ marginBottom: "10px" }}>Connections ({selected.connections.length})</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {selected.connections.map(c => (
                      <div key={c.id} style={{ padding: "10px 12px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--accent)", textTransform: "uppercase", minWidth: "44px" }}>{c.direction}</span>
                          <span style={{ fontSize: "13px", color: "var(--text)" }}>→ {c.to_node}</span>
                          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{c.distance_meters}m</span>
                        </div>
                        {c.instruction && <p style={{ fontSize: "12px", color: "var(--text-dim)", marginTop: "6px", lineHeight: 1.5 }}>{c.instruction}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .nodes-layout { }
        .nodes-list   { width: 280px; }
        .nodes-detail { }
        .nodes-back   { }

        @media (max-width: 640px) {
          .nodes-list              { width: 100% !important; }
          .nodes-detail            { position: absolute; inset: 0; background: var(--bg); z-index: 10; }
          .nodes-list--hidden      { display: none !important; }
          .nodes-detail--hidden    { display: none !important; }
          .nodes-back              { display: flex !important; }
          .nodes-layout            { position: relative; }
        }
      `}</style>
    </div>
  );
}

// ── Connections Tab ───────────────────────────────────────
function ConnectionsTab() {
  const [nodes, setNodes]         = useState<Node[]>([]);
  const [fromNode, setFromNode]   = useState("");
  const [toNode, setToNode]       = useState("");
  const [direction, setDirection] = useState("");
  const [instruction, setInstruction] = useState("");
  const [distance, setDistance]   = useState("");
  const [loading, setLoading]     = useState(false);
  const [success, setSuccess]     = useState("");

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
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_node: fromNode, to_node: toNode, direction, instruction, distance_meters: parseInt(distance) || 0 }),
      });
      setSuccess("Connection added!");
      setFromNode(""); setToNode(""); setDirection(""); setInstruction(""); setDistance("");
      setTimeout(() => setSuccess(""), 3000);
    } catch { setSuccess("Failed to add connection."); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ padding: "20px", maxWidth: "560px", overflow: "auto", height: "100%" }}>
      <p style={{ fontSize: "16px", fontWeight: 700, marginBottom: "4px" }}>Add Connection</p>
      <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "24px" }}>
        Connect two location nodes with a direction and instruction.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div>
            <p className="label">From Node</p>
            <input className="input" placeholder="e.g. main_entrance" value={fromNode}
              onChange={e => setFromNode(e.target.value)} autoComplete="off" onFocus={fetchNodes} />
          </div>
          <div>
            <p className="label">To Node</p>
            <input className="input" placeholder="e.g. library" value={toNode}
              onChange={e => setToNode(e.target.value)} autoComplete="off" />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <div>
            <p className="label">Direction</p>
            <select className="input" value={direction} onChange={e => setDirection(e.target.value)} style={{ cursor: "pointer" }}>
              <option value="">Select</option>
              {["north","south","east","west","left","right","straight","forward","ahead"].map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div>
            <p className="label">Distance (m)</p>
            <input className="input" placeholder="e.g. 200" value={distance}
              onChange={e => setDistance(e.target.value)} autoComplete="off" />
          </div>
        </div>

        <div>
          <p className="label">Navigation Instruction</p>
          <input className="input" placeholder="e.g. Walk straight, library is on the right"
            value={instruction} onChange={e => setInstruction(e.target.value)} autoComplete="off" />
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
        <div style={{ marginTop: "28px" }}>
          <p className="label" style={{ marginBottom: "10px" }}>Tap to fill From Node</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {nodes.map(n => (
              <span key={n.node_id} onClick={() => setFromNode(n.node_id)} style={{
                padding: "5px 10px", background: "var(--surface)", border: "1px solid var(--border)",
                borderRadius: "6px", fontSize: "12px", color: "var(--text-muted)", cursor: "pointer",
              }}>
                {n.node_id}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────
export default function StudioPage() {
  const [tab, setTab] = useState<Tab>("upload");

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "upload",      label: "Upload",      icon: <Upload size={15} /> },
    { id: "nodes",       label: "Nodes",       icon: <MapPin size={15} /> },
    { id: "connections", label: "Connections", icon: <GitBranch size={15} /> },
  ];

  return (
    <div style={{ display: "flex", height: "calc(100vh - 56px)", overflow: "hidden" }}>

      {/* ── Sidebar (desktop) ── */}
      <aside className="studio-sidebar" style={{
        width: "180px", flexShrink: 0,
        background: "var(--surface)", borderRight: "1px solid var(--border)",
        padding: "20px 10px", display: "flex", flexDirection: "column", gap: "4px",
      }}>
        <p className="label" style={{ paddingLeft: "8px", marginBottom: "12px" }}>Map Studio</p>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            display: "flex", alignItems: "center", gap: "8px",
            padding: "9px 12px", borderRadius: "8px", border: "none",
            background: tab === t.id ? "var(--accent-glow)" : "transparent",
            color:      tab === t.id ? "var(--accent)"     : "var(--text-muted)",
            fontWeight: tab === t.id ? 600 : 400,
            fontSize: "13px", cursor: "pointer", textAlign: "left", width: "100%",
            borderLeft: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
            transition: "all 0.15s",
          }}>
            {t.icon}{t.label}
          </button>
        ))}
      </aside>

      {/* ── Content ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Mobile tab bar */}
        <div className="studio-tabs-mobile" style={{
          display: "none", borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
        }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, padding: "12px 4px", border: "none", background: "transparent",
              color:       tab === t.id ? "var(--accent)"   : "var(--text-muted)",
              borderBottom: tab === t.id ? "2px solid var(--accent)" : "2px solid transparent",
              fontSize: "11px", fontWeight: tab === t.id ? 700 : 400,
              cursor: "pointer", display: "flex", flexDirection: "column",
              alignItems: "center", gap: "4px", transition: "all 0.15s",
            }}>
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          {tab === "upload"      && <UploadTab />}
          {tab === "nodes"       && <NodesTab />}
          {tab === "connections" && <ConnectionsTab />}
        </div>
      </div>

      <style>{`
        @media (max-width: 640px) {
          .studio-sidebar      { display: none !important; }
          .studio-tabs-mobile  { display: flex !important; }
        }
      `}</style>
    </div>
  );
}