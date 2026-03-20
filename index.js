const admin = require("firebase-admin");
const express = require("express");
const axios = require("axios");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 8080;

// 🔥 IMPORTANTE PARA RENDER
app.set("trust proxy", 1);

app.use(express.json());
app.use(express.static("public"));

// 🔐 Firebase
const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

admin.initializeApp({
  credential: admin.credential.cert(credentials),
});

const db = admin.firestore();

// =========================
// 📧 CONFIG SMTP CORREGIDO
// =========================
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,          // ✅ CAMBIO CLAVE
  secure: false,      // ✅ IMPORTANTE
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

// 🔍 Verificar conexión SMTP
transporter.verify((error, success) => {
  if (error) {
    console.log("❌ Error SMTP:", error);
  } else {
    console.log("✅ SMTP listo para enviar correos");
  }
});

// =========================
// 🚫 RATE LIMIT
// =========================
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

// =========================
// 🔑 HASH TOKEN
// =========================
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// =========================
// 🔵 ROOT
// =========================
app.get("/", (req, res) => {
  res.send("OK");
});

// =========================
// 📩 REQUEST RESET
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

      const expireAt = Date.now() + 1000 * 60 * 15;

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
          <h2>IOT Calidad del Agua</h2>
          <p>Haz clic en el siguiente botón para restablecer tu contraseña:</p>
          
          <a href="${link}" style="
            display:inline-block;
            padding:12px 20px;
            background:#005BBB;
            color:white;
            text-decoration:none;
            border-radius:8px;
          ">
            Cambiar contraseña
          </a>

          <p style="margin-top:15px;">
            Si no solicitaste esto, ignora este correo.
          </p>
        `,
      });

      console.log("📧 Correo enviado a:", email);
    }

    res.json({
      message: "Si el correo existe, recibirás instrucciones.",
    });

  } catch (err) {
    console.error("❌ ERROR RESET:", err);
    res.status(500).send("Error interno");
  }
});

// =========================
// 🌐 VALIDAR TOKEN
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
// 🔑 CAMBIAR PASSWORD
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

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.collection("users").doc(data.userId).update({
      password: hashedPassword,
      lastUpdated: new Date(),
    });

    await doc.ref.delete();

    console.log("🔐 Contraseña actualizada");

    res.json({ ok: true });

  } catch (err) {
    console.error("❌ ERROR UPDATE:", err);
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
  } catch {}
}, 300000);

// =========================
// 🧹 LIMPIEZA TOKENS
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

  console.log("🧹 Tokens expirados eliminados");

}, 600000);

// =========================
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});