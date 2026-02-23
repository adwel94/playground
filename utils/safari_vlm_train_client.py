"""Safari VLM 학습 Pod 런치 클라이언트.

serverless-mlops medical_llm_train_client.py 패턴:
파라미터를 flat env vars dict로 변환 → runpod_client.create() 호출.
"""

import os

from utils.runpod_client import GPUType, create


def launch_training_pod(
    hf_dataset_repo: str = "adwel94/vision-safari-dataset",
    hf_output_repo: str = "adwel94/vision-safari-agent-lora",
    hf_output_branch: str = "main",
    hf_token: str = "",
    model_id: str = "Qwen/Qwen3-VL-2B-Thinking",
    lora_r: int = 16,
    lora_alpha: int = 32,
    lora_dropout: float = 0.05,
    lora_target_modules: str = "q_proj,k_proj,v_proj,o_proj,gate_proj,up_proj,down_proj",
    per_device_train_batch_size: int = 2,
    gradient_accumulation_steps: int = 4,
    learning_rate: float = 2e-4,
    num_train_epochs: int = 3,
    bf16: bool = True,
    max_seq_length: int = 8192,
    gpu_type: GPUType = GPUType.NVIDIA_L40S,
    gpu_count: int = 1,
    volume: int = 100,
    image_name: str = "adwel94/safari-vlm-train:latest",
    prefect_api_url: str = "",
    prefect_api_key: str = "",
    safari_webhook_url: str = "",
    wandb_project: str = "",
    wandb_entity: str = "",
    wandb_api_key: str = "",
) -> str:
    """학습 Pod을 생성하고 pod_id를 반환한다."""
    env = {
        "HF_DATASET_REPO": hf_dataset_repo,
        "HF_OUTPUT_REPO": hf_output_repo,
        "HF_OUTPUT_BRANCH": hf_output_branch,
        "HF_TOKEN": hf_token or os.getenv("HF_TOKEN", ""),
        "RUNPOD_API_KEY": os.getenv("RUNPOD_API_KEY", ""),
        "MODEL_ID": model_id,
        "LORA_R": str(lora_r),
        "LORA_ALPHA": str(lora_alpha),
        "LORA_DROPOUT": str(lora_dropout),
        "LORA_TARGET_MODULES": lora_target_modules,
        "PER_DEVICE_TRAIN_BATCH_SIZE": str(per_device_train_batch_size),
        "GRADIENT_ACCUMULATION_STEPS": str(gradient_accumulation_steps),
        "LEARNING_RATE": str(learning_rate),
        "NUM_TRAIN_EPOCHS": str(num_train_epochs),
        "BF16": str(bf16),
        "MAX_SEQ_LENGTH": str(max_seq_length),
        "PREFECT_API_URL": prefect_api_url or os.getenv("PREFECT_API_URL", ""),
        "PREFECT_API_KEY": prefect_api_key or os.getenv("PREFECT_API_KEY", ""),
        "SAFARI_WEBHOOK_URL": safari_webhook_url or os.getenv("SAFARI_WEBHOOK_URL", ""),
        "WANDB_PROJECT": wandb_project or os.getenv("WANDB_PROJECT", ""),
        "WANDB_ENTITY": wandb_entity or os.getenv("WANDB_ENTITY", ""),
        "WANDB_API_KEY": wandb_api_key or os.getenv("WANDB_API_KEY", ""),
    }
    return create(
        name="safari-vlm-train",
        env=env,
        gpu_id=gpu_type,
        gpu_count=gpu_count,
        volume=volume,
        image_name=image_name,
    )
