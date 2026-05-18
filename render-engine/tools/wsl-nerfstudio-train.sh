#!/bin/bash
# WSL nerfstudio training wrapper
# Called from Windows render-engine to perform ns-train, ns-export

set -e

FRAMES_DIR="${1}"
JOB_ID="${2}"
OUTPUT_DIR="${3}"

if [ -z "$FRAMES_DIR" ] || [ -z "$JOB_ID" ] || [ -z "$OUTPUT_DIR" ]; then
    echo "Usage: $0 <frames_dir> <job_id> <output_dir>"
    exit 1
fi

# Convert Windows paths to WSL paths if needed
FRAMES_DIR_WSL="${FRAMES_DIR//\\//}"
FRAMES_DIR_WSL="${FRAMES_DIR_WSL//C:/\/mnt\/c/}"
OUTPUT_DIR_WSL="${OUTPUT_DIR//\\//}"
OUTPUT_DIR_WSL="${OUTPUT_DIR_WSL//C:/\/mnt\/c/}"

NS_ENV_DIR="${HOME}/.nerfstudio-env"
MAMBA_ROOT_PREFIX="${HOME}/.micromamba"
MAMBA_ENV_NAME="nerfstudio"
MAMBA_BIN="${HOME}/.local/bin/micromamba"

ENV_PREFIX=()

env_exec() {
    if [ ${#ENV_PREFIX[@]} -eq 0 ]; then
        "$@"
    else
        "${ENV_PREFIX[@]}" "$@"
    fi
}

setup_micromamba_env() {
    export MAMBA_ROOT_PREFIX
    export PATH="${HOME}/.local/bin:${PATH}"

    if [ ! -x "$MAMBA_BIN" ]; then
        echo "[ns-train:$JOB_ID] Installing micromamba..."
        mkdir -p "${HOME}/.local/bin"
        curl -LfsS -o "$MAMBA_BIN" https://github.com/mamba-org/micromamba-releases/releases/latest/download/micromamba-linux-64
        chmod +x "$MAMBA_BIN"
    fi

    if ! "$MAMBA_BIN" env list | grep -qE "^${MAMBA_ENV_NAME}[[:space:]]"; then
        echo "[ns-train:$JOB_ID] Creating micromamba env (${MAMBA_ENV_NAME})..."
        "$MAMBA_BIN" create -y -n "$MAMBA_ENV_NAME" -c conda-forge python=3.11 pip
    fi

    ENV_PREFIX=("$MAMBA_BIN" run -n "$MAMBA_ENV_NAME")
}

# Recover from partially created environment (missing activate script)
if [ -d "$NS_ENV_DIR" ] && [ ! -f "$NS_ENV_DIR/bin/activate" ]; then
    echo "[ns-train:$JOB_ID] Existing env is broken, recreating..."
    rm -rf "$NS_ENV_DIR"
fi

# Install venv if not exists
if [ ! -d "$NS_ENV_DIR" ]; then
    echo "[ns-train:$JOB_ID] Creating nerfstudio environment..."
    if ! python3 -m venv "$NS_ENV_DIR"; then
        echo "[ns-train:$JOB_ID] python3-venv unavailable, switching to micromamba..."
        setup_micromamba_env
    fi
fi

# Activate venv when available, otherwise micromamba env is already set.
if [ ${#ENV_PREFIX[@]} -eq 0 ]; then
    if [ -f "$NS_ENV_DIR/bin/activate" ]; then
        source "$NS_ENV_DIR/bin/activate"
    else
        echo "[ns-train:$JOB_ID] venv activation missing, switching to micromamba..."
        setup_micromamba_env
    fi
fi

# Install nerfstudio and dependencies once
if ! env_exec ns-train --help >/dev/null 2>&1; then
    echo "[ns-train:$JOB_ID] Installing nerfstudio..."
    env_exec pip install --upgrade pip setuptools wheel
    env_exec pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
    env_exec pip install nerfstudio
    env_exec pip install gsplat
fi

if ! env_exec bash -lc "command -v colmap >/dev/null 2>&1"; then
    echo "[ns-train:$JOB_ID] ERROR: WSL içinde 'colmap' komutu bulunamadı."
    echo "[ns-train:$JOB_ID] Ubuntu içinde şu komutu çalıştır: sudo apt update ; sudo apt install -y colmap"
    exit 1
fi

# Create working directories
NS_DATA_DIR="/tmp/nerfstudio/$JOB_ID/data"
NS_TRAIN_DIR="/tmp/nerfstudio/$JOB_ID/training"
mkdir -p "$NS_DATA_DIR" "$NS_TRAIN_DIR"

# Run ns-process-data
echo "[ns-train:$JOB_ID] Running ns-process-data..."
env_exec ns-process-data images \
    --data "$FRAMES_DIR_WSL" \
    --output-dir "$NS_DATA_DIR" \
    --camera-type "perspective" \
    --sfm-tool "colmap" \
    --matching-method "sequential" \
    2>&1 | tee "/tmp/nerfstudio/$JOB_ID/process.log" || true

# Run ns-train
echo "[ns-train:$JOB_ID] Running ns-train splatfacto..."
env_exec ns-train splatfacto \
    --data "$NS_DATA_DIR" \
    --output-dir "$NS_TRAIN_DIR" \
    --max-num-iterations 30000 \
    --steps-per-eval 1000 \
    --pipeline.model.cull-alpha-thresh=0.005 \
    2>&1 | tee "/tmp/nerfstudio/$JOB_ID/train.log" || true

# Export to PLY
echo "[ns-train:$JOB_ID] Running ns-export..."
CHECKPOINT=$(ls -t "$NS_TRAIN_DIR"/nerfstudio_models/splatfacto/*/nerfstudio_model.ckpt 2>/dev/null | head -1)
if [ -z "$CHECKPOINT" ]; then
    echo "[ns-train:$JOB_ID] ERROR: No checkpoint found"
    exit 1
fi

PLY_FILE="$OUTPUT_DIR_WSL/${JOB_ID}.ply"
mkdir -p "$(dirname "$PLY_FILE")"

env_exec ns-export splat \
    --load-config "$(dirname "$CHECKPOINT")/../config.yml" \
    --output-dir "$OUTPUT_DIR_WSL" \
    2>&1 | tee "/tmp/nerfstudio/$JOB_ID/export.log" || true

# Check output
if [ -f "$PLY_FILE" ]; then
    echo "[ns-train:$JOB_ID] SUCCESS: PLY exported to $PLY_FILE"
    echo "$PLY_FILE"
else
    echo "[ns-train:$JOB_ID] ERROR: PLY export failed"
    exit 1
fi
