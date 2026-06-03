const axios = require("axios");

function startKeepAlive() {
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
}

module.exports = startKeepAlive;