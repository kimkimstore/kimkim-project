import { useEffect, useMemo, useRef, useState } from "react";

type Message = {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  preview?: string;
  otp?: string | null;
  unread?: boolean;
  receivedAt?: string;
  source?: string;
};

type InboxResponse = {
  success: boolean;
  inboxId: string;
  email: string;
  total: number;
  messages: Message[];
};

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3000";

export default function App() {
  const [email, setEmail] = useState("");
  const [inboxId, setInboxId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedMessageId, setSelectedMessageId] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [soundEnabled, setSoundEnabled] = useState(true);

  const hasInteractedRef = useRef(false);
  const lastSeenMessageIdRef = useRef("");

  const selectedMessage =
    messages.find((message) => message.id === selectedMessageId) ||
    messages[0] ||
    null;

  const shareLink = useMemo(() => {
    if (!inboxId || typeof window === "undefined") return "";
    return `${window.location.origin}/#${inboxId}`;
  }, [inboxId]);

  async function safeJson<T>(res: Response): Promise<T> {
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Response bukan JSON. Status ${res.status}: ${text.slice(0, 150)}`);
    }
  }

  async function createInbox(id: string) {
    const res = await fetch(`${API_BASE}/api/inboxes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inboxId: id }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gagal create inbox: ${res.status} ${text}`);
    }

    return safeJson<{
      success: boolean;
      inboxId: string;
      email: string;
      total: number;
    }>(res);
  }

  async function fetchInbox(id: string) {
    const res = await fetch(`${API_BASE}/api/inboxes/${encodeURIComponent(id)}`);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gagal load inbox: ${res.status} ${text}`);
    }

    return safeJson<InboxResponse>(res);
  }

  async function clearInbox(id: string) {
    const res = await fetch(`${API_BASE}/api/inboxes/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gagal clear inbox: ${res.status} ${text}`);
    }

    return safeJson<{ success: boolean; total: number }>(res);
  }

  async function deleteMessage(messageId: string) {
    const res = await fetch(
      `${API_BASE}/api/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`,
      {
        method: "DELETE",
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gagal delete message: ${res.status} ${text}`);
    }

    return safeJson<{ success: boolean; total: number }>(res);
  }

  function playNotification() {
    if (!soundEnabled) return;
    if (!hasInteractedRef.current) return;

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.value = 0.03;

      oscillator.connect(gain);
      gain.connect(ctx.destination);

      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.14);
    } catch (error) {
      console.error("Gagal main bunyi notifikasi:", error);
    }
  }

  function markInteraction() {
    hasInteractedRef.current = true;
  }

  function applyInboxData(data: InboxResponse, isAutoRefresh = false) {
    const nextMessages = data.messages || [];

    setEmail(data.email || `${data.inboxId}@kimkim.store`);
    setMessages(nextMessages);

    const latestMessage = nextMessages[0];
    const latestOtpMessage = nextMessages.find((message) => message.otp);

    if (latestMessage && latestMessage.id !== lastSeenMessageIdRef.current) {
      if (isAutoRefresh && lastSeenMessageIdRef.current) {
        playNotification();
      }
      lastSeenMessageIdRef.current = latestMessage.id;
    }

    if (latestOtpMessage) {
      setSelectedMessageId(latestOtpMessage.id);
    } else if (nextMessages.length > 0) {
      const stillExists = nextMessages.some((message) => message.id === selectedMessageId);
      if (!stillExists) {
        setSelectedMessageId(nextMessages[0].id);
      }
    } else {
      setSelectedMessageId("");
    }
  }

  async function loadInbox(id: string, isAutoRefresh = false) {
    try {
      if (!isAutoRefresh) setLoading(true);

      const data = await fetchInbox(id);
      applyInboxData(data, isAutoRefresh);

      if (!isAutoRefresh) {
        setStatus(`Inbox loaded: ${data.total} message(s)`);
      }
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "Gagal load inbox");
    } finally {
      if (!isAutoRefresh) setLoading(false);
    }
  }

  async function handleGenerateEmail() {
    try {
      markInteraction();
      setLoading(true);
      setStatus("Generating premium inbox...");

      const id = `kim${Math.floor(Math.random() * 100000)}`;
      const data = await createInbox(id);

      setInboxId(data.inboxId);
      setEmail(data.email);
      setMessages([]);
      setSelectedMessageId("");
      lastSeenMessageIdRef.current = "";
      window.location.hash = data.inboxId;

      await loadInbox(data.inboxId);

      setStatus("Inbox created successfully");
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "Gagal generate email");
    } finally {
      setLoading(false);
    }
  }

  async function handleRefreshInbox() {
    if (!inboxId) {
      setStatus("Sila generate email dulu");
      return;
    }

    try {
      markInteraction();
      await loadInbox(inboxId);
      setStatus("Inbox refreshed");
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "Gagal refresh inbox");
    }
  }

  async function handleClearInbox() {
    if (!inboxId) {
      setStatus("Tiada inbox untuk dibersihkan");
      return;
    }

    try {
      markInteraction();
      setLoading(true);
      await clearInbox(inboxId);
      setMessages([]);
      setSelectedMessageId("");
      lastSeenMessageIdRef.current = "";
      setStatus("Inbox cleared");
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "Gagal clear inbox");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteMessage(messageId: string) {
    try {
      markInteraction();
      setLoading(true);
      await deleteMessage(messageId);
      await loadInbox(inboxId);
      setStatus("Message deleted");
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "Gagal delete message");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyEmail() {
    if (!email) return;
    await navigator.clipboard.writeText(email);
    setStatus("Email copied");
    setTimeout(() => setStatus("Ready"), 1200);
  }

  async function handleCopyShareLink() {
    if (!shareLink) return;
    await navigator.clipboard.writeText(shareLink);
    setStatus("Share link copied");
    setTimeout(() => setStatus("Ready"), 1200);
  }

  async function handleCopyOtp() {
    if (!selectedMessage?.otp) return;
    await navigator.clipboard.writeText(selectedMessage.otp);
    setStatus("OTP copied");
    setTimeout(() => setStatus("Ready"), 1200);
  }

  useEffect(() => {
    const idFromHash = window.location.hash.replace("#", "").trim().toLowerCase();
    if (!idFromHash) return;

    setInboxId(idFromHash);
    setEmail(`${idFromHash}@kimkim.store`);
    loadInbox(idFromHash);
  }, []);

  useEffect(() => {
    if (!inboxId) return;

    const interval = setInterval(() => {
      loadInbox(inboxId, true);
    }, 3000);

    return () => clearInterval(interval);
  }, [inboxId]);

  return (
    <>
      <style>{`
        :root {
          color-scheme: dark;
          --bg-1: #060b16;
          --bg-2: #0a1324;
          --bg-3: #11213e;
          --card: rgba(12, 20, 36, 0.72);
          --card-2: rgba(15, 24, 41, 0.85);
          --border: rgba(148, 163, 184, 0.12);
          --border-strong: rgba(148, 163, 184, 0.18);
          --text: #f8fafc;
          --muted: #94a3b8;
          --soft: #64748b;
          --brand: #22d3ee;
          --brand-2: #38bdf8;
          --success: #22c55e;
          --danger: #ef4444;
          --purple: #6366f1;
          --shadow: 0 20px 60px rgba(0,0,0,0.32);
          --radius-xl: 30px;
          --radius-lg: 22px;
          --radius-md: 16px;
        }

        * { box-sizing: border-box; }

        html, body, #root {
          min-height: 100%;
          margin: 0;
          padding: 0;
          background:
            radial-gradient(circle at top left, rgba(34,211,238,0.10), transparent 28%),
            radial-gradient(circle at bottom right, rgba(59,130,246,0.14), transparent 35%),
            linear-gradient(180deg, #0a1324 0%, #07101d 45%, #040812 100%);
          color: var(--text);
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        button {
          font: inherit;
        }

        .app-shell {
          min-height: 100vh;
          padding: 38px 20px 60px;
          position: relative;
          overflow: hidden;
        }

        .container {
          width: min(1380px, 100%);
          margin: 0 auto;
          position: relative;
          z-index: 2;
        }

        .glow {
          position: fixed;
          border-radius: 999px;
          pointer-events: none;
          filter: blur(80px);
          z-index: 0;
        }

        .glow-one {
          width: 420px;
          height: 420px;
          top: -120px;
          left: -100px;
          background: rgba(34, 211, 238, 0.10);
        }

        .glow-two {
          width: 520px;
          height: 520px;
          bottom: -180px;
          right: -140px;
          background: rgba(59, 130, 246, 0.12);
        }

        .hero {
          text-align: center;
          margin-bottom: 30px;
        }

        .badge {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 9px 16px;
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.60);
          border: 1px solid rgba(148, 163, 184, 0.12);
          color: #bae6fd;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.04em;
          backdrop-filter: blur(14px);
          margin-bottom: 20px;
          box-shadow: 0 10px 26px rgba(0,0,0,0.18);
        }

        .hero h1 {
          margin: 0 0 14px;
          font-size: clamp(38px, 6vw, 68px);
          line-height: 1.02;
          letter-spacing: -0.04em;
          font-weight: 900;
          color: #fff;
          text-shadow: 0 14px 40px rgba(0,0,0,0.28);
        }

        .hero p {
          max-width: 860px;
          margin: 0 auto;
          font-size: clamp(17px, 2vw, 21px);
          line-height: 1.7;
          color: var(--muted);
        }

        .panel {
          background: rgba(12, 20, 36, 0.62);
          border: 1px solid var(--border);
          border-radius: var(--radius-xl);
          backdrop-filter: blur(22px);
          box-shadow: var(--shadow);
        }

        .toolbar {
          padding: 24px;
          margin-bottom: 18px;
        }

        .toolbar-row {
          display: flex;
          gap: 12px;
          justify-content: center;
          flex-wrap: wrap;
        }

        .btn {
          border: 1px solid transparent;
          border-radius: 15px;
          padding: 14px 22px;
          cursor: pointer;
          color: white;
          font-weight: 800;
          font-size: 15px;
          transition: transform 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease;
        }

        .btn:hover { transform: translateY(-1px); }
        .btn:active { transform: translateY(0); }

        .btn-primary {
          background: linear-gradient(135deg, #06b6d4, #0ea5e9);
          border-color: rgba(34, 211, 238, 0.18);
          box-shadow: 0 16px 36px rgba(14, 165, 233, 0.22);
        }

        .btn-secondary {
          background: rgba(51, 65, 85, 0.85);
          border-color: rgba(148, 163, 184, 0.12);
          color: #f8fafc;
        }

        .btn-danger {
          background: linear-gradient(135deg, #b91c1c, #ef4444);
          border-color: rgba(239, 68, 68, 0.15);
          box-shadow: 0 16px 32px rgba(239, 68, 68, 0.16);
        }

        .btn-ghost {
          background: rgba(30, 41, 59, 0.52);
          border-color: rgba(148, 163, 184, 0.10);
          color: #e2e8f0;
        }

        .current-email-card {
          margin-top: 22px;
          padding: 28px 24px;
          border-radius: 24px;
          background:
            linear-gradient(180deg, rgba(2, 8, 23, 0.98) 0%, rgba(5, 12, 28, 0.98) 100%);
          border: 1px solid rgba(56, 189, 248, 0.14);
          text-align: center;
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,0.03),
            0 20px 50px rgba(0,0,0,0.38);
        }

        .current-label {
          color: #9fb3c9;
          margin-bottom: 10px;
          font-size: 18px;
          font-weight: 600;
        }

        .current-value {
          font-size: clamp(28px, 4vw, 54px);
          line-height: 1.15;
          font-weight: 900;
          letter-spacing: -0.03em;
          color: #39d8ff;
          text-shadow: 0 0 20px rgba(57,216,255,0.20);
          word-break: break-word;
        }

        .current-actions {
          margin-top: 18px;
          display: flex;
          justify-content: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .btn-small {
          border: none;
          border-radius: 12px;
          padding: 11px 16px;
          cursor: pointer;
          color: white;
          font-weight: 800;
          font-size: 14px;
        }

        .btn-success {
          background: linear-gradient(135deg, #16a34a, #22c55e);
          box-shadow: 0 12px 24px rgba(34,197,94,0.18);
        }

        .btn-info {
          background: linear-gradient(135deg, #0284c7, #0ea5e9);
          box-shadow: 0 12px 24px rgba(14,165,233,0.18);
        }

        .inbox-id {
          color: #64748b;
          margin-top: 14px;
          font-size: 15px;
          font-weight: 600;
        }

        .empty-inbox-box {
          margin-top: 22px;
          padding: 22px;
          text-align: center;
          border-radius: 20px;
          color: var(--muted);
          border: 1px dashed rgba(148,163,184,0.18);
          background: rgba(2, 8, 23, 0.48);
        }

        .status-row {
          display: flex;
          justify-content: center;
          margin-bottom: 20px;
        }

        .status-pill {
          min-width: 240px;
          min-height: 48px;
          border-radius: 999px;
          padding: 12px 18px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 15px;
          backdrop-filter: blur(12px);
          border: 1px solid transparent;
          box-shadow: 0 12px 30px rgba(0,0,0,0.16);
        }

        .status-loading {
          background: rgba(250, 204, 21, 0.10);
          color: #fde68a;
          border-color: rgba(250, 204, 21, 0.18);
        }

        .status-ready {
          background: rgba(34, 197, 94, 0.10);
          color: #86efac;
          border-color: rgba(34, 197, 94, 0.18);
        }

        .grid {
          display: grid;
          grid-template-columns: 420px minmax(0, 1fr);
          gap: 22px;
          align-items: start;
        }

        .column-title {
          margin-bottom: 14px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }

        .title-main {
          font-size: 28px;
          font-weight: 900;
          letter-spacing: -0.02em;
          color: #f8fafc;
        }

        .title-sub {
          margin-top: 4px;
          color: #7c93b1;
          font-size: 14px;
        }

        .inbox-list-card,
        .viewer-card {
          background: rgba(12, 20, 36, 0.62);
          border: 1px solid var(--border);
          border-radius: 26px;
          backdrop-filter: blur(18px);
          box-shadow: var(--shadow);
        }

        .inbox-list-card {
          overflow: hidden;
        }

        .viewer-card {
          padding: 24px;
          min-height: 680px;
        }

        .empty-state {
          padding: 38px 24px;
          text-align: center;
        }

        .empty-state h3 {
          margin: 0 0 8px;
          font-size: 20px;
          color: #e2e8f0;
        }

        .empty-state p {
          margin: 0;
          color: #7c93b1;
          line-height: 1.7;
          font-size: 15px;
        }

        .msg-item {
          width: 100%;
          text-align: left;
          background: transparent;
          border: none;
          border-bottom: 1px solid rgba(51, 65, 85, 0.42);
          color: white;
          padding: 18px;
          cursor: pointer;
          transition: background 0.18s ease, transform 0.18s ease;
        }

        .msg-item:hover {
          background: rgba(15, 34, 63, 0.38);
        }

        .msg-item.active {
          background: linear-gradient(180deg, rgba(14, 45, 83, 0.78), rgba(9, 24, 44, 0.88));
        }

        .msg-top {
          display: flex;
          justify-content: space-between;
          align-items: start;
          gap: 10px;
          margin-bottom: 8px;
        }

        .msg-subject {
          flex: 1;
          font-size: 18px;
          font-weight: 850;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          color: #f8fafc;
        }

        .msg-from {
          color: #9fb3c9;
          font-size: 14px;
          margin-bottom: 8px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .msg-preview {
          color: #6d84a2;
          font-size: 14px;
          line-height: 1.65;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .otp-badge {
          flex-shrink: 0;
          padding: 6px 10px;
          font-size: 11px;
          border-radius: 999px;
          font-weight: 800;
          color: #e0e7ff;
          background: linear-gradient(135deg, #3730a3, #4f46e5);
          box-shadow: 0 10px 24px rgba(79,70,229,0.24);
          letter-spacing: 0.04em;
        }

        .viewer-top {
          display: flex;
          justify-content: space-between;
          align-items: start;
          gap: 16px;
          margin-bottom: 18px;
        }

        .viewer-subject {
          margin: 0;
          font-size: clamp(30px, 3vw, 42px);
          line-height: 1.08;
          font-weight: 900;
          letter-spacing: -0.03em;
          color: #fff;
          word-break: break-word;
        }

        .meta-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
          margin-top: 20px;
          margin-bottom: 20px;
        }

        .meta-item {
          padding: 14px 16px;
          border-radius: 18px;
          background: rgba(2, 8, 23, 0.52);
          border: 1px solid rgba(51, 65, 85, 0.44);
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .meta-label {
          color: #7c93b1;
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .meta-value {
          color: #e2e8f0;
          font-size: 15px;
          line-height: 1.6;
          word-break: break-word;
        }

        .viewer-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }

        .delete-btn {
          padding: 12px 16px;
          border-radius: 12px;
          border: 1px solid rgba(239,68,68,0.14);
          cursor: pointer;
          background: #b91c1c;
          color: #fff;
          font-weight: 800;
          font-size: 14px;
        }

        .otp-panel {
          margin-bottom: 20px;
          padding: 22px;
          border-radius: 22px;
          background:
            linear-gradient(135deg, rgba(37, 99, 235, 0.20) 0%, rgba(79, 70, 229, 0.26) 100%);
          border: 1px solid rgba(99, 102, 241, 0.22);
          box-shadow: 0 18px 40px rgba(59,130,246,0.14);
        }

        .otp-overline {
          color: #c7d2fe;
          font-size: 13px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-bottom: 10px;
        }

        .otp-value {
          font-size: clamp(34px, 4vw, 48px);
          font-weight: 900;
          letter-spacing: 0.08em;
          color: white;
          text-shadow: 0 0 18px rgba(255,255,255,0.14);
          margin-bottom: 14px;
          word-break: break-word;
        }

        .body-card {
          background: rgba(2, 8, 23, 0.74);
          border: 1px solid rgba(51, 65, 85, 0.54);
          border-radius: 22px;
          padding: 24px;
          color: #e2e8f0;
          white-space: pre-wrap;
          line-height: 1.85;
          font-size: 16px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
        }

        .viewer-empty {
          padding: 90px 24px;
          text-align: center;
        }

        .viewer-empty h3 {
          margin: 0 0 10px;
          font-size: 28px;
          font-weight: 900;
          color: #dbeafe;
        }

        .viewer-empty p {
          margin: 0;
          color: #7c93b1;
          font-size: 16px;
          line-height: 1.7;
        }

        @media (max-width: 1080px) {
          .grid {
            grid-template-columns: 1fr;
          }

          .viewer-card {
            min-height: 520px;
          }
        }

        @media (max-width: 720px) {
          .app-shell {
            padding: 24px 14px 40px;
          }

          .toolbar {
            padding: 18px;
          }

          .viewer-card,
          .inbox-list-card {
            border-radius: 22px;
          }

          .meta-grid {
            grid-template-columns: 1fr;
          }

          .viewer-top {
            flex-direction: column;
          }

          .current-email-card {
            padding: 22px 18px;
          }

          .hero p {
            font-size: 16px;
          }
        }
      `}</style>

      <div
        className="app-shell"
        onClick={markInteraction}
        onKeyDown={markInteraction}
      >
        <div className="glow glow-one" />
        <div className="glow glow-two" />

        <div className="container">
          <header className="hero">
            <div className="badge">Kim Mail • Private OTP Inbox</div>
            <h1>Luxury temporary email, built for serious OTP workflows</h1>
            <p>
              Generate disposable inboxes instantly, detect OTP automatically,
              monitor messages in real time, and manage everything through a clean,
              premium dashboard experience.
            </p>
          </header>

          <section className="panel toolbar">
            <div className="toolbar-row">
              <button className="btn btn-primary" onClick={handleGenerateEmail}>
                Generate Email
              </button>

              <button className="btn btn-secondary" onClick={handleRefreshInbox}>
                Refresh Inbox
              </button>

              <button className="btn btn-danger" onClick={handleClearInbox}>
                Clear All
              </button>

              <button
                className="btn btn-ghost"
                onClick={() => {
                  markInteraction();
                  setSoundEnabled((prev) => !prev);
                }}
              >
                Sound: {soundEnabled ? "On" : "Off"}
              </button>
            </div>

            {email ? (
              <div className="current-email-card">
                <div className="current-label">Current Email</div>
                <div className="current-value">{email}</div>

                <div className="current-actions">
                  <button className="btn-small btn-success" onClick={handleCopyShareLink}>
                    Copy Share Link
                  </button>
                  <button className="btn-small btn-info" onClick={handleCopyEmail}>
                    Copy Email
                  </button>
                </div>

                <div className="inbox-id">Inbox ID: {inboxId}</div>
              </div>
            ) : (
              <div className="empty-inbox-box">
                Click <strong>Generate Email</strong> to create your first inbox.
              </div>
            )}
          </section>

          <div className="status-row">
            <div className={`status-pill ${loading ? "status-loading" : "status-ready"}`}>
              {loading ? "Loading inbox..." : status}
            </div>
          </div>

          <section className="grid">
            <div>
              <div className="column-title">
                <div>
                  <div className="title-main">Inbox</div>
                  <div className="title-sub">
                    {messages.length} message{messages.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>

              <div className="inbox-list-card">
                {messages.length === 0 ? (
                  <div className="empty-state">
                    <h3>No messages yet</h3>
                    <p>Incoming emails for this inbox will appear here automatically.</p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isActive = selectedMessage?.id === msg.id;

                    return (
                      <button
                        key={msg.id}
                        className={`msg-item ${isActive ? "active" : ""}`}
                        onClick={() => {
                          markInteraction();
                          setSelectedMessageId(msg.id);
                        }}
                      >
                        <div className="msg-top">
                          <div className="msg-subject">{msg.subject}</div>
                          {msg.otp && <div className="otp-badge">OTP</div>}
                        </div>

                        <div className="msg-from">{msg.from}</div>
                        <div className="msg-preview">{msg.preview || msg.body}</div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="viewer-card">
              {!selectedMessage ? (
                <div className="viewer-empty">
                  <h3>No message selected</h3>
                  <p>Select any message from the inbox list to read full content and OTP.</p>
                </div>
              ) : (
                <>
                  <div className="viewer-top">
                    <div style={{ flex: 1 }}>
                      <h2 className="viewer-subject">{selectedMessage.subject}</h2>
                    </div>

                    <div className="viewer-actions">
                      <button
                        className="delete-btn"
                        onClick={() => handleDeleteMessage(selectedMessage.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="meta-grid">
                    <div className="meta-item">
                      <span className="meta-label">From</span>
                      <span className="meta-value">{selectedMessage.from}</span>
                    </div>

                    <div className="meta-item">
                      <span className="meta-label">To</span>
                      <span className="meta-value">{selectedMessage.to}</span>
                    </div>

                    <div className="meta-item">
                      <span className="meta-label">Source</span>
                      <span className="meta-value">{selectedMessage.source || "-"}</span>
                    </div>

                    <div className="meta-item">
                      <span className="meta-label">Received</span>
                      <span className="meta-value">
                        {selectedMessage.receivedAt
                          ? new Date(selectedMessage.receivedAt).toLocaleString()
                          : "-"}
                      </span>
                    </div>
                  </div>

                  {selectedMessage.otp && (
                    <div className="otp-panel">
                      <div className="otp-overline">OTP detected</div>
                      <div className="otp-value">{selectedMessage.otp}</div>
                      <button className="btn-small btn-success" onClick={handleCopyOtp}>
                        Copy OTP
                      </button>
                    </div>
                  )}

                  <div className="body-card">{selectedMessage.body}</div>
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}