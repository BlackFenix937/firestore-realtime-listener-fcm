const admin = require('firebase-admin');

const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

admin.initializeApp({
  credential: admin.credential.cert(credentials),
});

const db = admin.firestore();
const messaging = admin.messaging();

function calcularAmonioEstimado(ph, temperatura, oxigeno, solidos, turbidez) {
  let amonio = 0.01;

  if (ph > 7.5) amonio += 0.005 * (ph - 7.5);
  if (temperatura > 25) amonio += 0.003 * (temperatura - 25);
  if (oxigeno < 5) amonio += 0.005 * (5 - oxigeno);
  if (solidos > 300) amonio += 0.002 * ((solidos - 300) / 100);
  if (turbidez > 10) amonio += 0.001 * (turbidez - 10);

  return Math.min(Math.max(amonio, 0.0), 1.0);
}

console.log('🔔 Escuchando Firestore...');

db.collection('lecturas_sensores').onSnapshot(async snapshot => {
  snapshot.docChanges().forEach(async change => {
    if (change.type === 'added') {
      const data = change.doc.data();
      const id = change.doc.id;
      console.log(`📥 Nueva lectura recibida: ${id}`);

      const { valores_sensores, estanqueId } = data;

      if (!valores_sensores || !estanqueId) return;

      const oxigeno = valores_sensores.oxigeno ?? 0;
      const ph = valores_sensores.ph ?? 0;
      const solidos = valores_sensores.solidos_disueltos ?? 0;
      const temperatura = valores_sensores.temperatura ?? 0;
      const turbidez = valores_sensores.turbidez ?? 0;

      const amonio = calcularAmonioEstimado(ph, temperatura, oxigeno, solidos, turbidez);

      let alertas = [];
      if (oxigeno < 5 || oxigeno > 8) alertas.push(`Oxígeno fuera de rango: ${oxigeno} mg/L`);
      if (ph < 6.5 || ph > 7.5) alertas.push(`pH fuera de rango: ${ph}`);
      if (temperatura < 20 || temperatura > 25) alertas.push(`Temperatura fuera de rango: ${temperatura} °C`);
      if (solidos > 400) alertas.push(`Sólidos disueltos muy altos: ${solidos} ppm`);
      if (turbidez > 400) alertas.push(`Turbidez muy alta: ${turbidez} NTU`);
      if (amonio > 0.02) alertas.push(`Amonio elevado: ${amonio.toFixed(3)} mg/L`);

      if (alertas.length === 0) {
        console.log('✅ Valores dentro de rango, no se envía alerta.');
        return;
      }

      const usersSnap = await db.collection('users').get();
      const tokens = usersSnap.docs
        .map(doc => doc.data().fcmToken)
        .filter(token => !!token);

      if (tokens.length === 0) {
        console.log('⚠️ No hay tokens registrados para enviar notificaciones.');
        return;
      }

      const payload = {
        notification: {
          title: `⚠️ Alerta en ${estanqueId}`,
          body: alertas.join(' | '),
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
      };

      try {
        const response = await messaging.sendEachForMulticast({
          tokens,
          ...payload,
        });
        console.log(`📩 Notificaciones enviadas: ${response.successCount}/${tokens.length}`);
      } catch (error) {
        console.error('❌ Error al enviar FCM:', error);
      }
    }
  });
});
