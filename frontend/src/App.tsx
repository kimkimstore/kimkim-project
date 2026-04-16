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

function App() {
  const [email, setEmail] = useState("");
  const [inboxId, setInboxId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedMessageId, setSelectedMessageId] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [soundEnabled, setSoundEnabled] = useState(true);

  const lastSeenMessageIdRef = useRef("");
  const hasInteractedRef = useRef(false);

  const selectedMessage =
    messages.find((message) => message.id === selectedMessageId) ||
    messages[0] ||
    null;

  const shareLink = useMemo(() => {
    if (!inboxId || typeof window === "undefined") return "";
    return `${window.location.origin}${window.location.pathname}#${inboxId}`;
  }, [inboxId]);

  async function safeJson<T>(res: Response): Promise<T> {
    const text = await res.text();

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Response bukan JSON. Status ${res.status}: ${text.slice(0, 120)}`);
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
      oscillator.stop(ctx.currentTime + 0.15);
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
    setMessages((prev) => {
      if (JSON.stringify(prev) === JSON.stringify(nextMessages)) {
        return prev;
      }
      return nextMessages;
    });

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
      if (!isAutoRefresh) {
        setLoading(true);
      }

      const data = await fetchInbox(id);
      applyInboxData(data, isAutoRefresh);

      if (!isAutoRefresh) {
        setStatus(`Inbox loaded: ${data.total} message(s)`);
      }
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "Gagal load inbox");
    } finally {
      if (!isAutoRefresh) {
        setLoading(false);
      }
    }
  }

  async function handleGenerateEmail() {
    try {
      markInteraction();
      setLoading(true);
      setStatus("Generating inbox...");

      const id = "kim" + Math.floor(Math.random() * 100000);
      const data = await createInbox(id);

      setInboxId(data.inboxId);
      setEmail(data.email);
      setMessages([]);
      setSelectedMessageId("");
      lastSeenMessageIdRef.current = "";
      window.location.hash = data.inboxId;

      await loadInbox(data.inboxId);

      setStatus("Email berjaya dijana");
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
      setStatus("Inbox berjaya di-refresh");
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
      setStatus("Inbox berjaya dibersihkan");
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
      setStatus("Message berjaya dipadam");
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "Gagal delete message");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopyEmail() {
    if (!email) {
      setStatus("Tiada email untuk dicopy");
      return;
    }

    try {
      markInteraction();
      await navigator.clipboard.writeText(email);
      setStatus("✅ Email copied!");
      setTimeout(() => setStatus(""), 2000);
    } catch (error) {
      console.error(error);
      setStatus("Gagal copy email");
    }
  }

  async function handleCopyShareLink() {
    if (!shareLink) {
      setStatus("Tiada inbox untuk dikongsi");
      return;
    }

    try {
      markInteraction();
      await navigator.clipboard.writeText(shareLink);
      setStatus("✅ Link copied!");
      setTimeout(() => setStatus(""), 2000);
    } catch (error) {
      console.error(error);
      setStatus("Gagal copy link");
    }
  }

  async function handleCopyOtp() {
    if (!selectedMessage?.otp) {
      setStatus("Tiada OTP untuk dicopy");
      return;
    }

    try {
      markInteraction();
      await navigator.clipboard.writeText(selectedMessage.otp);
      setStatus("✅ OTP copied!");
      setTimeout(() => setStatus(""), 2000);
    } catch (error) {
      console.error(error);
      setStatus("Gagal copy OTP");
    }
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
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at top, #0f2748 0%, #09162c 40%, #08111f 100%)",
        color: "white",
        fontFamily: "Arial, sans-serif",
        padding: "32px",
      }}
      onClick={markInteraction}
      onKeyDown={markInteraction}
    >
      <div style={{ maxWidth: "1360px", margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <h1 style={{ fontSize: "46px", marginBottom: "10px", fontWeight: 800 }}>
            KimKim Temp Email
          </h1>
          <p style={{ color: "#9fb3c9", fontSize: "20px", margin: 0 }}>
            Temporary inbox + OTP viewer + Telegram-ready workflow
          </p>
        </div>

        <div
          style={{
            background: "rgba(30, 41, 59, 0.92)",
            border: "1px solid rgba(71, 85, 105, 0.45)",
            padding: "22px",
            borderRadius: "20px",
            marginBottom: "20px",
            boxShadow: "0 12px 40px rgba(0, 0, 0, 0.35)",
          }}
        >
          <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={handleGenerateEmail} style={buttonPrimary}>
              Generate Email
            </button>

            <button onClick={handleRefreshInbox} style={buttonSecondary}>
              Refresh Inbox
            </button>

            <button onClick={handleClearInbox} style={buttonDanger}>
              Clear All
            </button>

            <button
              onClick={() => {
                markInteraction();
                setSoundEnabled((prev) => !prev);
              }}
              style={buttonSecondary}
            >
              Sound: {soundEnabled ? "On" : "Off"}
            </button>
          </div>

          {email && (
            <div
              style={{
                marginTop: "20px",
                padding: "18px",
                borderRadius: "18px",
                background: "#020817",
                border: "1px solid rgba(51, 65, 85, 0.75)",
                textAlign: "center",
              }}
            >
              <div style={{ color: "#9fb3c9", marginBottom: "8px", fontSize: "18px" }}>
                Current Email
              </div>

              <div
                style={{
                  fontSize: "34px",
                  color: "#22d3ee",
                  fontWeight: 800,
                  textShadow: "0 0 16px rgba(34, 211, 238, 0.3)",
                  wordBreak: "break-all",
                }}
              >
                {email}
              </div>

              <div
                style={{
                  marginTop: "14px",
                  display: "flex",
                  justifyContent: "center",
                  gap: "10px",
                  flexWrap: "wrap",
                }}
              >
                <button onClick={handleCopyShareLink} style={smallSuccessButton}>
                  Copy Share Link
                </button>

                <button onClick={handleCopyEmail} style={smallInfoButton}>
                  Copy Email
                </button>
              </div>

              <div style={{ color: "#64748b", marginTop: "12px", fontSize: "16px" }}>
                Inbox ID: {inboxId}
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            marginBottom: "20px",
            color: loading ? "#facc15" : "#22c55e",
            fontWeight: 700,
            textAlign: "center",
            minHeight: "28px",
            fontSize: "20px",
          }}
        >
          {loading ? "🔄 Loading inbox..." : status}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "420px 1fr",
            gap: "20px",
            alignItems: "start",
          }}
        >
          <div
            style={{
              background: "rgba(30, 41, 59, 0.92)",
              border: "1px solid rgba(71, 85, 105, 0.45)",
              borderRadius: "20px",
              overflow: "hidden",
              boxShadow: "0 12px 40px rgba(0, 0, 0, 0.25)",
            }}
          >
            <div
              style={{
                padding: "18px 20px",
                borderBottom: "1px solid rgba(51, 65, 85, 0.7)",
                fontSize: "26px",
                fontWeight: 800,
              }}
            >
              Inbox
            </div>

            {messages.length === 0 ? (
              <div style={{ padding: "24px", color: "#94a3b8" }}>Tiada message lagi</div>
            ) : (
              messages.map((msg) => {
                const isActive = selectedMessage?.id === msg.id;

                return (
                  <button
                    key={msg.id}
                    onClick={() => {
                      markInteraction();
                      setSelectedMessageId(msg.id);
                    }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      background: isActive ? "#0b1d39" : "#0f172a",
                      border: "none",
                      borderBottom: "1px solid rgba(51, 65, 85, 0.5)",
                      color: "white",
                      padding: "16px 18px",
                      cursor: "pointer",
                      position: "relative",
                    }}
                  >
                    {msg.otp && (
                      <div
                        style={{
                          position: "absolute",
                          top: "12px",
                          right: "12px",
                          background: "#4338ca",
                          color: "#ddd6fe",
                          borderRadius: "999px",
                          fontSize: "11px",
                          padding: "4px 8px",
                          fontWeight: 700,
                        }}
                      >
                        OTP
                      </div>
                    )}

                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: "19px",
                        marginBottom: "6px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        paddingRight: msg.otp ? "50px" : "0",
                      }}
                    >
                      {msg.subject}
                    </div>

                    <div
                      style={{
                        color: "#8da2bb",
                        fontSize: "15px",
                        marginBottom: "6px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {msg.from}
                    </div>

                    <div
                      style={{
                        color: "#64748b",
                        fontSize: "14px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {msg.preview || msg.body}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div
            style={{
              background: "rgba(30, 41, 59, 0.92)",
              border: "1px solid rgba(71, 85, 105, 0.45)",
              borderRadius: "20px",
              padding: "24px",
              minHeight: "560px",
              boxShadow: "0 12px 40px rgba(0, 0, 0, 0.25)",
            }}
          >
            <div style={{ fontSize: "30px", fontWeight: 800, marginBottom: "16px" }}>
              Message Viewer
            </div>

            {!selectedMessage ? (
              <div style={{ color: "#94a3b8" }}>No message selected</div>
            ) : (
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "16px",
                    alignItems: "start",
                    marginBottom: "18px",
                  }}
                >
                  <div>
                    <div style={{ fontSize: "28px", fontWeight: 800, marginBottom: "8px" }}>
                      {selectedMessage.subject}
                    </div>
                    <div style={{ color: "#9fb3c9", marginBottom: "6px", fontSize: "17px" }}>
                      From: {selectedMessage.from}
                    </div>
                    <div style={{ color: "#9fb3c9", marginBottom: "6px", fontSize: "17px" }}>
                      To: {selectedMessage.to}
                    </div>
                    <div style={{ color: "#64748b", marginBottom: "6px", fontSize: "15px" }}>
                      Source: {selectedMessage.source || "-"}
                    </div>
                    <div style={{ color: "#64748b", fontSize: "15px" }}>
                      {selectedMessage.receivedAt
                        ? new Date(selectedMessage.receivedAt).toLocaleString()
                        : "-"}
                    </div>
                  </div>

                  <button
                    onClick={() => handleDeleteMessage(selectedMessage.id)}
                    style={buttonDanger}
                  >
                    Delete
                  </button>
                </div>

                {selectedMessage.otp && (
                  <div
                    style={{
                      marginBottom: "18px",
                      padding: "16px",
                      borderRadius: "14px",
                      background: "linear-gradient(135deg, #312e81, #4338ca)",
                      color: "#ddd6fe",
                      fontWeight: 800,
                      fontSize: "22px",
                    }}
                  >
                    <div>OTP detected: {selectedMessage.otp}</div>

                    <button
                      onClick={handleCopyOtp}
                      style={{
                        marginTop: "12px",
                        padding: "10px 14px",
                        borderRadius: "10px",
                        border: "none",
                        cursor: "pointer",
                        background: "#22c55e",
                        color: "white",
                        fontWeight: 800,
                        fontSize: "14px",
                      }}
                    >
                      Copy OTP
                    </button>
                  </div>
                )}

                <div
                  style={{
                    background: "#0f172a",
                    border: "1px solid rgba(51, 65, 85, 0.7)",
                    padding: "18px",
                    borderRadius: "16px",
                    color: "#e2e8f0",
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.7,
                    fontSize: "17px",
                  }}
                >
                  {selectedMessage.body}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const buttonPrimary: React.CSSProperties = {
  padding: "14px 20px",
  borderRadius: "12px",
  border: "none",
  cursor: "pointer",
  background: "#06b6d4",
  color: "white",
  fontWeight: 800,
  fontSize: "16px",
};

const buttonSecondary: React.CSSProperties = {
  padding: "14px 20px",
  borderRadius: "12px",
  border: "none",
  cursor: "pointer",
  background: "#334155",
  color: "white",
  fontWeight: 800,
  fontSize: "16px",
};

const buttonDanger: React.CSSProperties = {
  padding: "14px 20px",
  borderRadius: "12px",
  border: "none",
  cursor: "pointer",
  background: "#991b1b",
  color: "white",
  fontWeight: 800,
  fontSize: "16px",
};

const smallSuccessButton: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: "10px",
  border: "none",
  cursor: "pointer",
  background: "#22c55e",
  color: "white",
  fontWeight: 800,
  fontSize: "14px",
};

const smallInfoButton: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: "10px",
  border: "none",
  cursor: "pointer",
  background: "#0ea5e9",
  color: "white",
  fontWeight: 800,
  fontSize: "14px",
};

export default App;