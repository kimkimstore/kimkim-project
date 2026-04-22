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
    return `${window.location.origin}/#${inboxId}`;
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
      oscillator.frequency.value = 920;
      gain.gain.value = 0.03;

      oscillator.connect(gain);
      gain.connect(ctx.destination);

      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.12);
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
    setTimeout(() => setStatus(""), 1200);
  }

  async function handleCopyShareLink() {
    if (!shareLink) return;
    await navigator.clipboard.writeText(shareLink);
    setStatus("Share link copied");
    setTimeout(() => setStatus(""), 1200);
  }

  async function handleCopyOtp() {
    if (!selectedMessage?.otp) return;
    await navigator.clipboard.writeText(selectedMessage.otp);
    setStatus("OTP copied");
    setTimeout(() => setStatus(""), 1200);
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
      style={styles.page}
      onClick={markInteraction}
      onKeyDown={markInteraction}
    >
      <div style={styles.backgroundGlowOne} />
      <div style={styles.backgroundGlowTwo} />

      <div style={styles.container}>
        <header style={styles.hero}>
          <div style={styles.badge}>Kim Mail • Premium Temporary Inbox</div>
          <h1 style={styles.heroTitle}>Private temp email for fast OTP workflows</h1>
          <p style={styles.heroSubtitle}>
            Generate disposable inboxes, monitor incoming mail, detect OTP automatically,
            and manage everything in one clean dashboard.
          </p>
        </header>

        <section style={styles.controlPanel}>
          <div style={styles.controlTopRow}>
            <button onClick={handleGenerateEmail} style={styles.primaryButton}>
              Generate Email
            </button>

            <button onClick={handleRefreshInbox} style={styles.secondaryButton}>
              Refresh Inbox
            </button>

            <button onClick={handleClearInbox} style={styles.dangerButton}>
              Clear All
            </button>

            <button
              onClick={() => {
                markInteraction();
                setSoundEnabled((prev) => !prev);
              }}
              style={styles.ghostButton}
            >
              Sound: {soundEnabled ? "On" : "Off"}
            </button>
          </div>

          {email ? (
            <div style={styles.currentEmailCard}>
              <div style={styles.currentEmailLabel}>Current Email</div>
              <div style={styles.currentEmailValue}>{email}</div>

              <div style={styles.currentEmailActions}>
                <button onClick={handleCopyShareLink} style={styles.successSmallButton}>
                  Copy Share Link
                </button>
                <button onClick={handleCopyEmail} style={styles.infoSmallButton}>
                  Copy Email
                </button>
              </div>

              <div style={styles.inboxIdText}>Inbox ID: {inboxId}</div>
            </div>
          ) : (
            <div style={styles.emptyCurrentEmail}>
              Click <strong>Generate Email</strong> to create your first inbox
            </div>
          )}
        </section>

        <div style={styles.statusRow}>
          <div
            style={{
              ...styles.statusPill,
              ...(loading ? styles.statusLoading : styles.statusReady),
            }}
          >
            {loading ? "Loading inbox..." : status || "Ready"}
          </div>
        </div>

        <section style={styles.mainGrid}>
          <div style={styles.leftColumn}>
            <div style={styles.cardHeaderRow}>
              <div>
                <div style={styles.cardTitle}>Inbox</div>
                <div style={styles.cardSubTitle}>
                  {messages.length} message{messages.length === 1 ? "" : "s"}
                </div>
              </div>
            </div>

            <div style={styles.inboxCard}>
              {messages.length === 0 ? (
                <div style={styles.emptyState}>
                  <div style={styles.emptyStateTitle}>No messages yet</div>
                  <div style={styles.emptyStateText}>
                    Incoming emails for this inbox will appear here automatically.
                  </div>
                </div>
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
                        ...styles.messageItem,
                        ...(isActive ? styles.messageItemActive : {}),
                      }}
                    >
                      <div style={styles.messageItemTop}>
                        <div style={styles.messageSubject}>{msg.subject}</div>
                        {msg.otp && <div style={styles.otpBadge}>OTP</div>}
                      </div>

                      <div style={styles.messageFrom}>{msg.from}</div>
                      <div style={styles.messagePreview}>{msg.preview || msg.body}</div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div style={styles.viewerCard}>
            <div style={styles.cardHeaderRow}>
              <div>
                <div style={styles.cardTitle}>Message Viewer</div>
                <div style={styles.cardSubTitle}>
                  {selectedMessage ? "Detailed message view" : "Select a message to view"}
                </div>
              </div>

              {selectedMessage && (
                <button
                  onClick={() => handleDeleteMessage(selectedMessage.id)}
                  style={styles.deleteViewerButton}
                >
                  Delete
                </button>
              )}
            </div>

            {!selectedMessage ? (
              <div style={styles.viewerEmpty}>
                <div style={styles.viewerEmptyTitle}>No message selected</div>
                <div style={styles.viewerEmptyText}>
                  Pick a message from the inbox list to view full content and OTP.
                </div>
              </div>
            ) : (
              <div>
                <div style={styles.metaBlock}>
                  <h2 style={styles.viewerSubject}>{selectedMessage.subject}</h2>

                  <div style={styles.metaGrid}>
                    <div style={styles.metaItem}>
                      <span style={styles.metaLabel}>From</span>
                      <span style={styles.metaValue}>{selectedMessage.from}</span>
                    </div>

                    <div style={styles.metaItem}>
                      <span style={styles.metaLabel}>To</span>
                      <span style={styles.metaValue}>{selectedMessage.to}</span>
                    </div>

                    <div style={styles.metaItem}>
                      <span style={styles.metaLabel}>Source</span>
                      <span style={styles.metaValue}>{selectedMessage.source || "-"}</span>
                    </div>

                    <div style={styles.metaItem}>
                      <span style={styles.metaLabel}>Received</span>
                      <span style={styles.metaValue}>
                        {selectedMessage.receivedAt
                          ? new Date(selectedMessage.receivedAt).toLocaleString()
                          : "-"}
                      </span>
                    </div>
                  </div>
                </div>

                {selectedMessage.otp && (
                  <div style={styles.otpPanel}>
                    <div style={styles.otpPanelTop}>OTP detected</div>
                    <div style={styles.otpValue}>{selectedMessage.otp}</div>
                    <button onClick={handleCopyOtp} style={styles.copyOtpButton}>
                      Copy OTP
                    </button>
                  </div>
                )}

                <div style={styles.messageBodyCard}>{selectedMessage.body}</div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top, #14325d 0%, #0b1730 32%, #07101d 62%, #040812 100%)",
    color: "#f8fafc",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    padding: "36px 20px 60px",
    position: "relative",
    overflow: "hidden",
  },

  backgroundGlowOne: {
    position: "absolute",
    width: "420px",
    height: "420px",
    borderRadius: "999px",
    background: "rgba(34, 211, 238, 0.08)",
    filter: "blur(70px)",
    top: "-120px",
    left: "-80px",
    pointerEvents: "none",
  },

  backgroundGlowTwo: {
    position: "absolute",
    width: "520px",
    height: "520px",
    borderRadius: "999px",
    background: "rgba(59, 130, 246, 0.10)",
    filter: "blur(100px)",
    bottom: "-180px",
    right: "-140px",
    pointerEvents: "none",
  },

  container: {
    maxWidth: "1380px",
    margin: "0 auto",
    position: "relative",
    zIndex: 1,
  },

  hero: {
    textAlign: "center",
    marginBottom: "28px",
  },

  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 14px",
    borderRadius: "999px",
    background: "rgba(15, 23, 42, 0.7)",
    border: "1px solid rgba(148, 163, 184, 0.14)",
    color: "#93c5fd",
    fontSize: "13px",
    fontWeight: 700,
    letterSpacing: "0.03em",
    marginBottom: "20px",
    backdropFilter: "blur(10px)",
  },

  heroTitle: {
    fontSize: "56px",
    lineHeight: 1.04,
    fontWeight: 900,
    margin: "0 0 14px",
    letterSpacing: "-0.03em",
    color: "#f8fafc",
    textShadow: "0 8px 30px rgba(0,0,0,0.3)",
  },

  heroSubtitle: {
    maxWidth: "820px",
    margin: "0 auto",
    color: "#93a9c4",
    fontSize: "20px",
    lineHeight: 1.6,
  },

  controlPanel: {
    background: "rgba(15, 23, 42, 0.55)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    borderRadius: "28px",
    padding: "24px",
    marginBottom: "20px",
    backdropFilter: "blur(18px)",
    boxShadow: "0 20px 70px rgba(0,0,0,0.28)",
  },

  controlTopRow: {
    display: "flex",
    gap: "12px",
    justifyContent: "center",
    flexWrap: "wrap",
  },

  currentEmailCard: {
    marginTop: "22px",
    padding: "26px 24px",
    borderRadius: "22px",
    background:
      "linear-gradient(180deg, rgba(2, 8, 23, 0.96) 0%, rgba(3, 12, 28, 0.96) 100%)",
    border: "1px solid rgba(56, 189, 248, 0.16)",
    textAlign: "center",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 16px 50px rgba(0,0,0,0.4)",
  },

  currentEmailLabel: {
    color: "#9fb3c9",
    marginBottom: "10px",
    fontSize: "18px",
    fontWeight: 600,
  },

  currentEmailValue: {
    fontSize: "clamp(28px, 3vw, 50px)",
    color: "#33d7ff",
    fontWeight: 900,
    textShadow: "0 0 18px rgba(51, 215, 255, 0.22)",
    wordBreak: "break-word",
    lineHeight: 1.2,
    letterSpacing: "-0.02em",
  },

  currentEmailActions: {
    marginTop: "18px",
    display: "flex",
    justifyContent: "center",
    gap: "10px",
    flexWrap: "wrap",
  },

  inboxIdText: {
    color: "#64748b",
    marginTop: "14px",
    fontSize: "15px",
    fontWeight: 600,
  },

  emptyCurrentEmail: {
    marginTop: "20px",
    padding: "20px",
    borderRadius: "18px",
    background: "rgba(2, 8, 23, 0.65)",
    border: "1px dashed rgba(100, 116, 139, 0.38)",
    color: "#94a3b8",
    textAlign: "center",
    fontSize: "16px",
  },

  statusRow: {
    display: "flex",
    justifyContent: "center",
    marginBottom: "22px",
  },

  statusPill: {
    minHeight: "46px",
    padding: "12px 18px",
    borderRadius: "999px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 800,
    fontSize: "15px",
    border: "1px solid transparent",
    backdropFilter: "blur(10px)",
    minWidth: "240px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.16)",
  },

  statusLoading: {
    background: "rgba(250, 204, 21, 0.12)",
    color: "#fde68a",
    borderColor: "rgba(250, 204, 21, 0.2)",
  },

  statusReady: {
    background: "rgba(34, 197, 94, 0.12)",
    color: "#86efac",
    borderColor: "rgba(34, 197, 94, 0.2)",
  },

  mainGrid: {
    display: "grid",
    gridTemplateColumns: "430px minmax(0, 1fr)",
    gap: "22px",
    alignItems: "start",
  },

  leftColumn: {
    minWidth: 0,
  },

  cardHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    marginBottom: "14px",
  },

  cardTitle: {
    fontSize: "28px",
    fontWeight: 900,
    letterSpacing: "-0.02em",
    color: "#f8fafc",
  },

  cardSubTitle: {
    color: "#7c93b1",
    fontSize: "14px",
    marginTop: "4px",
  },

  inboxCard: {
    background: "rgba(15, 23, 42, 0.62)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    borderRadius: "26px",
    overflow: "hidden",
    backdropFilter: "blur(18px)",
    boxShadow: "0 18px 60px rgba(0,0,0,0.28)",
  },

  emptyState: {
    padding: "34px 24px",
    textAlign: "center",
  },

  emptyStateTitle: {
    color: "#dbeafe",
    fontWeight: 800,
    fontSize: "18px",
    marginBottom: "8px",
  },

  emptyStateText: {
    color: "#7c93b1",
    fontSize: "15px",
    lineHeight: 1.7,
  },

  messageItem: {
    width: "100%",
    textAlign: "left",
    background: "transparent",
    border: "none",
    borderBottom: "1px solid rgba(51, 65, 85, 0.46)",
    color: "white",
    padding: "18px 18px",
    cursor: "pointer",
    transition: "all 0.18s ease",
  },

  messageItemActive: {
    background: "linear-gradient(180deg, rgba(15, 48, 86, 0.75), rgba(10, 27, 49, 0.86))",
  },

  messageItemTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    alignItems: "start",
    marginBottom: "8px",
  },

  messageSubject: {
    fontWeight: 800,
    fontSize: "18px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: "#f8fafc",
    flex: 1,
  },

  otpBadge: {
    flexShrink: 0,
    background: "linear-gradient(135deg, #3730a3, #4f46e5)",
    color: "#e0e7ff",
    borderRadius: "999px",
    fontSize: "11px",
    padding: "6px 10px",
    fontWeight: 800,
    letterSpacing: "0.04em",
    boxShadow: "0 8px 18px rgba(79, 70, 229, 0.26)",
  },

  messageFrom: {
    color: "#9fb3c9",
    fontSize: "14px",
    marginBottom: "8px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },

  messagePreview: {
    color: "#6d84a2",
    fontSize: "14px",
    lineHeight: 1.6,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },

  viewerCard: {
    background: "rgba(15, 23, 42, 0.62)",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    borderRadius: "26px",
    padding: "24px",
    minHeight: "650px",
    backdropFilter: "blur(18px)",
    boxShadow: "0 18px 60px rgba(0,0,0,0.28)",
  },

  viewerEmpty: {
    padding: "80px 24px",
    textAlign: "center",
  },

  viewerEmptyTitle: {
    fontSize: "26px",
    fontWeight: 900,
    marginBottom: "10px",
    color: "#dbeafe",
  },

  viewerEmptyText: {
    color: "#7c93b1",
    fontSize: "16px",
  },

  metaBlock: {
    marginBottom: "18px",
    paddingBottom: "18px",
    borderBottom: "1px solid rgba(51, 65, 85, 0.5)",
  },

  viewerSubject: {
    fontSize: "36px",
    fontWeight: 900,
    margin: "0 0 20px",
    lineHeight: 1.15,
    letterSpacing: "-0.03em",
    color: "#f8fafc",
    wordBreak: "break-word",
  },

  metaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "14px",
  },

  metaItem: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "14px 16px",
    borderRadius: "16px",
    background: "rgba(2, 8, 23, 0.5)",
    border: "1px solid rgba(51, 65, 85, 0.45)",
  },

  metaLabel: {
    color: "#7c93b1",
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  },

  metaValue: {
    color: "#e2e8f0",
    fontSize: "15px",
    lineHeight: 1.6,
    wordBreak: "break-word",
  },

  otpPanel: {
    marginBottom: "20px",
    padding: "20px",
    borderRadius: "22px",
    background:
      "linear-gradient(135deg, rgba(37, 99, 235, 0.22) 0%, rgba(79, 70, 229, 0.26) 100%)",
    border: "1px solid rgba(99, 102, 241, 0.24)",
    boxShadow: "0 16px 36px rgba(59, 130, 246, 0.14)",
  },

  otpPanelTop: {
    color: "#c7d2fe",
    fontSize: "13px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    marginBottom: "10px",
  },

  otpValue: {
    fontSize: "42px",
    fontWeight: 900,
    letterSpacing: "0.08em",
    color: "#ffffff",
    textShadow: "0 0 18px rgba(255,255,255,0.15)",
    marginBottom: "14px",
    wordBreak: "break-word",
  },

  messageBodyCard: {
    background: "rgba(2, 8, 23, 0.72)",
    border: "1px solid rgba(51, 65, 85, 0.56)",
    padding: "22px",
    borderRadius: "20px",
    color: "#e2e8f0",
    whiteSpace: "pre-wrap",
    lineHeight: 1.8,
    fontSize: "16px",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
  },

  primaryButton: {
    padding: "14px 22px",
    borderRadius: "14px",
    border: "1px solid rgba(34, 211, 238, 0.24)",
    cursor: "pointer",
    background: "linear-gradient(135deg, #06b6d4, #0ea5e9)",
    color: "white",
    fontWeight: 900,
    fontSize: "15px",
    boxShadow: "0 14px 30px rgba(14, 165, 233, 0.24)",
  },

  secondaryButton: {
    padding: "14px 22px",
    borderRadius: "14px",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    cursor: "pointer",
    background: "rgba(51, 65, 85, 0.82)",
    color: "white",
    fontWeight: 800,
    fontSize: "15px",
  },

  dangerButton: {
    padding: "14px 22px",
    borderRadius: "14px",
    border: "1px solid rgba(239, 68, 68, 0.16)",
    cursor: "pointer",
    background: "linear-gradient(135deg, #991b1b, #dc2626)",
    color: "white",
    fontWeight: 800,
    fontSize: "15px",
    boxShadow: "0 12px 28px rgba(220, 38, 38, 0.18)",
  },

  ghostButton: {
    padding: "14px 22px",
    borderRadius: "14px",
    border: "1px solid rgba(148, 163, 184, 0.12)",
    cursor: "pointer",
    background: "rgba(30, 41, 59, 0.52)",
    color: "#e2e8f0",
    fontWeight: 800,
    fontSize: "15px",
    backdropFilter: "blur(8px)",
  },

  successSmallButton: {
    padding: "11px 16px",
    borderRadius: "12px",
    border: "none",
    cursor: "pointer",
    background: "linear-gradient(135deg, #16a34a, #22c55e)",
    color: "white",
    fontWeight: 800,
    fontSize: "14px",
  },

  infoSmallButton: {
    padding: "11px 16px",
    borderRadius: "12px",
    border: "none",
    cursor: "pointer",
    background: "linear-gradient(135deg, #0284c7, #0ea5e9)",
    color: "white",
    fontWeight: 800,
    fontSize: "14px",
  },

  copyOtpButton: {
    padding: "12px 16px",
    borderRadius: "12px",
    border: "none",
    cursor: "pointer",
    background: "#22c55e",
    color: "white",
    fontWeight: 800,
    fontSize: "14px",
  },

  deleteViewerButton: {
    padding: "12px 16px",
    borderRadius: "12px",
    border: "1px solid rgba(239, 68, 68, 0.14)",
    cursor: "pointer",
    background: "#b91c1c",
    color: "white",
    fontWeight: 800,
    fontSize: "14px",
  },
};

export default App;