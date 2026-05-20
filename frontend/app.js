const host = window.location.hostname || "localhost";
const protocol = window.location.protocol === "https:" ? "wss" : "ws";
const socketUrl = `${protocol}://${host}:8000/ws/stream`;

const connectionStatus = document.getElementById("connectionStatus");
const liveFeed = document.getElementById("liveFeed");
const explainFeed = document.getElementById("explainFeed");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resetBtn = document.getElementById("resetBtn");
const speedSlider = document.getElementById("speedSlider");
const speedValue = document.getElementById("speedValue");
const evasionToggle = document.getElementById("evasionToggle");

const metricIds = {
  snortTotal: document.getElementById("snortTotal"),
  snortTP: document.getElementById("snortTP"),
  snortFN: document.getElementById("snortFN"),
  snortFP: document.getElementById("snortFP"),
  rfTotal: document.getElementById("rfTotal"),
  rfTP: document.getElementById("rfTP"),
  rfFN: document.getElementById("rfFN"),
  rfFP: document.getElementById("rfFP"),
  dqnTotal: document.getElementById("dqnTotal"),
  dqnTP: document.getElementById("dqnTP"),
  dqnFN: document.getElementById("dqnFN"),
  dqnFP: document.getElementById("dqnFP"),
};

let socket = null;
let connected = false;
let metrics = {
  snort: { total: 0, tp: 0, fn: 0, fp: 0, tn: 0 },
  rf:    { total: 0, tp: 0, fn: 0, fp: 0, tn: 0 },
  dqn:   { total: 0, tp: 0, fn: 0, fp: 0, tn: 0 },
};

// ── Chart history buffers ──────────────────────────────────────────────────
const MAX_POINTS = 40; // rolling window of packets shown in time-series charts

const chartHistory = {
  labels: [],
  // DQN action counts per packet
  act0: [],
  act1: [],
  act2: [],
  act3: [],
};

// ── Chart colour constants ─────────────────────────────────────────────────
const C = {
  snort: "#6bc7ff",
  rf:    "#5dd17f",
  dqn:   "#ffc56b",
  tp:    "rgba(93,209,127,.75)",
  fn:    "rgba(255,111,111,.75)",
  fp:    "rgba(255,197,107,.75)",
  act0:  "rgba(93,209,127,.75)",
  act1:  "rgba(107,199,255,.65)",
  act2:  "rgba(255,111,111,.75)",
  act3:  "rgba(255,197,107,.7)",
};

const GRID_COLOR = "rgba(255,255,255,.06)";
const TICK_COLOR = "#98a7c5";

// Helper: common axis options
function axisDefaults() {
  return {
    x: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, maxTicksLimit: 8, autoSkip: true } },
    y: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR } },
  };
}

// ── False-positive bar chart ───────────────────────────────────────────────
const fpChart = new Chart(document.getElementById("fpChart"), {
  type: "bar",
  data: {
    labels: ["Snort", "RF", "DQN"],
    datasets: [
      {
        label: "FP rate %",
        data: [0, 0, 0],
        backgroundColor: ["rgba(107,199,255,.7)", "rgba(93,209,127,.7)", "rgba(255,197,107,.7)"],
        borderColor: [C.snort, C.rf, C.dqn],
        borderWidth: 1,
        borderRadius: 6,
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 200 },
    plugins: { legend: { display: false } },
    scales: {
      ...axisDefaults(),
      y: {
        min: 0,
        max: 100,
        grid: { color: GRID_COLOR },
        ticks: { color: TICK_COLOR, callback: (v) => v + "%" },
      },
      x: { grid: { display: false }, ticks: { color: TICK_COLOR } },
    },
  },
});

// ── Donut helpers ──────────────────────────────────────────────────────────
function makeDonut(canvasId) {
  return new Chart(document.getElementById(canvasId), {
    type: "doughnut",
    data: {
      labels: ["TP", "FN", "FP"],
      datasets: [
        {
          data: [0, 0, 0],
          backgroundColor: [C.tp, C.fn, C.fp],
          borderColor: [C.rf, C.act2, C.dqn],
          borderWidth: 1,
          hoverOffset: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",
      animation: { duration: 200 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: { label: (c) => " " + c.label + ": " + c.raw },
        },
      },
    },
  });
}

const snortDonut = makeDonut("snortDonut");
const rfDonut    = makeDonut("rfDonut");
const dqnDonut   = makeDonut("dqnDonut");

// ── DQN action stacked bar chart ───────────────────────────────────────────
const actionChart = new Chart(document.getElementById("actionChart"), {
  type: "bar",
  data: {
    labels: [],
    datasets: [
      { label: "Allow (0)",    data: [], backgroundColor: C.act0, borderColor: C.rf,    borderWidth: 1 },
      { label: "Monitor (1)",  data: [], backgroundColor: C.act1, borderColor: C.snort, borderWidth: 1 },
      { label: "Block (2)",    data: [], backgroundColor: C.act2, borderColor: "#ff6f6f", borderWidth: 1 },
      { label: "Throttle (3)", data: [], backgroundColor: C.act3, borderColor: C.dqn,  borderWidth: 1 },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 150 },
    plugins: { legend: { display: false } },
    scales: {
      x: { stacked: true, grid: { display: false }, ticks: { color: TICK_COLOR, maxTicksLimit: 10, autoSkip: true } },
      y: { stacked: true, grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR } },
    },
  },
});

// ── Chart update utilities ─────────────────────────────────────────────────
function pct(num, den) {
  if (den === 0) return 0;
  return Math.round((num / den) * 100);
}

function pushRolling(arr, val) {
  arr.push(val);
  if (arr.length > MAX_POINTS) arr.shift();
}

function updateCharts(packetId, dqnAction) {
  const s = metrics.snort;
  const r = metrics.rf;
  const d = metrics.dqn;

  // ── Accuracy line chart ──
  const label = "#" + packetId;
  pushRolling(chartHistory.labels, label);

  // ── False-positive bar chart ──
  fpChart.data.datasets[0].data = [
    pct(s.fp, s.total),
    pct(r.fp, r.total),
    pct(d.fp, d.total),
  ];
  fpChart.update();

  // ── Donuts ──
  snortDonut.data.datasets[0].data = [s.tp, s.fn, s.fp];
  rfDonut.data.datasets[0].data    = [r.tp, r.fn, r.fp];
  dqnDonut.data.datasets[0].data   = [d.tp, d.fn, d.fp];
  snortDonut.update();
  rfDonut.update();
  dqnDonut.update();

  // ── DQN action stacked bar ──
  pushRolling(chartHistory.act0, dqnAction === 0 ? 1 : 0);
  pushRolling(chartHistory.act1, dqnAction === 1 ? 1 : 0);
  pushRolling(chartHistory.act2, dqnAction === 2 ? 1 : 0);
  pushRolling(chartHistory.act3, dqnAction === 3 ? 1 : 0);

  actionChart.data.labels              = [...chartHistory.labels];
  actionChart.data.datasets[0].data    = [...chartHistory.act0];
  actionChart.data.datasets[1].data    = [...chartHistory.act1];
  actionChart.data.datasets[2].data    = [...chartHistory.act2];
  actionChart.data.datasets[3].data    = [...chartHistory.act3];
  actionChart.update();
}

function resetCharts() {
  Object.keys(chartHistory).forEach((k) => (chartHistory[k] = []));

  fpChart.data.datasets[0].data = [0, 0, 0];
  fpChart.update();

  [snortDonut, rfDonut, dqnDonut].forEach((c) => {
    c.data.datasets[0].data = [0, 0, 0];
    c.update();
  });

  actionChart.data.labels = [];
  actionChart.data.datasets.forEach((ds) => (ds.data = []));
  actionChart.update();
}

// ── Metrics cards ──────────────────────────────────────────────────────────
function updateMetricsCards() {
  metricIds.snortTotal.textContent = metrics.snort.total;
  metricIds.snortTP.textContent    = metrics.snort.tp;
  metricIds.snortFN.textContent    = metrics.snort.fn;
  metricIds.snortFP.textContent    = metrics.snort.fp;
  metricIds.rfTotal.textContent    = metrics.rf.total;
  metricIds.rfTP.textContent       = metrics.rf.tp;
  metricIds.rfFN.textContent       = metrics.rf.fn;
  metricIds.rfFP.textContent       = metrics.rf.fp;
  metricIds.dqnTotal.textContent   = metrics.dqn.total;
  metricIds.dqnTP.textContent      = metrics.dqn.tp;
  metricIds.dqnFN.textContent      = metrics.dqn.fn;
  metricIds.dqnFP.textContent      = metrics.dqn.fp;
}

function resetMetrics() {
  metrics = {
    snort: { total: 0, tp: 0, fn: 0, fp: 0, tn: 0 },
    rf:    { total: 0, tp: 0, fn: 0, fp: 0, tn: 0 },
    dqn:   { total: 0, tp: 0, fn: 0, fp: 0, tn: 0 },
  };
  updateMetricsCards();
}

// ── WebSocket ──────────────────────────────────────────────────────────────
function setStatus(text, color = "var(--accent)") {
  connectionStatus.textContent = text;
  connectionStatus.style.color = color;
}

function connectWebSocket() {
  if (socket && socket.readyState === WebSocket.OPEN) return;

  socket = new WebSocket(socketUrl);

  socket.addEventListener("open", () => {
    connected = true;
    setStatus("Connected");
    liveFeed.textContent = "Connected to RL-IDS backend. Ready to stream.";
    sendCommand({ action: "stop" });
  });

  socket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      processPayload(payload);
    } catch (error) {
      console.error("Invalid payload:", error);
    }
  });

  socket.addEventListener("close", () => {
    connected = false;
    setStatus("Disconnected", "var(--danger)");
    liveFeed.textContent = "Connection lost. Reconnecting in 3 seconds...";
    setTimeout(connectWebSocket, 3000);
  });

  socket.addEventListener("error", () => {
    setStatus("Connection error", "var(--danger)");
  });
}

function sendCommand(command) {
  if (!connected || !socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(command));
}

// ── Payload processing ─────────────────────────────────────────────────────
function processPayload(payload) {
  const packetId    = payload.packet_id;
  const actualLabel = payload.actual_label;
  const { snort, rf, dqn } = payload.predictions;
  const explanation = dqn.explanation || [];

  // Update counts
  metrics.snort.total += 1;
  metrics.rf.total    += 1;
  metrics.dqn.total   += 1;

  if (snort === 1 && actualLabel === 1) metrics.snort.tp += 1;
  if (snort === 1 && actualLabel === 0) metrics.snort.fp += 1;
  if (snort === 0 && actualLabel === 1) metrics.snort.fn += 1;
  if (snort === 0 && actualLabel === 0) metrics.snort.tn += 1;

  if (rf === 1 && actualLabel === 1) metrics.rf.tp += 1;
  if (rf === 1 && actualLabel === 0) metrics.rf.fp += 1;
  if (rf === 0 && actualLabel === 1) metrics.rf.fn += 1;
  if (rf === 0 && actualLabel === 0) metrics.rf.tn += 1;

  if (dqn.prediction === 1 && actualLabel === 1) metrics.dqn.tp += 1;
  if (dqn.prediction === 1 && actualLabel === 0) metrics.dqn.fp += 1;
  if (dqn.prediction === 0 && actualLabel === 1) metrics.dqn.fn += 1;
  if (dqn.prediction === 0 && actualLabel === 0) metrics.dqn.tn += 1;

  updateMetricsCards();
  updateCharts(packetId, dqn.action);

  // Live feed message
  let dqnMessage = "Processing packet...";
  if (dqn.action === 2 && actualLabel === 1) {
    dqnMessage = `🚨 DQN: Malicious payload blocked! (Packet #${packetId})`;
  } else if (dqn.action === 0 && actualLabel === 0) {
    dqnMessage = `✅ DQN: Normal traffic allowed. (Packet #${packetId})`;
  } else if ([1, 3].includes(dqn.action)) {
    dqnMessage = `⚠️ DQN: Traffic flagged for manual inspection. (Packet #${packetId})`;
  } else {
    dqnMessage = `ℹ️ Processing packet #${packetId}...`;
  }

  liveFeed.innerHTML = `
    <div><strong>Packet #${packetId}</strong></div>
    <div>Actual: <strong>${actualLabel === 1 ? "Malicious" : "Normal"}</strong></div>
    <div>Snort: <strong>${snort === 1 ? "Malicious" : "Normal"}</strong></div>
    <div>Random Forest: <strong>${rf === 1 ? "Malicious" : "Normal"}</strong></div>
    <div>DQN Action: <strong>${dqn.action}</strong> — Prediction: <strong>${dqn.prediction === 1 ? "Malicious" : "Normal"}</strong></div>
    <div style="margin-top:12px;font-weight:600;">${dqnMessage}</div>
  `;

  if (explanation.length > 0) {
    explainFeed.innerHTML =
      `🧠 <strong>Explainability Engine:</strong><br>` +
      explanation.map((item) => `• ${item.feature} (${item.value.toFixed(2)})`).join("<br>");
  } else {
    explainFeed.textContent = "No additional explainability insights for this packet.";
  }
}

// ── Controls ───────────────────────────────────────────────────────────────
startBtn.addEventListener("click", () => sendCommand({ action: "start" }));
pauseBtn.addEventListener("click", () => sendCommand({ action: "stop" }));
resetBtn.addEventListener("click", () => {
  resetMetrics();
  resetCharts();
  liveFeed.textContent    = "Stream reset. Click Start to begin again.";
  explainFeed.textContent = "No insights yet.";
  sendCommand({ action: "reset" });
});

speedSlider.addEventListener("input", () => {
  const value = parseFloat(speedSlider.value).toFixed(2);
  speedValue.textContent = value;
  sendCommand({ action: "set_speed", value: parseFloat(value) });
});

evasionToggle.addEventListener("change", () => {
  sendCommand({ action: "toggle_evasion", value: evasionToggle.checked });
});

connectWebSocket();