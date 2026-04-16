require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Telegraf } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN;
const API_BASE = process.env.API_BASE || "http://localhost:3000";
const MAIL_DOMAIN = process.env.MAIL_DOMAIN || "kimkim.store";
const FRONTEND_BASE = process.env.FRONTEND_BASE || "http://localhost:5173";

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN tiada dalam .env");
}

const bot = new Telegraf(BOT_TOKEN);

const DATA_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({ users: {} }, null, 2),
      "utf8"
    );
  }
}

function readState() {
  ensureStorage();

  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed.users || typeof parsed.users !== "object") {
      return { users: {} };
    }
    return parsed;
  } catch (error) {
    console.error("state.json rosak, reset baru.");
    const cleanState = { users: {} };
    fs.writeFileSync(STATE_FILE, JSON.stringify(cleanState, null, 2), "utf8");
    return cleanState;
  }
}

function writeState(state) {
  ensureStorage();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function getUserState(userId) {
  const state = readState();
  return state.users[String(userId)] || { inboxId: null, lastSeenMessageId: null };
}

function setUserState(userId, partial) {
  const state = readState();
  const key = String(userId);

  state.users[key] = {
    inboxId: null,
    lastSeenMessageId: null,
    ...(state.users[key] || {}),
    ...partial,
  };

  writeState(state);
}

function getAllUsersState() {
  return readState().users || {};
}

function generateInboxId() {
  return "kim" + Math.floor(10000 + Math.random() * 90000);
}

function getEmailFromInboxId(inboxId) {
  return `${inboxId}@${MAIL_DOMAIN}`;
}

function getShareLink(inboxId) {
  return `${FRONTEND_BASE}/#${inboxId}`;
}

async function createInbox(inboxId) {
  const res = await fetch(`${API_BASE}/api/inboxes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inboxId }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create inbox gagal: ${res.status} ${text}`);
  }

  return res.json();
}

async function fetchInbox(inboxId) {
  const res = await fetch(`${API_BASE}/api/inboxes/${encodeURIComponent(inboxId)}`);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fetch inbox gagal: ${res.status} ${text}`);
  }

  return res.json();
}

async function simulateIncoming(inboxId) {
  const res = await fetch(`${API_BASE}/api/simulate/incoming`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inboxId,
      from: "noreply@test.com",
      subject: "OTP Login",
      body: `Your verification code is ${Math.floor(100000 + Math.random() * 900000)}`,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Simulate gagal: ${res.status} ${text}`);
  }

  return res.json();
}

async function clearInbox(inboxId) {
  const res = await fetch(`${API_BASE}/api/inboxes/${encodeURIComponent(inboxId)}`, {
    method: "DELETE",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Clear inbox gagal: ${res.status} ${text}`);
  }

  return res.json();
}

function formatLatestMessage(latest) {
  return [
    "📥 Email baru masuk",
    `Subject: ${latest.subject}`,
    `From: ${latest.from}`,
    latest.otp ? `OTP: ${latest.otp}` : "OTP: tiada",
  ].join("\n");
}

bot.start(async (ctx) => {
  await ctx.reply(
    [
      "🚀 KimKim Temp Mail Bot",
      "",
      "/new - generate inbox baru",
      "/set <inboxId> - attach inbox sedia ada",
      "/inbox - tunjuk inbox semasa",
      "/refresh - simulate email masuk",
      "/otp - ambil OTP terkini",
      "/messages - papar 5 mesej terakhir",
      "/clear - kosongkan inbox",
      "/open - bagi link inbox website",
      "/help - bantuan",
    ].join("\n")
  );
});

bot.help(async (ctx) => {
  await ctx.reply(
    [
      "📘 Bantuan Bot",
      "",
      "/new - generate inbox baru",
      "/set <inboxId> - attach inbox sedia ada",
      "/inbox - tunjuk inbox semasa",
      "/refresh - simulate email masuk",
      "/otp - ambil OTP terkini",
      "/messages - papar 5 mesej terakhir",
      "/clear - kosongkan inbox",
      "/open - buka inbox website",
    ].join("\n")
  );
});

bot.command("new", async (ctx) => {
  try {
    const userId = ctx.from.id;
    const inboxId = generateInboxId();

    await createInbox(inboxId);
    setUserState(userId, { inboxId, lastSeenMessageId: null });

    await ctx.reply(
      [
        "✅ Inbox baru berjaya dibuat",
        `📩 Email: ${getEmailFromInboxId(inboxId)}`,
        `🆔 Inbox ID: ${inboxId}`,
        `🔗 Share link: ${getShareLink(inboxId)}`,
      ].join("\n")
    );
  } catch (error) {
    console.error(error);
    await ctx.reply("❌ Gagal create inbox baru.");
  }
});

bot.command("set", async (ctx) => {
  try {
    const userId = ctx.from.id;
    const parts = ctx.message.text.split(" ");
    const inboxId = (parts[1] || "").trim().toLowerCase();

    if (!inboxId) {
      await ctx.reply("Gunakan format: /set kim12345");
      return;
    }

    await createInbox(inboxId);
    setUserState(userId, { inboxId, lastSeenMessageId: null });

    await ctx.reply(
      [
        "✅ Inbox berjaya diset",
        `📩 Email: ${getEmailFromInboxId(inboxId)}`,
        `🆔 Inbox ID: ${inboxId}`,
        `🔗 Share link: ${getShareLink(inboxId)}`,
      ].join("\n")
    );
  } catch (error) {
    console.error(error);
    await ctx.reply("❌ Gagal set inbox.");
  }
});

bot.command("inbox", async (ctx) => {
  try {
    const userId = ctx.from.id;
    const userState = getUserState(userId);

    if (!userState.inboxId) {
      await ctx.reply("Belum ada inbox. Guna /new dulu.");
      return;
    }

    await ctx.reply(
      [
        "📬 Inbox semasa anda",
        `Email: ${getEmailFromInboxId(userState.inboxId)}`,
        `Inbox ID: ${userState.inboxId}`,
        `Share link: ${getShareLink(userState.inboxId)}`,
      ].join("\n")
    );
  } catch (error) {
    console.error(error);
    await ctx.reply("❌ Gagal ambil inbox semasa.");
  }
});

bot.command("open", async (ctx) => {
  try {
    const userId = ctx.from.id;
    const userState = getUserState(userId);

    if (!userState.inboxId) {
      await ctx.reply("Belum ada inbox. Guna /new dulu.");
      return;
    }

    await ctx.reply(`🔗 ${getShareLink(userState.inboxId)}`);
  } catch (error) {
    console.error(error);
    await ctx.reply("❌ Gagal buka inbox.");
  }
});

bot.command("refresh", async (ctx) => {
  try {
    const userId = ctx.from.id;
    const userState = getUserState(userId);

    if (!userState.inboxId) {
      await ctx.reply("Belum ada inbox. Guna /new dulu.");
      return;
    }

    await simulateIncoming(userState.inboxId);
    const data = await fetchInbox(userState.inboxId);
    const latest = data.messages?.[0];

    if (!latest) {
      await ctx.reply("Inbox masih kosong.");
      return;
    }

    setUserState(userId, { lastSeenMessageId: latest.id });
    await ctx.reply(formatLatestMessage(latest));
  } catch (error) {
    console.error(error);
    await ctx.reply("❌ Gagal refresh inbox.");
  }
});

bot.command("otp", async (ctx) => {
  try {
    const userId = ctx.from.id;
    const userState = getUserState(userId);

    if (!userState.inboxId) {
      await ctx.reply("Belum ada inbox. Guna /new dulu.");
      return;
    }

    const data = await fetchInbox(userState.inboxId);
    const latestOtpMessage = (data.messages || []).find((msg) => msg.otp);

    if (!latestOtpMessage) {
      await ctx.reply("Tiada OTP dijumpai lagi.");
      return;
    }

    await ctx.reply(
      [
        "🔐 OTP terkini",
        `Code: ${latestOtpMessage.otp}`,
        `Subject: ${latestOtpMessage.subject}`,
      ].join("\n")
    );
  } catch (error) {
    console.error(error);
    await ctx.reply("❌ Gagal ambil OTP.");
  }
});

bot.command("messages", async (ctx) => {
  try {
    const userId = ctx.from.id;
    const userState = getUserState(userId);

    if (!userState.inboxId) {
      await ctx.reply("Belum ada inbox. Guna /new dulu.");
      return;
    }

    const data = await fetchInbox(userState.inboxId);
    const messages = data.messages || [];

    if (messages.length === 0) {
      await ctx.reply("Inbox kosong.");
      return;
    }

    const text = messages
      .slice(0, 5)
      .map((msg, index) =>
        [
          `${index + 1}. ${msg.subject}`,
          `From: ${msg.from}`,
          msg.otp ? `OTP: ${msg.otp}` : "OTP: tiada",
        ].join("\n")
      )
      .join("\n\n");

    await ctx.reply(`📨 5 mesej terakhir:\n\n${text}`);
  } catch (error) {
    console.error(error);
    await ctx.reply("❌ Gagal ambil senarai mesej.");
  }
});

bot.command("clear", async (ctx) => {
  try {
    const userId = ctx.from.id;
    const userState = getUserState(userId);

    if (!userState.inboxId) {
      await ctx.reply("Belum ada inbox. Guna /new dulu.");
      return;
    }

    await clearInbox(userState.inboxId);
    setUserState(userId, { lastSeenMessageId: null });

    await ctx.reply("🧹 Inbox berjaya dikosongkan.");
  } catch (error) {
    console.error(error);
    await ctx.reply("❌ Gagal clear inbox.");
  }
});

async function pollNewMessages() {
  const allUsers = getAllUsersState();

  for (const [userId, userState] of Object.entries(allUsers)) {
    try {
      if (!userState.inboxId) continue;

      const data = await fetchInbox(userState.inboxId);
      const latest = data.messages?.[0];

      if (!latest) continue;

      if (!userState.lastSeenMessageId) {
        setUserState(userId, { lastSeenMessageId: latest.id });
        continue;
      }

      if (latest.id !== userState.lastSeenMessageId) {
        setUserState(userId, { lastSeenMessageId: latest.id });
        await bot.telegram.sendMessage(Number(userId), `🔔 Notifikasi inbox baru\n\n${formatLatestMessage(latest)}`);
      }
    } catch (error) {
      console.error(`Polling error for user ${userId}:`, error.message);
    }
  }
}

ensureStorage();
setInterval(pollNewMessages, 10000);

bot.launch().then(() => {
  console.log("Telegram bot is running...");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));