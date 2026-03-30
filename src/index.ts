import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import nodemailer from "nodemailer";
import Stripe from "stripe";

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT ?? 4242);
const NODE_ENV = process.env.NODE_ENV ?? "development";

const FRONTEND_URL =
  process.env.FRONTEND_URL ?? "https://real-talk-summitwebsite.vercel.app";
const FRONTEND_URL_DEV =
  process.env.FRONTEND_URL_DEV ?? "http://localhost:5500";

const allowedOrigins = new Set(
  [FRONTEND_URL, FRONTEND_URL_DEV].filter(Boolean),
);
const isDev = NODE_ENV !== "production";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  throw new Error("Missing STRIPE_SECRET_KEY in environment.");
}

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2024-06-20",
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

const smtpHost = process.env.SMTP_HOST ?? "";
const smtpPort = Number(process.env.SMTP_PORT ?? 587);
const smtpSecure = (process.env.SMTP_SECURE ?? "false") === "true";
const smtpUser = process.env.SMTP_USER ?? "";
const smtpPass = process.env.SMTP_PASS ?? "";
const emailFrom = process.env.EMAIL_FROM ?? "";
const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim())
  .filter(Boolean);

const emailEnabled = Boolean(
  smtpHost && smtpPort && smtpUser && smtpPass && emailFrom,
);

const mailer = emailEnabled
  ? nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    })
  : null;

const MERCH_ITEMS = {
  hoodie: {
    id: "hoodie",
    name: "Real Talk Hoodie",
    description: "Official Real Talk Summit hoodie.",
    amount: 4000,
  },
  short_tee: {
    id: "short_tee",
    name: "Real Talk Short Sleeve T-shirt",
    description: "Official Real Talk Summit short sleeve tee.",
    amount: 2000,
  },
  long_tee: {
    id: "long_tee",
    name: "Real Talk Long Sleeve T-shirt",
    description: "Official Real Talk Summit long sleeve tee.",
    amount: 3000,
  },
  ticket: {
    id: "ticket",
    name: "Real Talk Summit Ticket",
    description: "General admission ticket.",
    amount: 2500,
  },
  sponsor_platinum: {
    id: "sponsor_platinum",
    name: "Platinum Sponsorship — Real Talk Summit",
    description:
      "Prominent logo on all event materials · social media spotlight · stage recognition · goodie bag item · vendor table · post-event metrics report.",
    amount: 50000,
  },
  sponsor_gold: {
    id: "sponsor_gold",
    name: "Gold Sponsorship — Real Talk Summit",
    description:
      "Medium logo on event materials · 3 dedicated social posts · stage recognition · goodie bag item · website logo placement.",
    amount: 35000,
  },
  sponsor_silver: {
    id: "sponsor_silver",
    name: "Silver Sponsorship — Real Talk Summit",
    description:
      "Logo on printed program & website · 2 social media acknowledgements · verbal recognition at the event.",
    amount: 20000,
  },
  sponsor_bronze: {
    id: "sponsor_bronze",
    name: "Bronze Sponsorship — Real Talk Summit",
    description:
      "Name on printed program · social media recognition post · website logo placement.",
    amount: 10000,
  },
  sponsor_supporter: {
    id: "sponsor_supporter",
    name: "Supporter Sponsorship — Real Talk Summit",
    description:
      "Name on printed program & website · social media thank-you post.",
    amount: 5000,
  },
} as const;

type MerchItemId = keyof typeof MERCH_ITEMS;

function isSponsorship(itemId: string) {
  return itemId.startsWith("sponsor_");
}

type CheckoutBody = {
  itemId: string;
  size?: string;
  message?: string;
  customer: {
    email: string;
    name?: string;
    businessName?: string;
  };
  deliveryAddress?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  deliveryAddressText?: string;
};

function pickBaseUrl(origin?: string) {
  if (origin && allowedOrigins.has(origin)) {
    return origin;
  }
  return NODE_ENV === "production" ? FRONTEND_URL : FRONTEND_URL_DEV;
}

function formatAmount(cents: number | null | undefined, currency = "usd") {
  if (!cents) return "";
  const amount = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount);
}

function parseAddress(metadataValue?: string) {
  if (!metadataValue) return null;
  try {
    return JSON.parse(metadataValue) as CheckoutBody["deliveryAddress"];
  } catch {
    return null;
  }
}

function formatAddressForEmail(options: {
  structured: CheckoutBody["deliveryAddress"] | null;
  text?: string | null;
}) {
  if (options.text) {
    return options.text;
  }
  if (!options.structured) return "Not provided";
  return [
    options.structured.line1,
    options.structured.line2,
    `${options.structured.city}, ${options.structured.state} ${options.structured.postalCode}`,
    options.structured.country,
  ]
    .filter(Boolean)
    .join("\n");
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function textToHtmlParagraphs(text: string) {
  return text
    .split("\n\n")
    .map((block) => {
      if (block.includes("\n* ")) {
        const [heading, ...items] = block.split("\n");
        const listItems = items
          .filter((item) => item.startsWith("* "))
          .map((item) => `<li>${escapeHtml(item.slice(2))}</li>`)
          .join("");

        return `${heading ? `<p style="margin:0 0 14px;color:#1a1917;font:400 16px/1.7 'DM Sans',Arial,sans-serif;">${escapeHtml(heading)}</p>` : ""}<ul style="margin:0 0 20px 22px;padding:0;color:#1a1917;font:400 16px/1.7 'DM Sans',Arial,sans-serif;">${listItems}</ul>`;
      }

      const html = escapeHtml(block).replaceAll("\n", "<br />");
      return `<p style="margin:0 0 16px;color:#1a1917;font:400 16px/1.7 'DM Sans',Arial,sans-serif;">${html}</p>`;
    })
    .join("");
}

function renderEmailShell(options: {
  eyebrow: string;
  title: string;
  intro: string;
  bodyHtml: string;
  accentLabel?: string;
}) {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f4f3f1;font-family:'DM Sans',Arial,sans-serif;color:#1a1917;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(options.intro)}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f3f1;margin:0;padding:24px 0;width:100%;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:680px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 20px 60px rgba(27,42,94,0.12);">
            <tr>
              <td style="padding:0;background:#1b2a5e;">
                <div style="background:linear-gradient(135deg, rgba(26,5,8,0.92) 0%, rgba(200,16,46,0.92) 45%, rgba(27,42,94,0.96) 100%);padding:42px 40px 36px;">
                  <div style="font:700 11px/1 'DM Sans',Arial,sans-serif;letter-spacing:0.18em;text-transform:uppercase;color:rgba(255,255,255,0.72);margin:0 0 14px;">${escapeHtml(options.eyebrow)}</div>
                  <div style="font:900 40px/1.05 Georgia,'Times New Roman',serif;letter-spacing:-0.02em;color:#ffffff;margin:0 0 14px;">${escapeHtml(options.title)}</div>
                  <div style="width:88px;height:4px;background:#e8304a;border-radius:999px;margin:0 0 18px;"></div>
                  <p style="margin:0;color:rgba(255,255,255,0.82);font:400 16px/1.7 'DM Sans',Arial,sans-serif;">${escapeHtml(options.intro)}</p>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:36px 40px 20px;">
                ${options.accentLabel ? `<div style="display:inline-block;margin:0 0 22px;padding:8px 12px;border:1px solid rgba(200,16,46,0.18);background:#faf9f7;border-radius:999px;font:700 12px/1 'DM Sans',Arial,sans-serif;letter-spacing:0.12em;text-transform:uppercase;color:#c8102e;">${escapeHtml(options.accentLabel)}</div>` : ""}
                ${options.bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:0 40px 36px;">
                <div style="border-top:1px solid #d1cfc9;padding-top:18px;color:#6b6860;font:400 13px/1.7 'DM Sans',Arial,sans-serif;">
                  Real Talk Summit<br />
                  Family Matters
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

type MailContent = {
  subject: string;
  text: string;
  html: string;
};

function buildTicketCustomerEmail(customerName: string) {
  const firstName = customerName.split(" ")[0] || "there";
  const text = `Hi ${firstName},

We’re excited to let you know that your spot for the Real Talk Summit - Family Matters has been successfully confirmed!

Get ready for a powerful one-day experience filled with real conversations, practical wisdom, and faith-centered insights designed to strengthen families and transform homes.

Event Details:
Date: April 18th
Location: Faith Temple Church of God of Kalamazoo (114 West North Street, Kalamazoo, MI 49007)
Time: Doors open at 10:30 AM, Event starts at 12:00 PM

This year’s theme, "Family Matters," is all about addressing the real challenges families face today and equipping you with the tools to build stronger, healthier, and more united relationships.

What to Expect:
* Inspiring and impactful sessions
* Honest conversations on family, relationships, and faith
* Practical takeaways you can apply immediately
* A welcoming community of like-minded individuals

Important:
Please keep this email as your confirmation. You may be required to present it (or your ticket) at the entrance.

If you have any questions or need assistance, feel free to reply to this email - we’re here to help.

We can’t wait to welcome you!

Warm regards,
The Real Talk Summit Team`;

  return {
    subject: "Your Spot is Confirmed! - Real Talk Summit",
    text,
    html: renderEmailShell({
      eyebrow: "Ticket Confirmation",
      title: "Your Spot Is Confirmed",
      intro:
        "A bold, one-day gathering of real conversations, practical wisdom, and faith-centered insight.",
      accentLabel: "Family Matters",
      bodyHtml: textToHtmlParagraphs(text),
    }),
  } satisfies MailContent;
}

function buildMerchCustomerEmail(options: {
  customerName: string;
  itemSummary: string;
  addressLines: string;
  orderTotal: string;
}) {
  const text = `Hi${options.customerName ? ` ${options.customerName}` : ""},

Thank you for your merch order.

Items:
${options.itemSummary}

Delivery address:
${options.addressLines}

Order total: ${options.orderTotal}

We will follow up when your order ships.

The Real Talk Summit Team`;

  return {
    subject: "Your Real Talk Summit merch order is confirmed",
    text,
    html: renderEmailShell({
      eyebrow: "Merch Confirmation",
      title: "Your Order Is In",
      intro:
        "Your official Real Talk Summit merch purchase has been received and is now being prepared.",
      accentLabel: "Official Merch",
      bodyHtml: textToHtmlParagraphs(text),
    }),
  } satisfies MailContent;
}

function buildTicketAdminEmail(options: {
  customerName: string;
  customerEmail: string;
  itemSummary: string;
  orderTotal: string;
  sessionId: string;
}) {
  const text = `A new ticket order has been received.

Customer: ${options.customerName || "(not provided)"}
Email: ${options.customerEmail || "(not provided)"}

Ticket details:
${options.itemSummary}

Order total: ${options.orderTotal}
Stripe session: ${options.sessionId}`;

  return {
    subject: "New Ticket Purchase Completed",
    text,
    html: renderEmailShell({
      eyebrow: "Admin Alert",
      title: "New Ticket Purchase",
      intro: "A ticket checkout completed successfully.",
      accentLabel: "Internal Notification",
      bodyHtml: textToHtmlParagraphs(text),
    }),
  } satisfies MailContent;
}

function buildSponsorshipCustomerEmail(options: {
  businessName: string;
  tierName: string;
  tierAmount: string;
}) {
  const greeting = options.businessName ? `Hi ${options.businessName},` : "Hi,";
  const text = `${greeting}

Thank you for choosing to sponsor the Real Talk Summit — Family Matters!

We are thrilled to have you on board as a ${options.tierName} sponsor. Your investment of ${options.tierAmount} directly fuels an experience that strengthens families, restores hope, and builds lasting community.

Here's what happens next:

1. Our team will reach out within 1–2 business days to confirm your package details, collect your logo and any materials we need, and answer any questions.
2. You will receive a formal sponsorship agreement outlining all deliverables and timelines.
3. Your brand will be featured across all applicable touchpoints — from social media to the event stage.

Event Details:
Date: April 18th
Location: Faith Temple Church of God of Kalamazoo (114 West North Street, Kalamazoo, MI 49007)
Doors open at 10:30 AM, Event starts at 12:00 PM

If you need anything in the meantime, simply reply to this email. We are grateful for your partnership and excited about what we're building together.

Warm regards,
The Real Talk Summit Team`;

  return {
    subject: `Sponsorship Confirmed — ${options.tierName} | Real Talk Summit`,
    text,
    html: renderEmailShell({
      eyebrow: "Sponsorship Confirmation",
      title: `${options.tierName} Sponsor`,
      intro:
        "Thank you for investing in the Real Talk Summit. Your partnership helps build stronger families and futures.",
      accentLabel: options.tierAmount,
      bodyHtml: textToHtmlParagraphs(text),
    }),
  } satisfies MailContent;
}

function buildSponsorshipAdminEmail(options: {
  businessName: string;
  customerEmail: string;
  tierName: string;
  orderTotal: string;
  message: string;
  sessionId: string;
}) {
  const text = `A new sponsorship payment has been received.

Business: ${options.businessName || "(not provided)"}
Email: ${options.customerEmail || "(not provided)"}

Package: ${options.tierName}
Amount: ${options.orderTotal}

Message / Notes:
${options.message || "(none)"}

Stripe session: ${options.sessionId}`;

  return {
    subject: `New Sponsorship — ${options.tierName}`,
    text,
    html: renderEmailShell({
      eyebrow: "Admin Alert",
      title: "New Sponsorship Received",
      intro: `A ${options.tierName} sponsorship checkout completed successfully.`,
      accentLabel: "Internal Notification",
      bodyHtml: textToHtmlParagraphs(text),
    }),
  } satisfies MailContent;
}

function buildMerchAdminEmail(options: {
  customerName: string;
  customerEmail: string;
  itemSummary: string;
  addressLines: string;
  orderTotal: string;
  sessionId: string;
}) {
  const text = `A new merch order has been received.

Customer: ${options.customerName || "(not provided)"}
Email: ${options.customerEmail || "(not provided)"}

Merch details:
${options.itemSummary}

Delivery address:
${options.addressLines}

Order total: ${options.orderTotal}
Stripe session: ${options.sessionId}`;

  return {
    subject: "New Merch Purchase Completed",
    text,
    html: renderEmailShell({
      eyebrow: "Admin Alert",
      title: "New Merch Purchase",
      intro: "A merch checkout completed successfully.",
      accentLabel: "Internal Notification",
      bodyHtml: textToHtmlParagraphs(text),
    }),
  } satisfies MailContent;
}

// Stripe webhook requires the raw body.
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    if (!webhookSecret) {
      return res.status(500).send("Missing STRIPE_WEBHOOK_SECRET.");
    }

    const signature = req.headers["stripe-signature"];
    if (!signature || Array.isArray(signature)) {
      return res.status(400).send("Missing stripe signature.");
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        webhookSecret,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Webhook error";
      return res.status(400).send(`Webhook Error: ${message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const lineItems = await stripe.checkout.sessions.listLineItems(
        session.id,
        { limit: 10 },
      );
      const customerEmail = session.customer_email ?? "";
      const customerName = session.metadata?.customerName ?? "";
      const itemId = session.metadata?.itemId;
      const size = session.metadata?.size;
      const isTicket = itemId === "ticket";
      const isSponsor = isSponsorship(itemId ?? "");
      const address = parseAddress(session.metadata?.deliveryAddress);
      const addressText = session.metadata?.deliveryAddressText ?? "";
      const sponsorMessage = session.metadata?.message ?? "";
      const businessName = session.metadata?.businessName ?? customerName;
      const orderTotal = formatAmount(
        session.amount_total,
        session.currency ?? "usd",
      );

      const itemSummary = lineItems.data
        .map((item) => {
          const name = item.description ?? "Item";
          const price = formatAmount(
            item.amount_total,
            session.currency ?? "usd",
          );
          const quantity = item.quantity ?? 1;
          const sizePart =
            size && itemId !== "ticket" ? ` (Size: ${size})` : "";
          return `${quantity} x ${name}${sizePart} (${price})`;
        })
        .join("\n");

      const addressLines = formatAddressForEmail({
        structured: address,
        text: addressText || null,
      });

      if (mailer) {
        try {
          if (customerEmail) {
            if (isSponsor) {
              const tierName =
                MERCH_ITEMS[itemId as MerchItemId]?.name ?? itemId ?? "Sponsorship";
              const email = buildSponsorshipCustomerEmail({
                businessName,
                tierName,
                tierAmount: orderTotal,
              });
              await mailer.sendMail({
                from: emailFrom,
                to: customerEmail,
                subject: email.subject,
                text: email.text,
                html: email.html,
              });
            } else if (isTicket) {
              const email = buildTicketCustomerEmail(customerName);
              await mailer.sendMail({
                from: emailFrom,
                to: customerEmail,
                subject: email.subject,
                text: email.text,
                html: email.html,
              });
            } else {
              const email = buildMerchCustomerEmail({
                customerName,
                itemSummary,
                addressLines,
                orderTotal,
              });
              await mailer.sendMail({
                from: emailFrom,
                to: customerEmail,
                subject: email.subject,
                text: email.text,
                html: email.html,
              });
            }
          }

          if (adminEmails.length > 0) {
            let email: MailContent;
            if (isSponsor) {
              const tierName =
                MERCH_ITEMS[itemId as MerchItemId]?.name ?? itemId ?? "Sponsorship";
              email = buildSponsorshipAdminEmail({
                businessName,
                customerEmail,
                tierName,
                orderTotal,
                message: sponsorMessage,
                sessionId: session.id,
              });
            } else if (isTicket) {
              email = buildTicketAdminEmail({
                customerName,
                customerEmail,
                itemSummary,
                orderTotal,
                sessionId: session.id,
              });
            } else {
              email = buildMerchAdminEmail({
                customerName,
                customerEmail,
                itemSummary,
                addressLines,
                orderTotal,
                sessionId: session.id,
              });
            }

            await mailer.sendMail({
              from: emailFrom,
              to: adminEmails,
              subject: email.subject,
              text: email.text,
              html: email.html,
            });
          }
        } catch (error) {
          console.error("Email send failed:", error);
        }
      } else {
        console.warn(
          "Mailer not configured. Skipping confirmation/notification emails.",
        );
      }
    }

    res.json({ received: true });
  },
);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/checkout/create-session", async (req, res) => {
  const body = req.body as CheckoutBody;

  if (!body?.itemId || typeof body.itemId !== "string") {
    return res.status(400).json({ error: "Missing itemId." });
  }
  if (!body.customer?.email) {
    return res.status(400).json({ error: "Missing customer email." });
  }

  const item = MERCH_ITEMS[body.itemId as MerchItemId];
  if (!item) {
    return res.status(400).json({ error: "Invalid itemId." });
  }

  const isTicket = item.id === "ticket";
  const isSponsor = isSponsorship(item.id);
  let unitAmount = item.amount;

  if (!isTicket && !isSponsor) {
    const hasStructuredAddress = Boolean(body.deliveryAddress);
    const hasTextAddress = Boolean(body.deliveryAddressText?.trim());
    if (!hasStructuredAddress && !hasTextAddress) {
      return res.status(400).json({ error: "Missing delivery address." });
    }

    if (hasStructuredAddress) {
      const { line1, city, state, postalCode, country } = body.deliveryAddress!;
      if (!line1 || !city || !state || !postalCode || !country) {
        return res.status(400).json({ error: "Incomplete delivery address." });
      }
    }

    // Price increase for larger sizes
    if (body.size === "2XL" || body.size === "3XL") {
      unitAmount += 300;
    }
  }

  const baseUrl = pickBaseUrl(req.headers.origin);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: unitAmount,
            product_data: {
              name: item.name + (body.size ? ` (Size: ${body.size})` : ""),
              description: item.description,
            },
          },
        },
      ],
      customer_email: body.customer.email,
      metadata: {
        itemId: item.id,
        size: body.size ?? "",
        customerName: body.customer.name ?? "",
        businessName: body.customer.businessName ?? body.customer.name ?? "",
        message: body.message ?? "",
        deliveryAddress: body.deliveryAddress
          ? JSON.stringify(body.deliveryAddress)
          : "",
        deliveryAddressText: body.deliveryAddressText ?? "",
      },
      success_url: `${baseUrl}/?checkout=success`,
      cancel_url: `${baseUrl}/?checkout=cancel`,
    });

    return res.json({ url: session.url });
  } catch (error) {
    console.error("Stripe session error:", error);
    return res.status(500).json({ error: "Unable to create session." });
  }
});

app.listen(PORT, () => {
  console.log(`Merch backend listening on ${PORT}`);
});
