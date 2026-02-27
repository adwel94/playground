"""Emoji VLM bf16 LoRA 학습 Prefect Flow.

5단계 순차 실행. @flow/@task 데코레이터로 Prefect Cloud 모니터링.
finally 블록에서 반드시 자가 종료 (과금 안전).

[1/5] load_config       — FlowParameters.from_env()
[2/5] load_dataset       — HF Hub에서 데이터셋 로드, collate_fn 정의
[3/5] train              — bf16 LoRA + SFTTrainer
[4/5] upload_to_hub      — LoRA 어댑터 HF Hub 업로드
[5/5] self_terminate     — RunPod REST DELETE (finally 블록)
"""

import json
import os
import time
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
            "name": "update_notepad",
            "description": "관찰 결과를 메모장에 기록합니다. 발견한 모든 동물의 위치, 색상, 종류를 기록하세요.",
            "parameters": {
                "type": "object",
                "properties": {"content": {"type": "string", "description": "관찰 내용"}},
                "required": ["content"],
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
    """HF 데이터셋 row를 Qwen3-VL 메시지 리스트로 변환.

    answer_text(프로그래밍적으로 생성된 정답)를 사용하여
    update_notepad tool_call을 직접 구성한다.
    """
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

    # Ground truth 기반 tool_call 생성
    answer_text = example.get("answer_text") or ""
    answer_lines = [f"- {line}" for line in answer_text.strip().split("\n") if line.strip()]
    notepad_content = "[관찰]\n" + "\n".join(answer_lines)

    assistant_msg = {
        "role": "assistant",
        "content": example.get("thought_text") or "",
        "tool_calls": [{
            "type": "function",
            "function": {
                "name": "update_notepad",
                "arguments": json.dumps({"content": notepad_content}, ensure_ascii=False),
            },
        }],
    }
    messages.append(assistant_msg)
    messages.append({
        "role": "tool",
        "name": "update_notepad",
        "content": json.dumps({"status": "updated"}, ensure_ascii=False),
    })

    return messages


@task(name="prepare_dataset", retries=2, retry_delay_seconds=10)
def prepare_dataset(params: FlowParameters, processor):
    print("[2/5] load_dataset — HF Hub에서 데이터셋 로드")

    ds = load_dataset(params.hf_dataset_repo, split="train")
    print(f"  loaded {len(ds)} examples")

    def map_to_text_and_images(example):
        messages = build_messages(example)
        text = processor.apply_chat_template(
            messages, tools=TOOLS, tokenize=False, add_generation_prompt=False,
        )
        return {"text": text, "images": [example["image"]]}

    ds = ds.map(map_to_text_and_images, remove_columns=ds.column_names,
                desc="Converting to text+images format")
    print(f"  mapped dataset columns: {ds.column_names}")
    return ds


# ---------------------------------------------------------------------------
# [3/5] train
# ---------------------------------------------------------------------------

@task(name="train", retries=0)
def train(params: FlowParameters, ds, processor):
    print("[3/5] train — bf16 LoRA + SFTTrainer")
    t = params.training

    # WandB
    pod_id = params.runpod_pod_id or "local"
    run_name = f"emoji-vlm-train-{pod_id}"
    use_wandb = login_wandb(params.wandb_project, run_name=run_name)

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
        max_length=t.max_seq_length,
        gradient_checkpointing=True,
        logging_steps=1,
        save_strategy="epoch",
        dataset_text_field="text",
        remove_unused_columns=False,
        report_to="wandb" if use_wandb else "none",
    )

    trainer = SFTTrainer(
        model=model,
        args=sft_config,
        train_dataset=ds,
        peft_config=lora_config,
        processing_class=processor,
    )

    # DiscordHook 콜백 등록
    trainer.add_callback(DiscordHook(
        run_name=run_name,
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
    branch = params.hf_output_branch
    print(f"[4/5] upload_to_hub — LoRA 어댑터 HF Hub 업로드 (branch={branch})")
    from huggingface_hub import HfApi

    api = HfApi(token=params.hf_token)
    api.create_repo(params.hf_output_repo, exist_ok=True)
    if branch != "main":
        api.create_branch(repo_id=params.hf_output_repo, branch=branch, exist_ok=True)
    api.upload_folder(
        folder_path=params.training.output_dir,
        repo_id=params.hf_output_repo,
        revision=branch,
        commit_message=f"Upload LoRA adapter (r={params.training.lora_r}, epochs={params.training.num_train_epochs})",
    )
    print(f"  uploaded to https://huggingface.co/{params.hf_output_repo}/tree/{branch}")


# ---------------------------------------------------------------------------
# [5/5] self_terminate
# ---------------------------------------------------------------------------

@task(name="self_terminate", retries=0)
def self_terminate(params: FlowParameters):
    pod_id = params.runpod_pod_id
    api_key = params.runpod_api_key
    print(f"[5/5] self_terminate — Pod 자가 종료 (pod_id={pod_id})")
    if not pod_id or not api_key:
        print("  RUNPOD_POD_ID or RUNPOD_API_KEY not set, skipping self-terminate")
        return

    max_attempts = 100
    for attempt in range(1, max_attempts + 1):
        try:
            send_discord(f"🗑️ Pod 삭제 시도 [{attempt}/{max_attempts}] — pod: `{pod_id}`")
            resp = requests.delete(
                f"https://rest.runpod.io/v1/pods/{pod_id}",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=30,
            )
            print(f"  [{attempt}] terminate response: {resp.status_code} {resp.text}")
            resp.raise_for_status()
            send_discord(f"✅ Pod 삭제 성공 [{attempt}/{max_attempts}] — pod: `{pod_id}`")
            print(f"  Pod {pod_id} DELETE 요청 성공, 30초 대기 후 프로세스 종료")
            time.sleep(30)
            return
        except Exception as e:
            print(f"  [{attempt}] 삭제 실패: {e}")
            if attempt < max_attempts:
                time.sleep(30)

    send_discord(f"🚨 Pod 삭제 {max_attempts}회 모두 실패! 수동 확인 필요 — pod: `{pod_id}`")
    print(f"  Pod {pod_id} 삭제 {max_attempts}회 실패")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def _flow_run_name() -> str:
    pod_id = os.environ.get("RUNPOD_POD_ID", "local")
    return f"emoji-vlm-train-{pod_id}"


@flow(name="emoji-vlm-train", flow_run_name=_flow_run_name, log_prints=True)
def train_flow():
    params = None
    try:
        params = load_config()
        pod_id = params.runpod_pod_id or "local"
        run_name = f"emoji-vlm-train-{pod_id}"
        if params.hf_token:
            login(token=params.hf_token)
        t = params.training
        send_discord(f"🎯 *이모티콘 학습 시작*\nmodel: `{t.model_id}` | dataset: `{params.hf_dataset_repo}` | epochs: {t.num_train_epochs}\npod: `{params.runpod_pod_id}`")

        processor = AutoProcessor.from_pretrained(t.model_id)
        ds = prepare_dataset(params, processor)
        train(params, ds, processor)
        upload_to_hub(params)

        send_discord(f"✅ *이모티콘 학습 완료*\nhttps://huggingface.co/{params.hf_output_repo}\npod: `{params.runpod_pod_id}`")
        print("ALL DONE")
    except Exception as e:
        traceback.print_exc()
        send_discord(f"❌ *이모티콘 학습 실패*\npod: `{params.runpod_pod_id}`\n```{e}```")
        raise
    finally:
        if params:
            self_terminate(params)


if __name__ == "__main__":
    train_flow()
