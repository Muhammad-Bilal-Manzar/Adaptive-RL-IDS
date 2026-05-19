from stable_baselines3 import DQN

def build_dqn_agent(env, tb_log_dir='./tb_logs'):
    print("[INFO] Initializing DQN agent...")
    agent = DQN(
        policy='MlpPolicy',
        env=env,
        policy_kwargs=dict(net_arch=[256, 256]),
        buffer_size=100_000,
        batch_size=256,
        learning_starts=1_000,
        train_freq=4,
        learning_rate=1e-4,
        gamma=0.99,
        exploration_fraction=0.30,
        exploration_initial_eps=1.0,
        exploration_final_eps=0.05,
        tensorboard_log=tb_log_dir,
        verbose=1,
        seed=42,
        device='auto'
    )
    return agent

def evaluate_dqn(agent, eval_env):
    print("\n[INFO] Evaluating trained DQN...")
    obs, _ = eval_env.reset(seed=0)
    
    rewards, actions, true_lbls = [], [], []
    while True:
        action, _ = agent.predict(obs, deterministic=True)
        obs, reward, terminated, truncated, info = eval_env.step(int(action))
        
        rewards.append(reward)
        actions.append(int(action))
        true_lbls.append(info['true_label'])
        
        if terminated or truncated:
            break
            
    return rewards, actions, true_lbls