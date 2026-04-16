require("dotenv").config();

const PORT = Number(process.env.PORT || 3000);
const DOMAIN = process.env.DOMAIN || "kimkim.store";

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const MAX_MESSAGES_PER_INBOX = 100;

let db;

function randomId() {
  return crypto.randomBytes(8).toString("hex");
}

function normalizeInboxId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
}

function emailFromInboxId(inboxId) {
  return `${inboxId}@${DOMAIN}`;
}

function extractOtp(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();

  const strongMatch = normalized.match(
    /\b(?:otp|code|verification code|security code|passcode)[:\s-]*([0-9]{4,10})\b/i
  );
  if (strongMatch) return strongMatch[1];

  const fallbackMatch = normalized.match(/\b([0-9]{4,10})\b/);
  return fallbackMatch ? fallbackMatch[1] : null;
}

async function initDatabase() {
  db = await open({
    filename: path.join(__dirname, "mail.db"),
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS inboxes (
      inbox_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      source TEXT DEFAULT 'local'
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      inbox_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      preview TEXT NOT NULL,
      received_at TEXT NOT NULL,
      unread INTEGER NOT NULL DEFAULT 1,
      otp TEXT,
      source TEXT DEFAULT 'local',
      raw_headers TEXT,
      raw_size INTEGER,
      FOREIGN KEY (inbox_id) REFERENCES inboxes(inbox_id) ON DELETE CASCADE
    );
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_inbox_id
    ON messages(inbox_id);
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_received_at
    ON messages(received_at DESC);
  `);
}

async function ensureInbox(inboxId, source = "local") {
  const normalized = normalizeInboxId(inboxId);

  if (!normalized) {
    throw new Error("inboxId tidak sah");
  }

  const existing = await db.get(
    `SELECT inbox_id, email, created_at, source FROM inboxes WHERE inbox_id = ?`,
    [normalized]
  );

  if (existing) {
    return existing;
  }

  const createdAt = new Date().toISOString();
  const email = emailFromInboxId(normalized);

  await db.run(
    `INSERT INTO inboxes (inbox_id, email, created_at, source) VALUES (?, ?, ?, ?)`,
    [normalized, email, createdAt, source]
  );

  return {
    inbox_id: normalized,
    email,
    created_at: createdAt,
    source,
  };
}

async function getInboxMessages(inboxId) {
  const rows = await db.all(
    `
    SELECT
      id,
      sender as "from",
      recipient as "to",
      subject,
      body,
      preview,
      received_at as "receivedAt",
      unread,
      otp,
      source,
      raw_headers as "rawHeaders",
      raw_size as "rawSize"
    FROM messages
    WHERE inbox_id = ?
    ORDER BY received_at DESC
    LIMIT ?
    `,
    [inboxId, MAX_MESSAGES_PER_INBOX]
  );

  return rows.map((row) => ({
    ...row,
    unread: Boolean(row.unread),
  }));
}

async function trimInboxMessages(inboxId) {
  const extraMessages = await db.all(
    `
    SELECT id
    FROM messages
    WHERE inbox_id = ?
    ORDER BY received_at DESC
    LIMIT -1 OFFSET ?
    `,
    [inboxId, MAX_MESSAGES_PER_INBOX]
  );

  if (extraMessages.length > 0) {
    const ids = extraMessages.map((row) => row.id);
    const placeholders = ids.map(() => "?").join(", ");
    await db.run(`DELETE FROM messages WHERE id IN (${placeholders})`, ids);
  }
}

app.get("/api/health", async (_req, res) => {
  const inboxCount = await db.get(`SELECT COUNT(*) as total FROM inboxes`);
  const messageCount = await db.get(`SELECT COUNT(*) as total FROM messages`);

  res.json({
    ok: true,
    service: "kimkim-mail-backend",
    domain: DOMAIN,
    inboxes: inboxCount.total,
    messages: messageCount.total,
    storage: "sqlite",
  });
});

app.post("/api/inboxes", async (req, res) => {
  try {
    const inboxId = normalizeInboxId(req.body.inboxId);

    if (!inboxId) {
      return res.status(400).json({
        success: false,
        message: "inboxId diperlukan",
      });
    }

    const inbox = await ensureInbox(inboxId);
    const totalRow = await db.get(
      `SELECT COUNT(*) as total FROM messages WHERE inbox_id = ?`,
      [inbox.inbox_id]
    );

    return res.status(201).json({
      success: true,
      inboxId: inbox.inbox_id,
      email: inbox.email,
      total: totalRow.total,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

app.get("/api/inboxes/:inboxId", async (req, res) => {
  try {
    const inbox = await ensureInbox(req.params.inboxId);
    const messages = await getInboxMessages(inbox.inbox_id);

    return res.json({
      success: true,
      inboxId: inbox.inbox_id,
      email: inbox.email,
      total: messages.length,
      messages,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

app.post("/api/simulate/incoming", async (req, res) => {
  try {
    const inboxId = normalizeInboxId(req.body.inboxId);
    const from = String(req.body.from || "noreply@example.com").trim().toLowerCase();
    const subject = String(req.body.subject || "New message").trim();
    const body = String(req.body.body || "").trim();

    if (!inboxId) {
      return res.status(400).json({
        success: false,
        message: "inboxId diperlukan",
      });
    }

    const inbox = await ensureInbox(inboxId);

    const message = {
      id: randomId(),
      inbox_id: inbox.inbox_id,
      from,
      to: inbox.email,
      subject,
      body,
      preview: body.slice(0, 140),
      receivedAt: new Date().toISOString(),
      unread: 1,
      otp: extractOtp(body),
      source: "simulated",
      rawHeaders: null,
      rawSize: body.length,
    };

    await db.run(
      `
      INSERT INTO messages (
        id, inbox_id, sender, recipient, subject, body, preview, received_at, unread, otp, source, raw_headers, raw_size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        message.id,
        message.inbox_id,
        message.from,
        message.to,
        message.subject,
        message.body,
        message.preview,
        message.receivedAt,
        message.unread,
        message.otp,
        message.source,
        message.rawHeaders,
        message.rawSize,
      ]
    );

    await trimInboxMessages(inbox.inbox_id);

    return res.status(201).json({
      success: true,
      inboxId: inbox.inbox_id,
      message: {
        id: message.id,
        from: message.from,
        to: message.to,
        subject: message.subject,
        body: message.body,
        preview: message.preview,
        receivedAt: message.receivedAt,
        unread: true,
        otp: message.otp,
        source: message.source,
      },
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * REAL INCOMING WEBHOOK
 * Cloudflare Email Worker boleh POST metadata email ke sini.
 */
app.post("/api/incoming/cloudflare", async (req, res) => {
  try {
    console.log("📩 Incoming email:", req.body);

    const {
      inboxId,
      from,
      to,
      subject,
      body,
      headers,
      rawSize,
    } = req.body;

    if (!inboxId) {
      return res.status(400).json({ error: "Missing inboxId" });
    }

    const safeInboxId = String(inboxId).trim().toLowerCase();
    const safeFrom = from || "unknown@example.com";
    const safeTo = to || `${safeInboxId}@kimkim.store`;
    const safeSubject = subject || "(no subject)";
    const safeBody = body || "";
    const safeHeaders = headers ? JSON.stringify(headers) : null;
    const safeOtp = extractOtp(safeBody);
    const now = new Date().toISOString();

    // pastikan inbox wujud
    await ensureInbox(safeInboxId, "cloudflare");

    await db.run(
      `
      INSERT INTO messages (
        id,
        inbox_id,
        sender,
        recipient,
        subject,
        body,
        preview,
        received_at,
        unread,
        otp,
        source,
        raw_headers,
        raw_size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        randomId(),
        safeInboxId,
        safeFrom,
        safeTo,
        safeSubject,
        safeBody,
        safeBody.slice(0, 140),
        now,
        1,
        safeOtp,
        "cloudflare",
        safeHeaders,
        Number(rawSize || 0),
      ]
    );

    await trimInboxMessages(safeInboxId);

    return res.json({
      success: true,
      inboxId: safeInboxId,
      otp: safeOtp,
    });
  } catch (err) {
    console.error("❌ ERROR INCOMING EMAIL:", err);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

app.delete("/api/inboxes/:inboxId/messages/:messageId", async (req, res) => {
  try {
    const inbox = await ensureInbox(req.params.inboxId);
    const messageId = String(req.params.messageId);

    await db.run(
      `DELETE FROM messages WHERE id = ? AND inbox_id = ?`,
      [messageId, inbox.inbox_id]
    );

    const totalRow = await db.get(
      `SELECT COUNT(*) as total FROM messages WHERE inbox_id = ?`,
      [inbox.inbox_id]
    );

    return res.json({
      success: true,
      total: totalRow.total,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

app.delete("/api/inboxes/:inboxId", async (req, res) => {
  try {
    const inbox = await ensureInbox(req.params.inboxId);

    await db.run(`DELETE FROM messages WHERE inbox_id = ?`, [inbox.inbox_id]);

    return res.json({
      success: true,
      total: 0,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

app.patch("/api/inboxes/:inboxId/messages/:messageId/read", async (req, res) => {
  try {
    const inbox = await ensureInbox(req.params.inboxId);
    const messageId = String(req.params.messageId);

    const existing = await db.get(
      `SELECT id FROM messages WHERE id = ? AND inbox_id = ?`,
      [messageId, inbox.inbox_id]
    );

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Message tidak dijumpai",
      });
    }

    await db.run(
      `UPDATE messages SET unread = 0 WHERE id = ? AND inbox_id = ?`,
      [messageId, inbox.inbox_id]
    );

    const updated = await db.get(
      `
      SELECT
        id,
        sender as "from",
        recipient as "to",
        subject,
        body,
        preview,
        received_at as "receivedAt",
        unread,
        otp,
        source
      FROM messages
      WHERE id = ? AND inbox_id = ?
      `,
      [messageId, inbox.inbox_id]
    );

    return res.json({
      success: true,
      message: {
        ...updated,
        unread: Boolean(updated.unread),
      },
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * ADMIN: list semua inbox
 */
app.get("/api/admin/inboxes", async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT
        i.inbox_id as "inboxId",
        i.email,
        i.created_at as "createdAt",
        i.source,
        COUNT(m.id) as "messageCount",
        MAX(m.received_at) as "lastReceivedAt"
      FROM inboxes i
      LEFT JOIN messages m ON m.inbox_id = i.inbox_id
      GROUP BY i.inbox_id
      ORDER BY COALESCE(MAX(m.received_at), i.created_at) DESC
    `);

    return res.json({
      success: true,
      inboxes: rows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

/**
 * ADMIN: recent messages across all inboxes
 */
app.get("/api/admin/messages", async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT
        id,
        inbox_id as "inboxId",
        sender as "from",
        recipient as "to",
        subject,
        preview,
        body,
        received_at as "receivedAt",
        unread,
        otp,
        source
      FROM messages
      ORDER BY received_at DESC
      LIMIT 100
    `);

    return res.json({
      success: true,
      messages: rows.map((row) => ({
        ...row,
        unread: Boolean(row.unread),
      })),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

async function startServer() {
  await initDatabase();

  app.listen(PORT, () => {
    console.log(`KimKim Mail backend running on http://localhost:${PORT}`);
    console.log(`Domain: ${DOMAIN}`);
    console.log(`Storage: SQLite (${path.join(__dirname, "mail.db")})`);
  });
}

startServer().catch((error) => {
  console.error("Gagal start backend:", error);
  process.exit(1);
});