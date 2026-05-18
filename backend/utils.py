import matplotlib.pyplot as plt
import numpy as np
from sklearn.metrics import confusion_matrix, ConfusionMatrixDisplay

def plot_rf_results(y_test, y_pred, rf_model, feature_cols, save_path='rf_evaluation.png'):
    """Generates the Confusion Matrix and Feature Importance plots for Random Forest."""
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))

    # Confusion Matrix
    cm = confusion_matrix(y_test, y_pred)
    disp = ConfusionMatrixDisplay(confusion_matrix=cm, display_labels=['Benign', 'Attack'])
    disp.plot(ax=axes[0], cmap='Blues', colorbar=False)
    axes[0].set_title('Confusion Matrix — Random Forest', fontsize=13, fontweight='bold')

    # Feature Importances
    importances = rf_model.feature_importances_
    top_n = min(20, len(feature_cols))
    top_idx = np.argsort(importances)[::-1][:top_n]
    
    axes[1].barh(range(top_n), importances[top_idx][::-1], color='steelblue')
    axes[1].set_yticks(range(top_n))
    axes[1].set_yticklabels([feature_cols[i] for i in top_idx][::-1], fontsize=8)
    axes[1].set_title(f'Top {top_n} Feature Importances', fontsize=13, fontweight='bold')

    plt.tight_layout()
    plt.savefig(save_path, dpi=150, bbox_inches='tight')
    print(f"[INFO] RF Plot saved to {save_path}")
    plt.close()

def plot_dqn_results(rewards, actions, save_path='dqn_evaluation.png'):
    """Generates the Cumulative Reward and Action Distribution plots for DQN."""
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))
    
    # Cumulative Reward
    axes[0].plot(np.cumsum(rewards), color='steelblue')
    axes[0].set_title('DQN — Cumulative Reward')
    axes[0].set_xlabel('Steps')
    
    # Action Distribution
    action_counts = [np.sum(np.array(actions) == i) for i in range(4)]
    axes[1].bar(['Allow', 'Flag', 'Block', 'Inspect'], action_counts, color=['#2ecc71','#f39c12','#e74c3c','#9b59b6'])
    axes[1].set_title('DQN — Action Distribution')
    
    plt.tight_layout()
    plt.savefig(save_path, dpi=150, bbox_inches='tight')
    print(f"[INFO] DQN Plot saved to {save_path}")
    plt.close()