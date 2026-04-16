require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const API_BASE = process.env.API_BASE;
const MAIL_DOMAIN = process.env.MAIL_DOMAIN;

let currentInbox = "test"; // default

// ==========================
// BASIC COMMANDS
// ==========================

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `🤖 KIM MAIL BOT

Commands:
/chatid - ambil chat id
/set test - set inbox
/messages - latest emails
/otp - latest OTP
`
  );
});

bot.onText(/\/chatid/, (msg) => {
  bot.sendMessage(msg.chat.id, `Chat ID: ${msg.chat.id}`);
});

bot.onText(/\/set (.+)/, (msg, match) => {
  currentInbox = match[1];
  bot.sendMessage(msg.chat.id, `✅ Inbox set ke: ${currentInbox}`);
});

// ==========================
// FETCH EMAILS
// ==========================

bot.onText(/\/messages/, async (msg) => {
  try {
    const res = await fetch(`${API_BASE}/api/inboxes/${currentInbox}`);
    const data = await res.json();

    if (!data.messages.length) {
      return bot.sendMessage(msg.chat.id, "Tiada email");
    }

    const text = data.messages
      .slice(0, 5)
      .map(
        (m, i) =>
          `${i + 1}. ${m.subject}\nFrom: ${m.from}\nOTP: ${
            m.otp || "tiada"
          }`
      )
      .join("\n\n");

    bot.sendMessage(msg.chat.id, text);
  } catch (err) {
    bot.sendMessage(msg.chat.id, "Error fetch messages");
  }
});

// ==========================
// OTP
// ==========================

bot.onText(/\/otp/, async (msg) => {
  try {
    const res = await fetch(`${API_BASE}/api/inboxes/${currentInbox}`);
    const data = await res.json();

    const otpMsg = data.messages.find((m) => m.otp);

    if (!otpMsg) {
      return bot.sendMessage(msg.chat.id, "❌ Tiada OTP");
    }

    bot.sendMessage(
      msg.chat.id,
      `🔐 OTP: ${otpMsg.otp}\nSubject: ${otpMsg.subject}`
    );
  } catch (err) {
    bot.sendMessage(msg.chat.id, "Error OTP");
  }
});

console.log("🤖 Bot running...");