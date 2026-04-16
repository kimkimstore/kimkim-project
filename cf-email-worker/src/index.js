export default {
  async email(message, env, ctx) {
    try {
      const inboxId = String(message.to || "")
        .split("@")[0]
        .trim()
        .toLowerCase();

      const headersObject = {};
      for (const [key, value] of message.headers.entries()) {
        headersObject[key] = value;
      }

      const rawText = await new Response(message.raw).text();

      const subjectMatch = rawText.match(/^subject:\s*(.+)$/im);
      const subject = subjectMatch ? subjectMatch[1].trim() : "(no subject)";

      const bodyParts = rawText.split(/\r?\n\r?\n/);
      const body =
        bodyParts.length > 1
          ? bodyParts.slice(1).join("\n\n").trim().slice(0, 10000)
          : rawText.slice(0, 10000);

      const response = await fetch(env.WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Token": env.WEBHOOK_TOKEN
        },
        body: JSON.stringify({
          inboxId,
          from: message.from,
          to: message.to,
          subject,
          body,
          headers: headersObject,
          rawSize: message.rawSize
        })
      });

      if (!response.ok) {
        const text = await response.text();
        console.error("Webhook failed:", response.status, text);
      }
    } catch (error) {
      console.error("Email worker error:", error);
    }
  }
};