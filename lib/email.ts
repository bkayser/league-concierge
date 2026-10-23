// Sends transactional email through Resend's REST API. RESEND_API_KEY is
// provisioned by the Vercel Marketplace integration; EMAIL_FROM must be an
// address on a domain verified in Resend.

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("RESEND_API_KEY and EMAIL_FROM must be set to send email");
    this.name = "EmailNotConfiguredError";
  }
}

export async function sendLoginCode(to: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    // Local development without email configured: surface the code in the
    // server log instead of failing the login flow.
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[dev] Admin login code for ${to}: ${code}`);
      return;
    }
    throw new EmailNotConfiguredError();
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `${code} is your Ask Footy admin code`,
      text: `Your Ask Footy admin sign-in code is ${code}.\n\nIt expires in 10 minutes. If you did not request it, you can ignore this email.`,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend send failed (HTTP ${res.status}): ${detail}`);
  }
}
