const admin = require("firebase-admin");
const express = require("express");
const axios = require("axios");
const bcrypt = require("bcryptjs");

const app = express();
const PORT = process.env.PORT || 8080;

app.set("trust proxy", 1);

app.use(express.json());
app.use(express.static("public"));

// 🔐 Firebase Admin
const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

admin.initializeApp({
  credential: admin.credential.cert(credentials),
});

const db = admin.firestore();
const messaging = admin.messaging();

// =========================
// 🔵 ROOT
// =========================
app.get("/", (req, res) => {
  res.send("Servidor activo 🚀");
});

// =========================
// 🌐 VALIDAR LINK FIREBASE
// =========================
app.get("/reset-success", async (req, res) => {
  const { oobCode } = req.query;

  if (!oobCode) return res.send("Código inválido");

  try {
    const response = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=${process.env.FIREBASE_API_KEY}`,
      { oobCode }
    );

    const email = response.data.email;

    console.log("✅ Email verificado:", email);

    res.redirect(`/reset.html?email=${encodeURIComponent(email)}`);

  } catch (err) {
    console.error(err.response?.data || err.message);
    res.send("Código inválido o expirado");
  }
});

// =========================
// 🔑 CAMBIAR PASSWORD (🔥 FIRESTORE + AUTH)
// =========================
app.post("/reset-password", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).send("Datos inválidos");
  }

  try {
    const userSnap = await db
      .collection("users")
      .where("email", "==", email)
      .limit(1)
      .get();

    if (userSnap.empty) {
      return res.status(400).send("Usuario no encontrado");
    }

    const userDoc = userSnap.docs[0];
    const uid = userDoc.id;

    // 🔐 HASH FIRESTORE
    const hashedPassword = await bcrypt.hash(password, 10);

    // =========================
    // 🔥 FIRESTORE
    // =========================
    await userDoc.ref.update({
      password: hashedPassword,
      lastUpdated: new Date(),
    });

    // =========================
    // 🔥 AUTH (CLAVE DEL SISTEMA)
    // =========================
    await admin.auth().updateUser(uid, {
      password: password,
    });

    console.log("🔐 Password actualizado en Auth + Firestore:", email);

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
    const url = process.env.RENDER_EXTERNAL_URL;
    if (url) {
      await axios.get(url);
      console.log("🔁 Ping enviado");
    }
  } catch (error) {
    console.log("Ping error:", error.message);
  }
}, 300000);

// =========================
// 🧠 FUNCIÓN AMONIO
// =========================
function calcularAmonioEstimado(ph, temperatura, oxigeno, solidos, turbidez) {
  let amonio = 0.01;

  if (ph > 7.5) amonio += 0.005 * (ph - 7.5);
  if (temperatura > 25) amonio += 0.003 * (temperatura - 25);
  if (oxigeno < 5) amonio += 0.005 * (5 - oxigeno);
  if (solidos > 300) amonio += 0.002 * ((solidos - 300) / 100);
  if (turbidez > 10) amonio += 0.001 * (turbidez - 10);

  return Math.min(Math.max(amonio, 0), 1);
}

// =========================
// 🔥 LISTENER (SIN CAMBIOS)
// =========================
let iniciado = false;

db.collection("lecturas_sensores")
  .orderBy("timestamp", "desc")
  .limit(1)
  .onSnapshot(async (snapshot) => {

    if (!iniciado) {
      iniciado = true;
      console.log("👂 Listener iniciado");
      return;
    }

    snapshot.docChanges().forEach(async (change) => {

      if (change.type !== "added") return;

      const data = change.doc.data();
      if (!data) return;

      const { valores_sensores, estanqueId } = data;

      const oxigeno = valores_sensores.oxigeno ?? 0;
      const ph = valores_sensores.ph ?? 0;
      const solidos = valores_sensores.solidos_disueltos ?? 0;
      const temperatura = valores_sensores.temperatura ?? 0;
      const turbidez = valores_sensores.turbidez ?? 0;

      const amonio = calcularAmonioEstimado(
        ph, temperatura, oxigeno, solidos, turbidez
      );

      let alertas = [];

      if (oxigeno < 5 || oxigeno > 8)
        alertas.push(`Oxígeno fuera de rango: ${oxigeno}`);

      if (ph < 6.5 || ph > 7.5)
        alertas.push(`pH fuera de rango: ${ph}`);

      if (temperatura < 20 || temperatura > 25)
        alertas.push(`Temperatura fuera de rango: ${temperatura}`);

      if (solidos > 400)
        alertas.push(`Sólidos altos: ${solidos}`);

      if (turbidez > 400)
        alertas.push(`Turbidez alta: ${turbidez}`);

      if (amonio > 0.02)
        alertas.push(`Amonio elevado: ${amonio.toFixed(3)}`);

      if (alertas.length === 0) {
        console.log("Valores normales");
        return;
      }

      const usersSnap = await db.collection("users").get();
      const tokens = usersSnap.docs.flatMap(doc => doc.data().fcmTokens || []);

      if (tokens.length === 0) {
        console.log("No hay tokens");
        return;
      }

      const payload = {
        notification: {
          title: `⚠️ Alerta en ${estanqueId}`,
          body: alertas.join(" | "),
        },
        data: {
          estanqueId: estanqueId,
          oxigeno: oxigeno.toString(),
          ph: ph.toString(),
          temperatura: temperatura.toString(),
          solidos: solidos.toString(),
          turbidez: turbidez.toString(),
          amonio: amonio.toFixed(3),
        },
        android: { priority: "high" }
      };

      await messaging.sendEachForMulticast({
        tokens,
        notification: payload.notification,
        data: payload.data,
        android: payload.android
      });

      console.log("📲 Notificaciones enviadas");
    });
  });

// =========================
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});