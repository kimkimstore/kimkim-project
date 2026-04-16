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
    const safeSubject = subject || "(no subject)";
    const safeBody = body || "";

    const otp = extractOtp(safeBody);

    // ==========================
    // SIMPAN DATABASE
    // ==========================
    await db.run(
      `INSERT INTO messages (id, inbox_id, sender, subject, body, otp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        Date.now().toString(),
        safeInboxId,
        safeFrom,
        safeSubject,
        safeBody,
        otp,
      ]
    );

    // ==========================
    // TELEGRAM AUTO SEND
    // ==========================
    if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      try {
        await fetch(
          `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              chat_id: process.env.TELEGRAM_CHAT_ID,
              text: `📩 Email masuk

Inbox: ${safeInboxId}
Subject: ${safeSubject}
From: ${safeFrom}
OTP: ${otp || "tiada"}`,
            }),
          }
        );

        console.log("✅ Telegram sent");
      } catch (err) {
        console.log("❌ Telegram error:", err.message);
      }
    }

    res.json({
      success: true,
      inboxId: safeInboxId,
      otp,
    });
  } catch (err) {
    console.log("❌ ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});