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

const app = express();
app.use(cors());
app.use(express.json());

// ─── CONFIG ────────────────────────────────────────────────────────────────
const PORT = 3000;
const MQTT_BROKER = "mqtt://192.168.1.101"; // same broker the ESP32 uses
const ESP32_IP = "192.168.1.101";           // ESP32 local IP (update after first boot)
const ESP32_PORT = 80;

// ─── MQTT CLIENT ───────────────────────────────────────────────────────────
const mqttClient = mqtt.connect(MQTT_BROKER);

mqttClient.on("connect", () => {
  console.log("✅ Connected to MQTT broker:", MQTT_BROKER);
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
    broker: MQTT_BROKER,
    esp32: ESP32_IP,
    availableActions: Object.keys(TOPIC_MAP),
  });
});

// ─── START SERVER ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Backend running at http://localhost:${PORT}`);
});
