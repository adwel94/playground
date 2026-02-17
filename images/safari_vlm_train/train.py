"""Safari VLM bf16 LoRA 학습 Prefect Flow.

5단계 순차 실행. @flow/@task 데코레이터로 Prefect Cloud 모니터링.
finally 블록에서 반드시 자가 종료 (과금 안전).

[1/5] load_config       — FlowParameters.from_env()
[2/5] load_dataset       — HF Hub에서 데이터셋 로드, collate_fn 정의
[3/5] train              — bf16 LoRA + SFTTrainer
[4/5] upload_to_hub      — LoRA 어댑터 HF Hub 업로드
[5/5] self_terminate     — RunPod REST DELETE (finally 블록)
"""

import json
import traceback

import requests
from prefect import flow, task
import torch
from datasets import load_dataset
from huggingface_hub import login
from peft import LoraConfig, TaskType
from PIL import Image
from transformers import (
    AutoProcessor,
    Qwen3VLForConditionalGeneration,
)

from trl import SFTConfig, SFTTrainer

from options import FlowParameters
from utils.discord import send_discord
from monitoring import login_wandb
from hooks import DiscordHook

# ---------------------------------------------------------------------------
# Tool definitions (OpenAI format) — Qwen3-VL chat template에 주입
# ---------------------------------------------------------------------------

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "move",
            "description": "플레이어를 이동시킨다. 최대 4개 행동을 순서대로 실행하며, 각 행동은 방향(UP/DOWN/LEFT/RIGHT)과 칸수(1~3)를 가진다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "actions": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "direction": {"type": "string", "enum": ["UP", "DOWN", "LEFT", "RIGHT"]},
                                "steps": {"type": "integer"},
                            },
                            "required": ["direction", "steps"],
                        },
                    }
                },
                "required": ["actions"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "update_notepad",
            "description": "메모장 전체를 덮어쓴다. 유지할 내용도 포함해서 작성해야 한다. 최대 2000자.",
            "parameters": {
                "type": "object",
                "properties": {"content": {"type": "string"}},
                "required": ["content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "declare_found",
            "description": "특정 타겟을 찾아서 도달했음을 선언한다.",
            "parameters": {
                "type": "object",
                "properties": {"target": {"type": "string"}},
                "required": ["target"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "declare_done",
            "description": "전체 미션이 완료되었음을 선언한다.",
            "parameters": {
                "type": "object",
                "properties": {"reason": {"type": "string"}},
                "required": [],
            },
        },
    },
]


# ---------------------------------------------------------------------------
# [1/5] load_config
# ---------------------------------------------------------------------------

@task(name="load_config", retries=0)
def load_config() -> FlowParameters:
    print("[1/5] load_config — 환경변수에서 설정 로드")
    params = FlowParameters.from_env()
    print(f"  model_id       : {params.training.model_id}")
    print(f"  hf_dataset_repo: {params.hf_dataset_repo}")
    print(f"  hf_output_repo : {params.hf_output_repo}")
    print(f"  lora_r={params.training.lora_r}, alpha={params.training.lora_alpha}, "
          f"epochs={params.training.num_train_epochs}")
    print(f"  batch_size={params.training.per_device_train_batch_size}, "
          f"grad_accum={params.training.gradient_accumulation_steps}, "
          f"lr={params.training.learning_rate}")
    return params


# ---------------------------------------------------------------------------
# [2/5] load_dataset
# ---------------------------------------------------------------------------

def build_messages(example: dict) -> list[dict]:
    """HF 데이터셋 row를 Qwen3-VL 메시지 리스트로 변환."""
    messages = [
        {"role": "system", "content": example["system_prompt"]},
        {
            "role": "user",
            "content": [
                {"type": "image", "image": example["image"]},  # PIL Image
                {"type": "text", "text": example["context_text"]},
            ],
        },
    ]

    # Assistant message: thought + tool_calls
    tool_calls_raw = json.loads(example["tool_calls"]) if isinstance(example["tool_calls"], str) else example["tool_calls"]
    assistant_msg = {
        "role": "assistant",
        "content": example.get("thought_text") or "",
        "tool_calls": [
            {
                "type": "function",
                "function": {
                    "name": tc["name"],
                    "arguments": json.dumps(tc["args"], ensure_ascii=False),
                },
            }
            for tc in tool_calls_raw
        ],
    }
    messages.append(assistant_msg)

    # Tool results
    tool_results_raw = json.loads(example["tool_results"]) if isinstance(example["tool_results"], str) else example["tool_results"]
    for tr in tool_results_raw:
        messages.append({
            "role": "tool",
            "name": tr["name"],
            "content": json.dumps(tr["result"], ensure_ascii=False),
        })

    return messages


@task(name="prepare_dataset", retries=2, retry_delay_seconds=10)
def prepare_dataset(params: FlowParameters, processor):
    print("[2/5] load_dataset — HF Hub에서 데이터셋 로드")

    ds = load_dataset(params.hf_dataset_repo, split="train")
    print(f"  loaded {len(ds)} examples")

    def formatting_func(examples):
        """SFTTrainer용 포매팅 함수. 각 example을 chat template 텍스트로 변환."""
        texts = []
        for i in range(len(examples["episode_id"])):
            example = {k: examples[k][i] for k in examples}
            messages = build_messages(example)

            # apply_chat_template으로 텍스트 생성
            text = processor.apply_chat_template(
                messages,
                tools=TOOLS,
                tokenize=False,
                add_generation_prompt=False,
            )
            texts.append(text)
        return texts

    return ds, formatting_func


# ---------------------------------------------------------------------------
# [3/5] train
# ---------------------------------------------------------------------------

@task(name="train", retries=0)
def train(params: FlowParameters, ds, formatting_func, processor):
    print("[3/5] train — bf16 LoRA + SFTTrainer")
    t = params.training

    # WandB
    use_wandb = login_wandb(params.wandb_project, run_name="safari-vlm-train")

    print("  loading model...")
    model = Qwen3VLForConditionalGeneration.from_pretrained(
        t.model_id,
        torch_dtype=torch.bfloat16,
        device_map="auto",
    )

    # LoRA config
    target_modules = [m.strip() for m in t.lora_target_modules.split(",")]
    lora_config = LoraConfig(
        r=t.lora_r,
        lora_alpha=t.lora_alpha,
        lora_dropout=t.lora_dropout,
        target_modules=target_modules,
        task_type=TaskType.CAUSAL_LM,
        bias="none",
    )

    # SFT config
    sft_config = SFTConfig(
        output_dir=t.output_dir,
        per_device_train_batch_size=t.per_device_train_batch_size,
        gradient_accumulation_steps=t.gradient_accumulation_steps,
        learning_rate=t.learning_rate,
        num_train_epochs=t.num_train_epochs,
        bf16=t.bf16,
        max_seq_length=t.max_seq_length,
        gradient_checkpointing=True,
        logging_steps=1,
        save_strategy="epoch",
        remove_unused_columns=False,
        dataset_kwargs={"skip_prepare_dataset": True},
        report_to="wandb" if use_wandb else "none",
    )

    trainer = SFTTrainer(
        model=model,
        args=sft_config,
        train_dataset=ds,
        peft_config=lora_config,
        processing_class=processor,
        formatting_func=formatting_func,
    )

    # DiscordHook 콜백 등록
    trainer.add_callback(DiscordHook(
        run_name="safari-vlm-train",
        hook_steps=sft_config.logging_steps,
    ))

    print("  starting training...")
    trainer.train()
    print("  training complete")

    # Save adapter
    trainer.save_model(t.output_dir)
    processor.save_pretrained(t.output_dir)
    print(f"  saved adapter to {t.output_dir}")

    if use_wandb:
        import wandb
        wandb.finish()

    return trainer


# ---------------------------------------------------------------------------
# [4/5] upload_to_hub
# ---------------------------------------------------------------------------

@task(name="upload_to_hub", retries=2, retry_delay_seconds=10)
def upload_to_hub(params: FlowParameters):
    print("[4/5] upload_to_hub — LoRA 어댑터 HF Hub 업로드")
    from huggingface_hub import HfApi

    api = HfApi(token=params.hf_token)
    api.create_repo(params.hf_output_repo, exist_ok=True)
    api.upload_folder(
        folder_path=params.training.output_dir,
        repo_id=params.hf_output_repo,
        commit_message=f"Upload LoRA adapter (r={params.training.lora_r}, epochs={params.training.num_train_epochs})",
    )
    print(f"  uploaded to https://huggingface.co/{params.hf_output_repo}")


# ---------------------------------------------------------------------------
# [5/5] self_terminate
# ---------------------------------------------------------------------------

@task(name="self_terminate", retries=1, retry_delay_seconds=5)
def self_terminate(params: FlowParameters):
    print("[5/5] self_terminate — Pod 자가 종료")
    pod_id = params.runpod_pod_id
    api_key = params.runpod_api_key
    if not pod_id or not api_key:
        print("  RUNPOD_POD_ID or RUNPOD_API_KEY not set, skipping self-terminate")
        return
    try:
        resp = requests.delete(
            f"https://rest.runpod.io/v1/pods/{pod_id}",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        print(f"  terminate response: {resp.status_code} {resp.text}")
    except Exception as e:
        print(f"  terminate failed: {e}")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

@flow(name="safari-vlm-train", log_prints=True)
def train_flow():
    params = None
    try:
        params = load_config()
        if params.hf_token:
            login(token=params.hf_token)
        t = params.training
        send_discord(f"🚀 *학습 시작*\nmodel: `{t.model_id}` | dataset: `{params.hf_dataset_repo}` | epochs: {t.num_train_epochs}")

        processor = AutoProcessor.from_pretrained(t.model_id)
        ds, formatting_func = prepare_dataset(params, processor)
        train(params, ds, formatting_func, processor)
        upload_to_hub(params)

        send_discord(f"✅ *학습 완료*\nhttps://huggingface.co/{params.hf_output_repo}")
        print("ALL DONE")
    except Exception as e:
        traceback.print_exc()
        send_discord(f"❌ *학습 실패*\n```{e}```")
        raise
    finally:
        if params:
            self_terminate(params)


if __name__ == "__main__":
    train_flow()
