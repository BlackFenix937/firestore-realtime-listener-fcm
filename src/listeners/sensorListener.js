const { calcularAmonioEstimado } = require("../services/amonioService");
const { enviarNotificacion } = require("../services/notificationService");

let iniciado = false;

function initSensorListener(db) {
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
        const tokens = usersSnap.docs.flatMap(
          (doc) => doc.data().fcmTokens || []
        );

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
            estanqueId,
            oxigeno: oxigeno.toString(),
            ph: ph.toString(),
            temperatura: temperatura.toString(),
            solidos: solidos.toString(),
            turbidez: turbidez.toString(),
            amonio: amonio.toFixed(3),
          },
          android: { priority: "high" },
        };

        await enviarNotificacion(tokens, payload);

        console.log("📲 Notificaciones enviadas");
      });
    });
}

module.exports = initSensorListener;