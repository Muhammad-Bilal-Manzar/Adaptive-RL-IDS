def simulate_snort_rule(features):
    """
    Simulates a static, heuristic-based Intrusion Detection System (like Snort).
    
    Rule: If Flow Duration (features[1]) or Fwd Packet Length Max (features[4]) 
    exceed predefined thresholds (0.5 on the MinMax scale), flag as an attack.
    
    Returns:
        1 for Attack, 0 for Benign
    """
    flow_duration = features[1]
    fwd_packet_length_max = features[4]
    
    if flow_duration > 0.5 or fwd_packet_length_max > 0.5:
        return 1
    else:
        return 0