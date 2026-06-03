const admin = require("firebase-admin");

let db, messaging;

function initFirebase() {
  if (db) return db;

  const credentials = JSON.parse(
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
  );

  admin.initializeApp({
    credential: admin.credential.cert(credentials),
  });

  db = admin.firestore();
  messaging = admin.messaging();

  return db;
}

function getMessaging() {
  return messaging;
}

module.exports = { initFirebase, getMessaging };