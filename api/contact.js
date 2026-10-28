const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SITE_URL = "https://www.jsaexpertise.com";

const trim = (v) => (typeof v === "string" ? v.trim() : "");
const court = (v, max = 300) => trim(v).slice(0, max);
const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Lien cliquable vers une page du site (chemin commençant par "/"), sinon texte brut.
const lienPage = (chemin, libelle) => {
  if (!chemin) return "";
  const texte = escapeHtml(libelle || chemin);
  return /^\/[^\s]*$/.test(chemin)
    ? `<a href="${escapeHtml(SITE_URL + chemin)}">${texte}</a>`
    : texte;
};

// Bloc « Origine de la demande » (champs envoyés par le site, tous facultatifs).
function blocOrigine(o) {
  const lignes = [];
  if (o.formulaire) lignes.push(`<p><strong>Formulaire :</strong> ${escapeHtml(o.formulaire)}</p>`);
  if (o.page) {
    const titre = o.titrePage ? ` (${escapeHtml(o.titrePage)})` : "";
    lignes.push(`<p><strong>Page :</strong> ${lienPage(o.page)}${titre}</p>`);
  }
  if (o.arrivee) lignes.push(`<p><strong>Page d'arrivée sur le site :</strong> ${lienPage(o.arrivee)}</p>`);
  if (o.provenance) lignes.push(`<p><strong>Venu de :</strong> ${escapeHtml(o.provenance)}</p>`);
  if (o.campagne) lignes.push(`<p><strong>Campagne :</strong> ${escapeHtml(o.campagne)}</p>`);
  if (!lignes.length) return "";
  return `<hr/><h3>Origine de la demande</h3>${lignes.join("\n        ")}`;
}

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
  const origine = {
    formulaire: court(body.formulaire, 120),
    page: court(body.page),
    titrePage: court(body.titrePage, 200),
    arrivee: court(body.arrivee),
    provenance: court(body.provenance, 120),
    campagne: court(body.campagne, 200),
  };

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
      subject: `Nouvelle demande de contact : ${nom}${origine.page ? ` (page ${origine.page})` : ""}`,
      html: `<h2>Nouveau message reçu</h2>
        <p><strong>Nom :</strong> ${escapeHtml(nom)}</p>
        <p><strong>Email :</strong> ${escapeHtml(email)}</p>
        <p><strong>Téléphone :</strong> ${escapeHtml(telephone) || "Non renseigné"}</p>
        <p><strong>Statut :</strong> ${escapeHtml(statut) || "Non renseigné"}</p>
        <p><strong>Message :</strong><br/>${escapeHtml(message).replace(/\n/g, "<br/>")}</p>
        ${blocOrigine(origine)}`,
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
