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
} as const;

type MerchItemId = keyof typeof MERCH_ITEMS;

type CheckoutBody = {
  itemId: string;
  customer: {
    email: string;
    name?: string;
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
      const isTicket = itemId === "ticket";
      const address = parseAddress(session.metadata?.deliveryAddress);
      const addressText = session.metadata?.deliveryAddressText ?? "";
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
          return `${quantity} x ${name} (${price})`;
        })
        .join("\n");

      const addressLines = formatAddressForEmail({
        structured: address,
        text: addressText || null,
      });

      if (mailer) {
        try {
          if (customerEmail) {
            if (isTicket) {
              const firstName = customerName.split(" ")[0] || "there";
              await mailer.sendMail({
                from: emailFrom,
                to: customerEmail,
                subject: "Your Spot is Confirmed! — Real Talk Summit",
                text: `Hi ${firstName},

We’re excited to let you know that your spot for the Real Talk Summit – Family Matters has been successfully confirmed!

Get ready for a powerful one-day experience filled with real conversations, practical wisdom, and faith-centered insights designed to strengthen families and transform homes.

Event Details:
Date: April 18th
Location: Faith Temple Church of God of Kalamazoo (114 West North Street, Kalamazoo, MI 49007)
Time: Doors open at 10:30 AM, Event starts at 12:00 PM

This year’s theme, “Family Matters,” is all about addressing the real challenges families face today and equipping you with the tools to build stronger, healthier, and more united relationships.

What to Expect:
* Inspiring and impactful sessions
* Honest conversations on family, relationships, and faith
* Practical takeaways you can apply immediately
* A welcoming community of like-minded individuals

Important:
Please keep this email as your confirmation. You may be required to present it (or your ticket) at the entrance.

If you have any questions or need assistance, feel free to reply to this email—we’re here to help.

We can’t wait to welcome you!

Warm regards,
The Real Talk Summit Team`,
              });
            } else {
              await mailer.sendMail({
                from: emailFrom,
                to: customerEmail,
                subject: "Your Real Talk Summit merch order is confirmed",
                text: `Hi${
                  customerName ? ` ${customerName}` : ""
                },\n\nThank you for your order!\n\nItems:\n${itemSummary}\n\nDelivery address:\n${addressLines}\n\nOrder total: ${orderTotal}\n\nWe will follow up when your order ships.`,
              });
            }
          }

          if (adminEmails.length > 0) {
            const subject = isTicket
              ? "New Ticket Purchase Completed"
              : "New Merch Purchase Completed";
            const detailLabel = isTicket ? "Ticket Info" : "Merch Info";

            await mailer.sendMail({
              from: emailFrom,
              to: adminEmails,
              subject: subject,
              text: `New ${
                isTicket ? "ticket" : "merch"
              } order received.\n\nCustomer: ${
                customerName || "(not provided)"
              }\nEmail: ${
                customerEmail || "(not provided)"
              }\n\n${detailLabel}:\n${itemSummary}${
                isTicket ? "" : `\n\nDelivery address:\n${addressLines}`
              }\n\nOrder total: ${orderTotal}\nStripe session: ${session.id}`,
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

function isAllowedOrigin(origin?: string) {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  if (isDev) {
    if (origin.startsWith("http://localhost:")) return true;
    if (origin.startsWith("http://127.0.0.1:")) return true;
  }
  return false;
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
  }),
);
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

  if (!isTicket) {
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
            unit_amount: item.amount,
            product_data: {
              name: item.name,
              description: item.description,
            },
          },
        },
      ],
      customer_email: body.customer.email,
      metadata: {
        itemId: item.id,
        customerName: body.customer.name ?? "",
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
