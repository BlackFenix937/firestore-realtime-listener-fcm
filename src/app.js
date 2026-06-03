const express = require("express");
const { initFirebase } = require("./config/firebase");
const initSensorListener = require("./listeners/sensorListener");
const startKeepAlive = require("./services/keepAliveService");

const app = express();
const PORT = process.env.PORT || 8080;

app.set("trust proxy", 1);
app.use(express.json());
app.use(express.static("public"));

const db = initFirebase();

// Root
app.get("/", (req, res) => {
  res.send("Servidor activo 🚀");
});

// Iniciar procesos
initSensorListener(db);
startKeepAlive();

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});