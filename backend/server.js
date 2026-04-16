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

    // ==========================
    // TELEGRAM AUTO NOTIFY
    // ==========================
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

        await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: messageText,
          }),
        });

        console.log("✅ Telegram sent");
      } catch (err) {
        console.error("❌ Telegram error:", err.message);
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