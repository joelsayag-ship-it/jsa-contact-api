export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { nom, email, telephone, statut, message } = req.body;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "JSA Expertise <onboarding@resend.dev>",
      to: ["joel.sayag@jsaexpertise.com"],
      subject: `Nouvelle demande de contact — ${nom}`,
      html: `<h2>Nouveau message reçu</h2>
        <p><strong>Nom :</strong> ${nom}</p>
        <p><strong>Email :</strong> ${email}</p>
        <p><strong>Téléphone :</strong> ${telephone || "Non renseigné"}</p>
        <p><strong>Statut :</strong> ${statut}</p>
        <p><strong>Message :</strong><br/>${message}</p>`,
    }),
  });

  if (!response.ok) return res.status(500).json({ error: "Erreur envoi mail" });

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "JSA Expertise <onboarding@resend.dev>",
      to: [email],
      subject: "Votre demande a bien été reçue — JSA Expertise",
      html: `<h2>Bonjour ${nom},</h2>
        <p>Merci pour votre message. Je vous réponds sous 24h.</p>
        <p>À très bientôt,<br/>Joël Sayag<br/>JSA Expertise</p>`,
    }),
  });

  return res.status(200).json({ success: true });
}
