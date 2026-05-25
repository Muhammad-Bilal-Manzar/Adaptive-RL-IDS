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
  dqnTotal: document.getElementById("dqnTotal"),
  dqnTP: document.getElementById("dqnTP"),
  dqnFN: document.getElementById("dqnFN"),
  dqnFP: document.getElementById("dqnFP"),
  dqnTN: document.getElementById("dqnTN"),
};

let socket = null;
let connected = false;
let metrics = { total: 0, tp: 0, fn: 0, fp: 0, tn: 0 };

const ACTION_NAMES = ["Allow", "Flag", "Block", "Inspect"];

const actionCountEls = [
  document.getElementById("actionCount0"),
  document.getElementById("actionCount1"),
  document.getElementById("actionCount2"),
  document.getElementById("actionCount3"),
];

const actionCounts = [0, 0, 0, 0];

// ── Chart history buffers ──────────────────────────────────────────────────
const MAX_POINTS = 40;

const chartHistory = {
  labels: [],
  act0: [],
  act1: [],
  act2: [],
  act3: [],
};

// ── Chart colour constants ─────────────────────────────────────────────────
const C = {
  accent: "#6bc7ff",
  dqn:    "#ffc56b",
  tp:     "rgba(93,209,127,.75)",
  fn:     "rgba(255,111,111,.75)",
  fp:     "rgba(255,197,107,.75)",
  tn:     "rgba(107,199,255,.75)",
  act0:   "rgba(93,209,127,.75)",
  act1:   "rgba(107,199,255,.65)",
  act2:   "rgba(255,111,111,.75)",
  act3:   "rgba(255,197,107,.7)",
};

const GRID_COLOR = "rgba(255,255,255,.06)";
const TICK_COLOR = "#98a7c5";

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
    labels: ["DQN"],
    datasets: [
      {
        label: "FP rate %",
        data: [0],
        backgroundColor: ["rgba(255,197,107,.7)"],
        borderColor: [C.dqn],
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

const dqnDonut = new Chart(document.getElementById("dqnDonut"), {
  type: "doughnut",
  data: {
    labels: ["TP", "FN", "FP", "TN"],
    datasets: [
      {
        data: [0, 0, 0, 0],
        backgroundColor: [C.tp, C.fn, C.fp, C.tn],
        borderColor: [C.accent, C.act2, C.dqn, C.accent],
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

// ── DQN action stacked bar chart ───────────────────────────────────────────
const actionChart = new Chart(document.getElementById("actionChart"), {
  type: "bar",
  data: {
    labels: [],
    datasets: [
      { label: "Allow (0)",   data: [], backgroundColor: C.act0, borderColor: C.accent, borderWidth: 1 },
      { label: "Flag (1)",    data: [], backgroundColor: C.act1, borderColor: C.accent, borderWidth: 1 },
      { label: "Block (2)",   data: [], backgroundColor: C.act2, borderColor: "#ff6f6f", borderWidth: 1 },
      { label: "Inspect (3)", data: [], backgroundColor: C.act3, borderColor: C.dqn,   borderWidth: 1 },
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

function pct(num, den) {
  if (den === 0) return 0;
  return Math.round((num / den) * 100);
}

function pushRolling(arr, val) {
  arr.push(val);
  if (arr.length > MAX_POINTS) arr.shift();
}

function updateActionCountLabels() {
  actionCountEls.forEach((el, i) => {
    if (el) el.textContent = actionCounts[i];
  });
}

function recordDqnAction(dqnAction) {
  if (dqnAction >= 0 && dqnAction < actionCounts.length) {
    actionCounts[dqnAction] += 1;
    updateActionCountLabels();
  }
}

function resetActionCounts() {
  actionCounts.fill(0);
  updateActionCountLabels();
}

function updateCharts(packetId, dqnAction) {
  const m = metrics;

  const label = "#" + packetId;
  pushRolling(chartHistory.labels, label);

  fpChart.data.datasets[0].data = [pct(m.fp, m.total)];
  fpChart.update();

  dqnDonut.data.datasets[0].data = [m.tp, m.fn, m.fp, m.tn];
  dqnDonut.update();

  recordDqnAction(dqnAction);

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
  resetActionCounts();
  Object.keys(chartHistory).forEach((k) => (chartHistory[k] = []));

  fpChart.data.datasets[0].data = [0];
  fpChart.update();

  dqnDonut.data.datasets[0].data = [0, 0, 0, 0];
  dqnDonut.update();

  actionChart.data.labels = [];
  actionChart.data.datasets.forEach((ds) => (ds.data = []));
  actionChart.update();
}

function updateMetricsCards() {
  metricIds.dqnTotal.textContent = metrics.total;
  metricIds.dqnTP.textContent    = metrics.tp;
  metricIds.dqnFN.textContent    = metrics.fn;
  metricIds.dqnFP.textContent    = metrics.fp;
  metricIds.dqnTN.textContent    = metrics.tn;
}

function resetMetrics() {
  metrics = { total: 0, tp: 0, fn: 0, fp: 0, tn: 0 };
  updateMetricsCards();
}

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

function processPayload(payload) {
  const packetId    = payload.packet_id;
  const actualLabel = payload.actual_label;
  const dqn = payload.predictions.dqn;
  const explanation = dqn.explanation || [];

  const defensive = dqn.defensive ?? dqn.action !== 0;
  const actionName = ACTION_NAMES[dqn.action] ?? String(dqn.action);

  metrics.total += 1;

  if (defensive && actualLabel === 1) metrics.tp += 1;
  if (defensive && actualLabel === 0) metrics.fp += 1;
  if (!defensive && actualLabel === 1) metrics.fn += 1;
  if (!defensive && actualLabel === 0) metrics.tn += 1;

  updateMetricsCards();
  updateCharts(packetId, dqn.action);

  const confidenceBadge = document.getElementById("dqn-confidence");
  if (confidenceBadge && dqn.confidence !== undefined) {
    confidenceBadge.innerText = `Confidence: ${dqn.confidence}%`;
    confidenceBadge.style.color = dqn.confidence < 85 ? "#ffc56b" : "#5dd17f";
  }

  let dqnMessage = "Processing packet...";

  if (dqn.human_intervention) {
    const rerouteDest = dqn.action === 3 ? "Deep Inspection" : "Manual Flag";
    dqnMessage = `<span style="color: #ffc56b;">⚠️ <strong>HUMAN OVERRIDE:</strong> Confidence (${dqn.confidence}%) below threshold. Rerouted to ${rerouteDest}.</span>`;
  } else if (dqn.action === 2 && actualLabel === 1) {
    dqnMessage = `🚨 DQN: Malicious payload blocked! (Packet #${packetId})`;
  } else if (dqn.action === 0 && actualLabel === 0) {
    dqnMessage = `✅ DQN: Normal traffic allowed. (Packet #${packetId})`;
  } else if (dqn.action === 1) {
    dqnMessage = `⚠️ DQN: Traffic flagged for review. (Packet #${packetId})`;
  } else if (dqn.action === 3) {
    dqnMessage = `🔍 DQN: Traffic sent for deep inspection. (Packet #${packetId})`;
  } else if (dqn.action === 0 && actualLabel === 1) {
    dqnMessage = `❌ DQN: Attack allowed through. (Packet #${packetId})`;
  } else {
    dqnMessage = `ℹ️ Processing packet #${packetId}...`;
  }

  liveFeed.innerHTML = `
    <div><strong>Packet #${packetId}</strong></div>
    <div>Actual: <strong>${actualLabel === 1 ? "Malicious" : "Normal"}</strong></div>
    <div>DQN: <strong>${actionName}</strong> (${dqn.action})</div>
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

startBtn.addEventListener("click", () => sendCommand({ action: "start" }));
pauseBtn.addEventListener("click", () => sendCommand({ action: "stop" }));
resetBtn.addEventListener("click", () => {
  resetMetrics();
  resetCharts();
  liveFeed.textContent    = "Stream reset. Click Start to begin again.";
  explainFeed.textContent = "No insights yet.";

  const confidenceBadge = document.getElementById("dqn-confidence");
  if (confidenceBadge) {
    confidenceBadge.innerText = "Confidence: --%";
    confidenceBadge.style.color = "#fff";
  }

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
