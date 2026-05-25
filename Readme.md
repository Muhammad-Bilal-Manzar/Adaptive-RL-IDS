# Adaptive RL Intrusion Detection System

This repository contains an adaptive intrusion detection system (IDS) built with reinforcement learning. It includes data preprocessing, model training, and anfrontend interface for experiment visualization.

## What’s Included

- `backend/` - Python modules for environment setup, preprocessing, DQN agent training, and utilities.
- `frontend/` - Simple web interface files for demo or visualization.
- `data/` - Test traffic data and raw dataset storage.
- `models/` - Saved model artifacts and checkpoints.
- `notebooks/` - Jupyter notebooks for analysis, experiments, and training workflows.
- `results/` - Evaluation outputs such as charts and summaries.

## Key Components

- `backend/environment.py` - custom IDS environment definition.
- `backend/preprocess_data.py` - data cleaning, feature preparation, and scaling.
- `backend/dqn_agent.py` - deep Q-learning agent implementation.
- `backend/train.py` - training orchestration for baseline and RL agents.
- `backend/main.py` - entry point for running experiments or evaluation.

## Setup

1. Create and activate a Python virtual environment.

```powershell
cd d:\RL\adaptive-rl-ids
python -m venv venv
.\venv\Scripts\Activate.ps1
```

2. Install dependencies.

```powershell
pip install -r requirements.txt
```

## Usage

### Run training

```powershell
python backend\train.py
```

### Run the main script

```powershell
python backend\main.py
```

### Explore notebooks

Open the notebooks in `notebooks/` for step-by-step experiments and model evaluation.

## Notes

- Avoid committing large generated artifacts under `models/` and `results/` unless required.
- Keep the repository focused on code, analysis, and reproducible workflows.

## Recommended Commit Workflow

1. Add project structure and documentation.
2. Add preprocessing and utility code.
3. Add models and training logic.
4. Add frontend and notebooks.

---

This repository is designed for academic experimentation with adaptive RL-based intrusion detection.
