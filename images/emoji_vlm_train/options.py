"""Pydantic 설정 모델.

컨트롤러(노트북)에서 Pydantic → flat env vars 변환 → Pod 내부에서 env vars → Pydantic 복원.
serverless-mlops options.py 패턴.
"""

import os

from pydantic import BaseModel


class TrainingOptions(BaseModel):
    model_id: str = "Qwen/Qwen3-VL-2B-Thinking"
    lora_r: int = 16
    lora_alpha: int = 32
    lora_dropout: float = 0.05
    lora_target_modules: str = "q_proj,k_proj,v_proj,o_proj,gate_proj,up_proj,down_proj"
    per_device_train_batch_size: int = 2
    gradient_accumulation_steps: int = 4
    learning_rate: float = 2e-4
    num_train_epochs: int = 3
    bf16: bool = True
    max_seq_length: int = 8192
    output_dir: str = "/workspace/output"

    @classmethod
    def from_env(cls) -> "TrainingOptions":
        kwargs = {}
        for field_name, field_info in cls.model_fields.items():
            env_key = field_name.upper()
            val = os.environ.get(env_key)
            if val is not None:
                kwargs[field_name] = val
        return cls(**kwargs)


class FlowParameters(BaseModel):
    hf_dataset_repo: str = "adwel94/vision-emoji-recognition-v1"
    hf_output_repo: str = "adwel94/vision-emoji-recognition-lora"
    hf_output_branch: str = "main"
    hf_token: str = ""
    runpod_api_key: str = ""
    runpod_pod_id: str = ""
    prefect_api_url: str = ""
    prefect_api_key: str = ""
    safari_webhook_url: str = ""
    wandb_project: str = ""
    wandb_entity: str = ""
    wandb_api_key: str = ""
    training: TrainingOptions = TrainingOptions()

    @classmethod
    def from_env(cls) -> "FlowParameters":
        return cls(
            hf_dataset_repo=os.environ.get("HF_DATASET_REPO", cls.model_fields["hf_dataset_repo"].default),
            hf_output_repo=os.environ.get("HF_OUTPUT_REPO", cls.model_fields["hf_output_repo"].default),
            hf_output_branch=os.environ.get("HF_OUTPUT_BRANCH", cls.model_fields["hf_output_branch"].default),
            hf_token=os.environ.get("HF_TOKEN", ""),
            runpod_api_key=os.environ.get("RUNPOD_API_KEY", ""),
            runpod_pod_id=os.environ.get("RUNPOD_POD_ID", ""),
            prefect_api_url=os.environ.get("PREFECT_API_URL", ""),
            prefect_api_key=os.environ.get("PREFECT_API_KEY", ""),
            safari_webhook_url=os.environ.get("SAFARI_WEBHOOK_URL", ""),
            wandb_project=os.environ.get("WANDB_PROJECT", ""),
            wandb_entity=os.environ.get("WANDB_ENTITY", ""),
            wandb_api_key=os.environ.get("WANDB_API_KEY", ""),
            training=TrainingOptions.from_env(),
        )
