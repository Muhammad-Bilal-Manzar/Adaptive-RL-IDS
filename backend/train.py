import pandas as pd
from sklearn.model_selection import train_test_split
from stable_baselines3.common.monitor import Monitor

# Import your custom modules
from preprocess_data import load_and_preprocess_data
from environment import NetworkIDSEnv
from baseline_rf import train_and_evaluate_rf
from dqn_agent import build_dqn_agent, evaluate_dqn
from utils import plot_rf_results, plot_dqn_results

def run_training_pipeline():
    # 1. Load and Clean Data
    print("--- Phase 1: Data Preprocessing ---")
    data, feature_cols, scaler = load_and_preprocess_data(data_dir='/content/cicids2017', sample_rows=100_000)
    
    # 2. Split Data & Export for FastAPI
    print("\n--- Phase 2: Train/Test Split ---")
    train_data, eval_data = train_test_split(data, test_size=0.20, random_state=42, stratify=data['Label'])
    train_data = train_data.reset_index(drop=True)
    eval_data = eval_data.reset_index(drop=True)
    
    print("[INFO] Exporting test_traffic.csv for live FastAPI dashboard...")
    test_traffic = eval_data.sample(n=2000, random_state=42).reset_index(drop=True)
    test_traffic.to_csv('test_traffic.csv', index=False)
    
    # Extract NumPy arrays for Scikit-Learn
    X_train = train_data[feature_cols].values
    y_train = train_data['Label'].values
    X_test = eval_data[feature_cols].values
    y_test = eval_data['Label'].values
    
    # 3. Train Random Forest Baseline
    print("\n--- Phase 3: Random Forest Baseline ---")
    rf_model = train_and_evaluate_rf(X_train, X_test, y_train, y_test, save_path='ids_rf_baseline.pkl')
    
    # Plot RF results
    y_pred = rf_model.predict(X_test)
    plot_rf_results(y_test, y_pred, rf_model, feature_cols, save_path='rf_evaluation.png')
    
    # 4. Train Deep Q-Network
    print("\n--- Phase 4: DQN Training ---")
    train_env = Monitor(NetworkIDSEnv(train_data, feature_cols))
    eval_env = Monitor(NetworkIDSEnv(eval_data, feature_cols))
    
    dqn_agent = build_dqn_agent(train_env)
    
    print("[INFO] Starting RL training (50,000 steps)...")
    dqn_agent.learn(total_timesteps=50_000, tb_log_name="dqn_ids", progress_bar=True)
    dqn_agent.save('dqn_ids_model')
    print("[INFO] DQN Agent saved to dqn_ids_model.zip")
    
    # 5. Evaluate and Plot DQN
    print("\n--- Phase 5: Final Evaluation ---")
    rewards, actions, true_lbls = evaluate_dqn(dqn_agent, eval_env)
    plot_dqn_results(rewards, actions, save_path='dqn_evaluation.png')
    print("\n[SUCCESS] Full training pipeline completed successfully.")

if __name__ == "__main__":
    run_training_pipeline()