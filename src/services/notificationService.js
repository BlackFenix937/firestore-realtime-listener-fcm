const { getMessaging } = require("../config/firebase");

async function enviarNotificacion(tokens, payload) {
  const messaging = getMessaging();

  return messaging.sendEachForMulticast({
    tokens,
    notification: payload.notification,
    data: payload.data,
    android: payload.android,
  });
}

module.exports = { enviarNotificacion };