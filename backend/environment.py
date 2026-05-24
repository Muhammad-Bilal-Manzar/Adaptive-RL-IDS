import gymnasium as gym
from gymnasium import spaces
import numpy as np
import pandas as pd


class NetworkIDSEnv(gym.Env):
    metadata = {'render_modes': ['human']}

    # Actions (fixed - correct design)
    ACTION_ALLOW   = 0
    ACTION_FLAG    = 1
    ACTION_BLOCK   = 2
    ACTION_INSPECT = 3

    def __init__(
        self,
        dataframe: pd.DataFrame,
        feature_cols: list,
        label_col: str = 'Label',
        rf_oracle=None,
        max_episode_steps: int = 1000
    ):
        super().__init__()

        # Data
        self.features_mat = dataframe[feature_cols].values.astype(np.float32)
        self.labels_vec = dataframe[label_col].values.astype(int)
        self.n_samples = len(self.features_mat)

        # RF model (oracle)
        self.rf_oracle = rf_oracle

        # Episode control
        self.max_episode_steps = max_episode_steps
        self.steps_in_episode = 0
        self.current_idx = 0
        self._episode_reward = 0.0

        # Action & observation space
        self.action_space = spaces.Discrete(4)

        self.observation_space = spaces.Box(
            low=0.0,
            high=1.0,
            shape=(len(feature_cols),),
            dtype=np.float32
        )

    # ---------------- RESET ----------------
    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)

        if seed is not None:
            np.random.seed(seed)

        # shuffle data each episode
        indices = np.random.permutation(self.n_samples)
        self.features_mat = self.features_mat[indices]
        self.labels_vec = self.labels_vec[indices]

        self.current_idx = 0
        self.steps_in_episode = 0
        self._episode_reward = 0.0

        return self.features_mat[self.current_idx], {}

    # ---------------- STEP ----------------
    def step(self, action: int):

        current_features = self.features_mat[self.current_idx]

        # RF probability (oracle)
        if self.rf_oracle is not None:
            rf_probs = self.rf_oracle.predict_proba(
                current_features.reshape(1, -1)
            )[0]
            attack_prob = float(rf_probs[1])
        else:
            attack_prob = 0.5  # fallback uncertainty

        # reward (NO TRUE LABEL USED)
        reward = self._compute_reward(action, attack_prob)

        self._episode_reward += reward
        self.steps_in_episode += 1
        self.current_idx += 1

        # termination condition
        terminated = (
            self.current_idx >= self.n_samples
            or self.steps_in_episode >= self.max_episode_steps
        )

        # next observation
        if not terminated:
            obs = self.features_mat[self.current_idx]
        else:
            obs = np.zeros(self.observation_space.shape, dtype=np.float32)

        info = {
            "action": action,
            "attack_prob": attack_prob,
            "step_reward": reward,
            "episode_reward": self._episode_reward
        }

        return obs, reward, terminated, False, info

    # ---------------- REWARD FUNCTION ----------------
    @staticmethod
    def _compute_reward(action: int, attack_prob: float) -> float:

        # BLOCK action
        if action == NetworkIDSEnv.ACTION_BLOCK:
            return 50.0 * attack_prob - 5.0 * (1.0 - attack_prob)

        # ALLOW action
        elif action == NetworkIDSEnv.ACTION_ALLOW:
            return 10.0 * (1.0 - attack_prob) - 100.0 * attack_prob

        # INSPECT action
        elif action == NetworkIDSEnv.ACTION_INSPECT:
            return 20.0 * attack_prob - 2.0

        # FLAG action
        elif action == NetworkIDSEnv.ACTION_FLAG:
            return 5.0 * attack_prob - 1.0

        return -1.0