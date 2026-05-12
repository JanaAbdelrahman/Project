/**
 * backend/server.js
 * Node.js + Express backend that bridges the web UI to the ESP32
 * via MQTT. It also proxies the ESP32 web server for IR learning.
 *
 * Dependencies:
 *   npm install express mqtt cors
 *
 * Usage:
 *   node server.js
 */

const express = require("express");
const mqtt = require("mqtt");
const cors = require("cors");
const http = require("http");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// Serve the frontend (index.html is in the same directory as server.js)
app.use(express.static(path.join(__dirname)));

// ─── CONFIG ────────────────────────────────────────────────────────────────
// Railway injects PORT automatically. Fallback to 3000 for local dev.
const PORT = process.env.PORT || 3000;

// HiveMQ Cloud cluster — credentials stored as env vars for security.
// In Railway dashboard set:
//   MQTT_HOST     → 9287c1d4c76744119c5c67c70ef13e15.s1.eu.hivemq.cloud
//   MQTT_PORT     → 8883
//   MQTT_USERNAME → janaa
//   MQTT_PASSWORD → Jana2005
//   ESP32_IP      → (your ESP32 local IP, optional)
const MQTT_HOST     = process.env.MQTT_HOST     || "9287c1d4c76744119c5c67c70ef13e15.s1.eu.hivemq.cloud";
const MQTT_PORT     = process.env.MQTT_PORT     || 8883;
const MQTT_USERNAME = process.env.MQTT_USERNAME || "janaa";
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || "Jana2005";
const ESP32_IP      = process.env.ESP32_IP      || "192.168.1.101";
const ESP32_PORT    = 80;

// ─── MQTT CLIENT ───────────────────────────────────────────────────────────
// HiveMQ Cloud requires TLS (mqtts://) on port 8883
const mqttClient = mqtt.connect(`mqtts://${MQTT_HOST}`, {
  port: Number(MQTT_PORT),
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
  rejectUnauthorized: true,   // enforce valid TLS certificate
});

mqttClient.on("connect", () => {
  console.log("✅ Connected to HiveMQ:", MQTT_HOST);
});

mqttClient.on("error", (err) => {
  console.error("❌ MQTT error:", err.message);
});

// ─── TOPIC MAP ─────────────────────────────────────────────────────────────
// Maps a logical action key to an MQTT topic
const TOPIC_MAP = {
  // TV
  "tv/power":   "home/tv/power",
  "tv/volup":   "home/tv/volup",
  "tv/voldown": "home/tv/voldown",
  "tv/mute":    "home/tv/mute",

  // Fan
  "fan/power":  "home/fan/power",
  "fan/speed1": "home/fan/speed1",
  "fan/speed2": "home/fan/speed2",
  "fan/speed3": "home/fan/speed3",
};

// ─── ROUTES ────────────────────────────────────────────────────────────────

/**
 * POST /api/send
 * Body: { "action": "tv/power" }
 * Publishes the corresponding MQTT topic to trigger the ESP32.
 */
app.post("/api/send", (req, res) => {
  const { action } = req.body;

  if (!action) {
    return res.status(400).json({ error: "Missing 'action' field" });
  }

  const topic = TOPIC_MAP[action];
  if (!topic) {
    return res.status(404).json({ error: `Unknown action: ${action}` });
  }

  mqttClient.publish(topic, "1", (err) => {
    if (err) {
      console.error("Publish error:", err);
      return res.status(500).json({ error: "Failed to publish MQTT message" });
    }
    console.log(`📡 Published → ${topic}`);
    res.json({ success: true, topic });
  });
});

/**
 * GET /api/learn/:button
 * Proxies the request to the ESP32 web server to start IR learning mode.
 * Example: GET /api/learn/FAN_POWER
 */
app.get("/api/learn/:button", (req, res) => {
  const button = req.params.button;
  const path = `/learn/${button}`;

  const options = {
    hostname: ESP32_IP,
    port: ESP32_PORT,
    path,
    method: "GET",
  };

  const proxyReq = http.request(options, (proxyRes) => {
    let data = "";
    proxyRes.on("data", (chunk) => (data += chunk));
    proxyRes.on("end", () => {
      console.log(`🎓 Learning mode started for: ${button}`);
      res.json({ success: true, button, message: `Learning mode started for ${button}` });
    });
  });

  proxyReq.on("error", (err) => {
    console.error("ESP32 proxy error:", err.message);
    res.status(502).json({ error: "Could not reach ESP32", detail: err.message });
  });

  proxyReq.end();
});

/**
 * GET /api/status
 * Returns MQTT connection status and available actions.
 */
app.get("/api/status", (req, res) => {
  res.json({
    mqtt: mqttClient.connected ? "connected" : "disconnected",
    broker: MQTT_HOST,
    esp32: ESP32_IP,
    availableActions: Object.keys(TOPIC_MAP),
  });
});

// ─── START SERVER ──────────────────────────────────────────────────────────
// Listen on 0.0.0.0 so Railway can route traffic to the container
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});
