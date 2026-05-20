import gymnasium as gym
from gymnasium import spaces
import numpy as np
import pandas as pd

class NetworkIDSEnv(gym.Env):
    metadata = {'render_modes': ['human']}
    
    ACTION_ALLOW   = 0
    ACTION_FLAG    = 1
    ACTION_BLOCK   = 2
    ACTION_INSPECT = 3

    def __init__(self, dataframe: pd.DataFrame, feature_cols: list, label_col: str = 'Label'):
        super().__init__()
        # Pre-convert to NumPy for maximum speed
        self.features_mat = dataframe[feature_cols].values.astype(np.float32)
        self.labels_vec   = dataframe[label_col].values.astype(int)
        self.n_samples    = len(self.labels_vec)
        
        self.current_idx  = 0
        self._episode_reward = 0.0
        
        self.max_episode_steps = 1000
        self.steps_in_episode = 0

        self.action_space = spaces.Discrete(4)
        self.observation_space = spaces.Box(
            low=0.0, high=1.0, shape=(len(feature_cols),), dtype=np.float32
        )

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        if seed is not None:
            np.random.seed(seed)
            
        # Shuffle data indices to prevent order-bias during training
        indices = np.random.permutation(self.n_samples)
        self.features_mat = self.features_mat[indices]
        self.labels_vec   = self.labels_vec[indices]
        
        self.current_idx  = 0
        self.steps_in_episode = 0
        self._episode_reward = 0.0
        return self.features_mat[self.current_idx], {}

    def step(self, action: int):
        true_label = self.labels_vec[self.current_idx]
        reward = self._compute_reward(true_label, action)
        self._episode_reward += reward
        self.steps_in_episode += 1
        
        self.current_idx += 1
        terminated = (
            self.current_idx >= self.n_samples
            or self.steps_in_episode >= self.max_episode_steps
        )
        
        obs = self.features_mat[self.current_idx] if not terminated else np.zeros(self.observation_space.shape, dtype=np.float32)
        info = {
            'true_label': true_label, 
            'action': action, 
            'step_reward': reward, 
            'episode_reward': self._episode_reward
        }
        return obs, reward, terminated, False, info

    @staticmethod
    def _compute_reward(true_label: int, action: int) -> float:
        if true_label == 1 and action == NetworkIDSEnv.ACTION_BLOCK: return 50.0
        elif true_label == 0 and action == NetworkIDSEnv.ACTION_ALLOW: return 10.0
        elif true_label == 0 and action in (NetworkIDSEnv.ACTION_FLAG, NetworkIDSEnv.ACTION_BLOCK): return -5.0
        elif true_label == 1 and action == NetworkIDSEnv.ACTION_ALLOW: return -100.0
        elif true_label == 1 and action == NetworkIDSEnv.ACTION_INSPECT: return 20.0
        else: return -1.0