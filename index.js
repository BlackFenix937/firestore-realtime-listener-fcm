const admin = require("firebase-admin");
const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 8080;

const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

admin.initializeApp({
  credential: admin.credential.cert(credentials),
});

const db = admin.firestore();
const messaging = admin.messaging();

app.get("/", (req, res) => {
  res.send("Listener activo");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// ---------- PING PARA QUE RENDER NO DUERMA ----------

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

// ---------- CALCULO DE AMONIO ----------

function calcularAmonioEstimado(ph, temperatura, oxigeno, solidos, turbidez) {
  let amonio = 0.01;

  if (ph > 7.5) amonio += 0.005 * (ph - 7.5);
  if (temperatura > 25) amonio += 0.003 * (temperatura - 25);
  if (oxigeno < 5) amonio += 0.005 * (5 - oxigeno);
  if (solidos > 300) amonio += 0.002 * ((solidos - 300) / 100);
  if (turbidez > 10) amonio += 0.001 * (turbidez - 10);

  return Math.min(Math.max(amonio, 0), 1);
}

let iniciado = false;

// ---------- LISTENER FIRESTORE ----------

db.collection("lecturas_sensores")
  .orderBy("timestamp", "desc")
  .limit(1)
  .onSnapshot(async (snapshot) => {

    if (!iniciado) {
      iniciado = true;
      console.log("🔵 Listener iniciado");
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
        ph,
        temperatura,
        oxigeno,
        solidos,
        turbidez
      );

      let alertas = [];

      if (oxigeno < 5 || oxigeno > 8)
        alertas.push(`Oxígeno fuera de rango: ${oxigeno}`);

      if (ph < 6.5 || ph > 7.5)
        alertas.push(`pH fuera de rango: ${ph}`);

      if (temperatura < 20 || temperatura > 25)
        alertas.push(`Temperatura fuera de rango: ${temperatura}`);

      if (solidos > 400)
        alertas.push(`Sólidos disueltos altos: ${solidos}`);

      if (turbidez > 400)
        alertas.push(`Turbidez alta: ${turbidez}`);

      if (amonio > 0.02)
        alertas.push(`Amonio elevado: ${amonio.toFixed(3)}`);

      if (alertas.length === 0) {
        console.log("Valores dentro de rango");
        return;
      }

      // ---------- OBTENER TOKENS ----------

      const usersSnap = await db.collection("users").get();

      const tokens = usersSnap.docs
        .flatMap(doc => doc.data().fcmTokens || []);

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
        android: {
          priority: "high"
        }
      };

      await messaging.sendEachForMulticast({
        tokens: tokens,
        notification: payload.notification,
        data: payload.data,
        android: payload.android
      });

      console.log("📩 Notificaciones enviadas");

    });

  });