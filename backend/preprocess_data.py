import os
import glob
import joblib
import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler
import warnings

warnings.filterwarnings('ignore')

def load_and_preprocess_data(data_dir='/content/cicids2017', sample_rows=500_000, random_state=42):
    """
    Loads raw parquet/csv files, cleans them, applies MinMax scaling, 
    and saves the scaler for inference.
    """
    print("[INFO] Loading raw data files...")
    data_files = glob.glob(os.path.join(data_dir, '**/*.parquet'), recursive=True)
    if not data_files:
        data_files = glob.glob(os.path.join(data_dir, '**/*.csv'), recursive=True)

    df_list = []
    for file_path in data_files:
        if file_path.endswith('.parquet'):
            tmp = pd.read_parquet(file_path)
        else:
            tmp = pd.read_csv(file_path, encoding='utf-8', low_memory=False)
        df_list.append(tmp)

    raw_df = pd.concat(df_list, ignore_index=True)
    raw_df.columns = raw_df.columns.str.strip()
    LABEL_COL = ' Label' if ' Label' in raw_df.columns else 'Label'

    # Stratified Sampling
    print(f"[INFO] Sampling {sample_rows} rows...")
    if len(raw_df) > sample_rows:
        df = raw_df.groupby(LABEL_COL, group_keys=False).apply(
            lambda g: g.sample(n=max(1, int(sample_rows * len(g) / len(raw_df))), random_state=random_state)
        ).reset_index(drop=True)
    else:
        df = raw_df.copy()

    del raw_df, df_list

    # --- CLEANING PIPELINE ---
    print("[INFO] Cleaning data and dropping metadata...")
    data = df.copy()
    drop_patterns = ['ip', 'IP', 'timestamp', 'Timestamp', 'time', 'Time', 'src', 'Src', 'dst', 'Dst', 'mac', 'MAC', 'port', 'Port', 'Flow ID', 'flow id']
    cols_to_drop = [col for col in data.columns if any(pat in col for pat in drop_patterns) and col != LABEL_COL]
    data.drop(columns=cols_to_drop, inplace=True, errors='ignore')

    data.replace([np.inf, -np.inf], np.nan, inplace=True)
    data.dropna(inplace=True)
    data.reset_index(drop=True, inplace=True)

    # Binary Encoding
    BENIGN_LABEL = 'BENIGN'
    data['Label'] = data[LABEL_COL].apply(lambda x: 0 if str(x).strip().upper() == BENIGN_LABEL else 1)
    if LABEL_COL != 'Label':
        data.drop(columns=[LABEL_COL], inplace=True)

    FEATURE_COLS = [c for c in data.columns if c != 'Label']
    data[FEATURE_COLS] = data[FEATURE_COLS].apply(pd.to_numeric, errors='coerce')
    data.replace([np.inf, -np.inf], np.nan, inplace=True)
    data.dropna(inplace=True)
    
    # --- SCALING ---
    print("[INFO] Scaling features...")
    scaler = MinMaxScaler()
    data[FEATURE_COLS] = scaler.fit_transform(data[FEATURE_COLS])
    
    # Save the scaler for the Streamlit dashboard
    joblib.dump(scaler, 'ids_minmax_scaler.pkl')
    print("[INFO] Scaler saved to ids_minmax_scaler.pkl")

    return data, FEATURE_COLS, scaler