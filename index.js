const admin = require("firebase-admin");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 8080;

const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

admin.initializeApp({
  credential: admin.credential.cert(credentials),
});

const db = admin.firestore();
const messaging = admin.messaging();

// --- Servidor Express simple ---
app.get("/", (req, res) => {
  res.send("Listener is running");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// --- Función para calcular amonio ---
function calcularAmonioEstimado(ph, temperatura, oxigeno, solidos_disueltos, turbidez) {
  let amonio = 0.01;

  if (ph > 7.5) amonio += 0.005 * (ph - 7.5);
  if (temperatura > 25) amonio += 0.003 * (temperatura - 25);
  if (oxigeno < 5) amonio += 0.005 * (5 - oxigeno);
  if (solidos_disueltos > 300) amonio += 0.002 * ((solidos_disueltos - 300) / 100);
  if (turbidez > 10) amonio += 0.001 * (turbidez - 10);

  return Math.min(Math.max(amonio, 0.0), 1.0);
}

// --- Función para enviar notificaciones en lotes ---
const batchSize = 5; // Número de tokens por lote

async function enviarNotificacionesEnLotes(tokens, payload) {
  for (let i = 0; i < tokens.length; i += batchSize) {
    const batchTokens = tokens.slice(i, i + batchSize);
    let attempts = 0;
    let success = false;

    while (attempts < 3 && !success) { // Reintentos (hasta 3 veces)
      try {
        const response = await messaging.sendEachForMulticast({
          tokens: batchTokens,
          ...payload,
        });
        console.log(`📩 Lote de notificaciones enviadas: ${response.successCount}/${batchTokens.length}`);
        success = true;
      } catch (error) {
        attempts++;
        console.error(`❌ Error al enviar FCM (intento ${attempts}): ${error.message}`);
        if (attempts === 3) {
          console.error("⚠️ Se alcanzó el número máximo de intentos para este lote.");
        }
        // Esperar 2 segundos antes de intentar nuevamente
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
}

// --- Listener para Firestore ---
db.collection("lecturas_sensores").onSnapshot(async (snapshot) => {
  snapshot.docChanges().forEach(async (change) => {
    if (change.type === "added") {
      const data = change.doc.data();
      if (!data) return;

      const { valores_sensores, estanqueId } = data;

      const oxigeno = valores_sensores.oxigeno ?? 0;
      const ph = valores_sensores.ph ?? 0;
      const solidos_disueltos = valores_sensores.solidos_disueltos ?? 0;
      const temperatura = valores_sensores.temperatura ?? 0;
      const turbidez = valores_sensores.turbidez ?? 0;

      const amonio = calcularAmonioEstimado(ph, temperatura, oxigeno, solidos_disueltos, turbidez);

      let alertas = [];
      if (oxigeno < 5 || oxigeno > 8) alertas.push(`Oxígeno fuera de rango: ${oxigeno} mg/L`);
      if (ph < 6.5 || ph > 7.5) alertas.push(`pH fuera de rango: ${ph}`);
      if (temperatura < 20 || temperatura > 25) alertas.push(`Temperatura fuera de rango: ${temperatura} °C`);
      if (solidos_disueltos > 400) alertas.push(`Sólidos disueltos muy altos: ${solidos_disueltos} ppm`);
      if (turbidez > 400) alertas.push(`Turbidez muy alta: ${turbidez} NTU`);
      if (amonio > 0.02) alertas.push(`Amonio elevado: ${amonio.toFixed(3)} mg/L`);

      if (alertas.length === 0) {
        console.log("✅ Valores dentro de rango, no se envía alerta.");
        return;
      }

      const usersSnap = await db.collection("users").get();
      const tokens = usersSnap.docs
        .map(doc => doc.data().fcmToken)
        .filter(token => !!token);

      if (tokens.length === 0) {
        console.log("⚠️ No hay tokens registrados para enviar notificaciones.");
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
          solidos_disueltos: solidos_disueltos.toString(),
          turbidez: turbidez.toString(),
          amonio: amonio.toFixed(3),
        }
      };

      try {
        // Intentar enviar las notificaciones en lotes
        await enviarNotificacionesEnLotes(tokens, payload);
      } catch (error) {
        console.error("❌ Timeout alcanzado al intentar enviar las notificaciones.", error);
      }
    }
  });
});
