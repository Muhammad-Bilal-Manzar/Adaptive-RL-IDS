import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report

def train_and_evaluate_rf(X_train, X_test, y_train, y_test, save_path='ids_rf_baseline.pkl'):
    print("[INFO] Training Random Forest Baseline...")
    
    rf_model = RandomForestClassifier(
        n_estimators=200,
        min_samples_split=5,
        min_samples_leaf=2,
        class_weight='balanced',
        n_jobs=-1,
        random_state=42
    )
    
    rf_model.fit(X_train, y_train)
    print("[INFO] Random Forest training complete.")
    
    y_pred = rf_model.predict(X_test)
    print("\n=== RANDOM FOREST EVALUATION ===")
    print(classification_report(y_test, y_pred, target_names=['Benign (0)', 'Attack (1)'], digits=4))
    
    joblib.dump(rf_model, save_path)
    print(f"[INFO] Model saved to {save_path}")
    
    return rf_model