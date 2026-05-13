const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const trim = (v) => (typeof v === "string" ? v.trim() : "");
const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function sendEmail(payload) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, body };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body = req.body || {};

  // Honeypot anti-bot : champ caché "website" que seul un bot remplirait.
  // Le frontend doit ajouter <input type="text" name="website" hidden tabindex="-1" autocomplete="off" />.
  if (trim(body.website)) {
    console.warn("[contact] honeypot triggered", {
      ip: req.headers["x-forwarded-for"],
    });
    return res.status(200).json({ success: true });
  }

  const nom = trim(body.nom);
  const email = trim(body.email);
  const telephone = trim(body.telephone);
  const statut = trim(body.statut);
  const message = trim(body.message);

  const missing = [];
  if (!nom) missing.push("nom");
  if (!email) missing.push("email");
  if (!message) missing.push("message");
  if (missing.length) {
    return res.status(400).json({ error: "Champs requis manquants", fields: missing });
  }

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Format d'email invalide" });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error("[contact] RESEND_API_KEY missing");
    return res.status(500).json({ error: "Configuration serveur incomplète" });
  }

  let notif;
  try {
    notif = await sendEmail({
      from: "JSA Expertise <onboarding@resend.dev>",
      to: ["joel.sayag@jsaexpertise.com"],
      reply_to: email,
      subject: `Nouvelle demande de contact — ${nom}`,
      html: `<h2>Nouveau message reçu</h2>
        <p><strong>Nom :</strong> ${escapeHtml(nom)}</p>
        <p><strong>Email :</strong> ${escapeHtml(email)}</p>
        <p><strong>Téléphone :</strong> ${escapeHtml(telephone) || "Non renseigné"}</p>
        <p><strong>Statut :</strong> ${escapeHtml(statut) || "Non renseigné"}</p>
        <p><strong>Message :</strong><br/>${escapeHtml(message).replace(/\n/g, "<br/>")}</p>`,
    });
  } catch (err) {
    console.error("[contact] notification fetch threw", err);
    return res.status(502).json({ error: "Impossible de joindre Resend" });
  }

  if (!notif.ok || !notif.body?.id) {
    console.error("[contact] notification email failed", {
      status: notif.status,
      body: notif.body,
    });
    return res.status(502).json({ error: "Échec de l'envoi du mail", detail: notif.body });
  }

  // Accusé de réception : best-effort, ne fait pas échouer la requête.
  // NOTE: avec le sender sandbox onboarding@resend.dev, Resend refuse les envois
  // vers une adresse autre que celle du compte. L'accusé échouera donc tant
  // qu'un domaine n'est pas vérifié dans Resend.
  try {
    const ack = await sendEmail({
      from: "JSA Expertise <onboarding@resend.dev>",
      to: [email],
      subject: "Votre demande a bien été reçue — JSA Expertise",
      html: `<h2>Bonjour ${escapeHtml(nom)},</h2>
        <p>Merci pour votre message. Je vous réponds sous 24h.</p>
        <p>À très bientôt,<br/>Joël Sayag<br/>JSA Expertise</p>`,
    });
    if (!ack.ok) {
      console.warn("[contact] ack email failed (non-blocking)", {
        status: ack.status,
        body: ack.body,
      });
    }
  } catch (err) {
    console.warn("[contact] ack email threw (non-blocking)", err);
  }

  return res.status(200).json({ success: true, id: notif.body.id });
}
