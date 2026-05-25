import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import numpy as np
import joblib
import asyncio
import json
import warnings
import torch
from stable_baselines3 import DQN

from environment import NetworkIDSEnv

warnings.filterwarnings("ignore")

BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_DIR = BASE_DIR / 'models'
DATA_DIR = BASE_DIR / 'data'

app = FastAPI(title="RL-IDS Backend")

# Allow frontend to communicate with this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- GLOBAL ARTIFACTS ---
scaler = None
dqn_agent = None
X_raw = None
y_true = None
FEATURE_COLS = None

@app.on_event("startup")
async def load_artifacts():
    global scaler, dqn_agent, X_raw, y_true, FEATURE_COLS
    print("[INFO] Loading ML Artifacts into memory...")
    try:
        scaler_path = MODEL_DIR / 'ids_minmax_scaler.pkl'
        dqn_path = MODEL_DIR / 'dqn_ids_model.zip'

        scaler = joblib.load(scaler_path)
        dqn_agent = DQN.load(dqn_path)

        data_file = DATA_DIR / 'test_traffic.csv'
        if not data_file.exists():
            data_file = DATA_DIR / 'cic_ids_clean.csv'
            print(f"[WARN] data/test_traffic.csv not found, falling back to {data_file}")

        df = pd.read_csv(data_file)
        FEATURE_COLS = [c for c in df.columns if c != 'Label']
        X_raw = df[FEATURE_COLS].values.astype(np.float32)
        y_true = df['Label'].values
        print("[INFO] Backend ready. Awaiting WebSocket connections.")
    except Exception as e:
        print(f"[ERROR] Failed to load artifacts: {e}")

# --- WEBSOCKET ENDPOINT (LIVE STREAM) ---
@app.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket):
    await websocket.accept()

    current_idx = 0
    simulating = False
    evasion_attack = False
    speed = 0.1

    try:
        while True:
            # 1. Listen for commands from the frontend (non-blocking)
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=0.01)
                command = json.loads(data)

                if command.get("action") == "start":
                    simulating = True
                elif command.get("action") == "stop":
                    simulating = False
                elif command.get("action") == "reset":
                    simulating = False
                    current_idx = 0
                elif command.get("action") == "toggle_evasion":
                    evasion_attack = command.get("value", False)
                elif command.get("action") == "set_speed":
                    speed = float(command.get("value", 0.1))
            except asyncio.TimeoutError:
                pass

            # 2. Process and Stream Data if active
            if simulating and current_idx < len(X_raw):
                features = X_raw[current_idx].copy()
                actual = int(y_true[current_idx])

                if evasion_attack and actual == 1:
                    noise = np.random.uniform(-0.5, 0.5, size=features.shape)
                    features = np.clip(features + noise, 0.0, 1.0).astype(np.float32)

                # --- DQN INFERENCE (SOFTMAX & THRESHOLD) ---
                # Extract raw Q-values from the DQN's neural network using PyTorch
                obs_tensor = torch.tensor(features.reshape(1, -1)).to(dqn_agent.device)
                with torch.no_grad():
                    q_values = dqn_agent.q_net(obs_tensor).cpu().numpy()[0]
                
                # Convert raw Q-values to percentage probabilities (Softmax)
                exp_q = np.exp(q_values - np.max(q_values))
                probabilities = exp_q / np.sum(exp_q)
                
                # Identify the AI's intended action and its confidence
                dqn_action = int(np.argmax(probabilities))
                confidence = float(np.max(probabilities))
                
                # Human-in-the-Loop Override Threshold (85%)
                human_intervention = False
                if confidence < 0.85:
                    human_intervention = True
                    if dqn_action == NetworkIDSEnv.ACTION_BLOCK:   # Wanted to Block -> Reroute to Inspect
                        dqn_action = NetworkIDSEnv.ACTION_INSPECT
                    elif dqn_action == NetworkIDSEnv.ACTION_ALLOW: # Wanted to Allow -> Reroute to Flag
                        dqn_action = NetworkIDSEnv.ACTION_FLAG
                
                defensive = dqn_action != NetworkIDSEnv.ACTION_ALLOW

                # XAI Diagnostics
                explanation = []
                if dqn_action in [NetworkIDSEnv.ACTION_BLOCK, NetworkIDSEnv.ACTION_INSPECT] and actual == 1:
                    top_idx = np.argsort(features)[-5:]
                    explanation = [
                        {"feature": FEATURE_COLS[idx], "value": float(features[idx])}
                        for idx in top_idx[::-1]
                    ]

                payload = {
                    "packet_id": current_idx,
                    "actual_label": actual,
                    "predictions": {
                        "dqn": {
                            "action": dqn_action,
                            "defensive": defensive,
                            "confidence": round(confidence * 100, 2), # e.g., 92.45
                            "human_intervention": human_intervention,
                            "explanation": explanation,
                        },
                    },
                    "status": {
                        "streaming": True,
                        "evasion_attack": evasion_attack,
                        "packet_count": len(X_raw),
                    },
                }

                await websocket.send_json(payload)
                current_idx += 1

                if current_idx >= len(X_raw):
                    simulating = False
                    payload["status"]["streaming"] = False
                    payload["status"]["done"] = True
                    await websocket.send_json(payload)

                await asyncio.sleep(speed)

    except WebSocketDisconnect:
        print("[INFO] Client disconnected from stream.")