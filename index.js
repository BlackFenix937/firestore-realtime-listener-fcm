const admin = require("firebase-admin");
const express = require("express");
const axios = require("axios");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static("public"));

// 🔐 Credenciales Firebase
const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

admin.initializeApp({
  credential: admin.credential.cert(credentials),
});

const db = admin.firestore();

// 📧 Configuración correo (GMAIL)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD,
  },
});

// 🚫 Anti-spam
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
});

// 🔑 Hash del token
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// 🔵 Ruta base
app.get("/", (req, res) => {
  res.send("OK");
});

// =========================
// 📩 SOLICITAR RESET
// =========================
app.post("/request-password-reset", limiter, async (req, res) => {
  const { email } = req.body;

  try {
    const userSnap = await db
      .collection("users")
      .where("email", "==", email)
      .limit(1)
      .get();

    if (!userSnap.empty) {
      const userDoc = userSnap.docs[0];

      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashToken(rawToken);

      const expireAt = Date.now() + 1000 * 60 * 15; // 15 min

      await db.collection("password_resets").add({
        userId: userDoc.id,
        tokenHash,
        expireAt,
      });

      const link = `${process.env.RENDER_EXTERNAL_URL}/reset?token=${rawToken}`;

      await transporter.sendMail({
        from: `"IOT Team" <${process.env.SMTP_EMAIL}>`,
        to: email,
        subject: "Restablecer contraseña",
        html: `
          <h3>Restablecer contraseña</h3>
          <p>Haz clic en el siguiente enlace:</p>
          <a href="${link}" style="padding:10px;background:#005BBB;color:white;text-decoration:none;">
            Cambiar contraseña
          </a>
          <p>Si no solicitaste esto, ignora este correo.</p>
        `,
      });

      console.log("📧 Correo enviado");
    }

    // 🔒 NO revela si existe o no
    res.json({ message: "Si el correo existe, recibirás instrucciones." });

  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

// =========================
// 🌐 VALIDAR TOKEN Y MOSTRAR HTML
// =========================
app.get("/reset", async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(403).send("No autorizado");

  const tokenHash = hashToken(token);

  const snap = await db
    .collection("password_resets")
    .where("tokenHash", "==", tokenHash)
    .limit(1)
    .get();

  if (snap.empty) {
    return res.status(403).send("Token inválido");
  }

  res.sendFile(__dirname + "/public/reset.html");
});

// =========================
// 🔑 CAMBIAR CONTRASEÑA
// =========================
app.post("/reset-password", async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).send("Datos inválidos");
  }

  try {
    const tokenHash = hashToken(token);

    const snap = await db
      .collection("password_resets")
      .where("tokenHash", "==", tokenHash)
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(400).send("Token inválido");
    }

    const doc = snap.docs[0];
    const data = doc.data();

    if (Date.now() > data.expireAt) {
      await doc.ref.delete();
      return res.status(400).send("Token expirado");
    }

    // 🔐 Hash contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    await db.collection("users").doc(data.userId).update({
      password: hashedPassword,
      lastUpdated: new Date(),
    });

    // 🧨 eliminar token
    await doc.ref.delete();

    res.json({ ok: true });

  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

// =========================
// 🔁 KEEP ALIVE
// =========================
setInterval(async () => {
  try {
    await axios.get(process.env.RENDER_EXTERNAL_URL);
    console.log("🔁 Ping enviado");
  } catch (e) {}
}, 300000);

// =========================
// 🧹 LIMPIAR TOKENS EXPIRADOS
// =========================
setInterval(async () => {
  const now = Date.now();

  const snap = await db
    .collection("password_resets")
    .where("expireAt", "<", now)
    .get();

  const batch = db.batch();

  snap.forEach(doc => batch.delete(doc.ref));

  await batch.commit();

  console.log("🧹 Tokens limpiados");

}, 600000);

// =========================
app.listen(PORT, () => {
  console.log(`🚀 Servidor en puerto ${PORT}`);
});