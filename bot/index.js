require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const API_BASE = process.env.API_BASE || "https://kimkim-backend.onrender.com";
const MAIL_DOMAIN = process.env.MAIL_DOMAIN || "kimkim.store";
const FRONTEND_BASE = process.env.FRONTEND_BASE || "http://localhost:5173";

// guna satu inbox aktif untuk kegunaan sendiri
let currentInbox = "test";

// ==========================
// HELPERS
// ==========================
function normalizeInboxId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^#/, "")
    .replace(new RegExp(`@${MAIL_DOMAIN}$`, "i"), "")
    .replace(/[^a-z0-9._-]/g, "");
}

function buildInboxEmail(inboxId) {
  return `${inboxId}@${MAIL_DOMAIN}`;
}

function buildInboxLink(inboxId) {
  return `${FRONTEND_BASE.replace(/\/$/, "")}/#${inboxId}`;
}

async function fetchInbox(inboxId) {
  const res = await fetch(`${API_BASE}/api/inboxes/${encodeURIComponent(inboxId)}`);
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Backend error ${res.status}: ${text}`);
  }

  return JSON.parse(text);
}

// ==========================
// BASIC COMMANDS
// ==========================
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `🤖 KIM MAIL BOT

Commands:
/chatid - ambil chat id
/set test - set inbox aktif
/inbox - tengok inbox semasa
/messages - latest 5 emails
/otp - latest OTP
/open - buka link inbox

Inbox semasa: ${buildInboxEmail(currentInbox)}`
  );
});

bot.onText(/\/chatid/, (msg) => {
  bot.sendMessage(msg.chat.id, `Chat ID: ${msg.chat.id}`);
});

bot.onText(/\/set(?:\s+(.+))?/, (msg, match) => {
  const rawValue = match?.[1] || "";
  const inboxId = normalizeInboxId(rawValue);

  if (!inboxId) {
    return bot.sendMessage(msg.chat.id, "Guna format: /set test");
  }

  currentInbox = inboxId;

  bot.sendMessage(
    msg.chat.id,
    `✅ Inbox set ke: ${currentInbox}

📬 Email: ${buildInboxEmail(currentInbox)}
🔗 Link: ${buildInboxLink(currentInbox)}`
  );
});

bot.onText(/\/inbox/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `📬 Inbox semasa anda

Email: ${buildInboxEmail(currentInbox)}
Inbox ID: ${currentInbox}
Link: ${buildInboxLink(currentInbox)}`
  );
});

bot.onText(/\/open/, (msg) => {
  bot.sendMessage(msg.chat.id, `🔗 ${buildInboxLink(currentInbox)}`);
});

// ==========================
// FETCH EMAILS
// ==========================
bot.onText(/\/messages?/, async (msg) => {
  try {
    const data = await fetchInbox(currentInbox);

    if (!data.messages || data.messages.length === 0) {
      return bot.sendMessage(msg.chat.id, "Tiada email");
    }

    const text = data.messages
      .slice(0, 5)
      .map((m, i) => {
        return `${i + 1}. ${m.subject}
From: ${m.from}
OTP: ${m.otp || "tiada"}`;
      })
      .join("\n\n");

    bot.sendMessage(msg.chat.id, `📨 5 mesej terakhir:\n\n${text}`);
  } catch (err) {
    console.error("/messages error:", err.message);
    bot.sendMessage(msg.chat.id, `❌ Error fetch messages\n${err.message}`);
  }
});

// ==========================
// OTP
// ==========================
bot.onText(/\/otp/, async (msg) => {
  try {
    const data = await fetchInbox(currentInbox);

    if (!data.messages || data.messages.length === 0) {
      return bot.sendMessage(msg.chat.id, "❌ Tiada email");
    }

    const otpMsg = data.messages.find((m) => m.otp);

    if (!otpMsg) {
      return bot.sendMessage(msg.chat.id, "❌ Tiada OTP");
    }

    bot.sendMessage(
      msg.chat.id,
      `🔐 OTP terkini

Code: ${otpMsg.otp}
Subject: ${otpMsg.subject}`
    );
  } catch (err) {
    console.error("/otp error:", err.message);
    bot.sendMessage(msg.chat.id, `❌ Error OTP\n${err.message}`);
  }
});

// ==========================
// UNKNOWN COMMAND
// ==========================
bot.on("message", (msg) => {
  const text = String(msg.text || "").trim();
  if (!text.startsWith("/")) return;

  const knownCommands = ["/start", "/chatid", "/set", "/inbox", "/messages", "/otp", "/open"];
  const isKnown = knownCommands.some((cmd) => text.startsWith(cmd));

  if (!isKnown) {
    bot.sendMessage(
      msg.chat.id,
      "Command tak dikenali.\nGuna /start untuk tengok senarai command."
    );
  }
});

bot.on("polling_error", (error) => {
  console.error("Polling error:", error.message);
});

console.log("🤖 Bot running...");