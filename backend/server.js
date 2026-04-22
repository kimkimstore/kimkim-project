app.post("/api/incoming/cloudflare", async (req, res) => {
  try {
    const incomingToken = req.headers["x-webhook-token"];

    if (!incomingToken || incomingToken !== process.env.WEBHOOK_TOKEN) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized webhook",
      });
    }

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
      return res.status(400).json({ success: false, error: "Missing inboxId" });
    }

    const safeInboxId = String(inboxId).trim().toLowerCase();
    const safeFrom = String(from || "unknown@example.com").trim().toLowerCase();
    const safeTo = String(to || `${safeInboxId}@kimkim.store`).trim().toLowerCase();
    const safeSubject = String(subject || "(no subject)").trim();
    const safeBody = String(body || "").trim();
    const safeHeaders = headers ? JSON.stringify(headers) : null;
    const safeOtp = extractOtp(safeBody);
    const now = new Date().toISOString();

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

    // TELEGRAM AUTO PUSH
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        const messageText = [
          "📩 Email baru masuk",
          "",
          `📬 Inbox: ${safeInboxId}`,
          `📌 Subject: ${safeSubject}`,
          `👤 From: ${safeFrom}`,
          `🔐 OTP: ${safeOtp || "tiada"}`,
        ].join("\n");

        const telegramRes = await fetch(
          `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              chat_id: process.env.TELEGRAM_CHAT_ID,
              text: messageText,
            }),
          }
        );

        const telegramText = await telegramRes.text();

        if (!telegramRes.ok) {
          console.error("❌ Telegram API error:", telegramRes.status, telegramText);
        } else {
          console.log("✅ Telegram sent:", telegramText);
        }
      } catch (telegramError) {
        console.error("❌ Telegram error:", telegramError.message);
      }
    } else {
      console.log("ℹ️ Telegram env belum lengkap, skip Telegram notify");
    }

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