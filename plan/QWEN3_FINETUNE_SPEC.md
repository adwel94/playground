# Qwen3-VL 에이전트 파인튜닝 명세서

본 문서는 Qwen3-VL-2B-Instruct 모델을 '비전 사파리 에이전트'로 파인튜닝하기 위한 상세 계획 및 명세서입니다.

## 1. 프로젝트 개요
*   **목표**: Qwen3-VL-2B 모델을 파인튜닝하여, 10x10 시야 이미지와 텍스트 컨텍스트를 분석하고 `Thought`(추론)와 `Action`(도구 호출)을 순차적으로 수행하는 '사파리 전문가 에이전트' 구축.
*   **핵심 데이터**: `dataset.jsonl` (이미지 경로, 미션, 이전 메모, 모델의 도구 호출 결과 포함).

## 2. 환경 설정 (Environment)
*   **주요 라이브러리**:
    *   `transformers >= 4.45.0` (Qwen3 지원 버전)
    *   `peft`: LoRA/QLoRA 학습용
    *   `trl`: SFTTrainer 사용
    *   `qwen-vl-utils`: Qwen-VL 전용 이미지 프로세싱 유틸리티
*   **하드웨어 권장**: VRAM 24GB 이상 (RTX 3090/4090 권장)

## 3. 데이터 전처리 전략 (Data Preparation)

기존 `dataset.jsonl` 데이터를 Qwen3-VL의 Chat Template 형식으로 변환합니다.

### 데이터 변환 로직 (Python)
```python
def format_to_qwen3(entry):
    # 툴 정보 정의
    tools = [
        {
            "type": "function",
            "function": {
                "name": "move",
                "description": "플레이어를 이동시킨다. 최대 4개 행동 순차 실행.",
                "parameters": { ... }
            }
        },
        # ... update_notepad, declare_found, declare_done 포함
    ]
    
    # 메시지 구조 생성
    messages = [
        {"role": "system", "content": entry["system_prompt"]},
        {
            "role": "user",
            "content": [
                {"type": "image", "image": f"data/safari-dataset/{entry['image_file']}"},
                {"type": "text", "text": entry["context_text"]}
            ]
        },
        {
            "role": "assistant",
            "content": f"Thought: {generate_thought(entry)}
Action: {format_tool_calls(entry['tool_calls'])}"
        }
    ]
    return {"messages": messages, "tools": tools}
```

## 4. 파인튜닝 코드 (SFT 구현)

QLoRA를 사용하여 메모리 효율적인 학습을 진행합니다.

```python
import torch
from transformers import Qwen2_5_VLForConditionalGeneration, AutoProcessor
from peft import LoraConfig, get_peft_model
from trl import SFTTrainer, SFTConfig

# 1. 모델 및 프로세서 로드
model_id = "Qwen/Qwen3-VL-2B-Instruct"
model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
    model_id, device_map="auto", torch_dtype=torch.bfloat16
)
processor = AutoProcessor.from_pretrained(model_id)

# 2. LoRA 설정
lora_config = LoraConfig(
    r=16, lora_alpha=32,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    lora_dropout=0.05, bias="none", task_type="CAUSAL_LM"
)
model = get_peft_model(model, lora_config)

# 3. 데이터 콜레이터 및 트레이너 설정
training_args = SFTConfig(
    output_dir="./qwen3-safari-agent",
    per_device_train_batch_size=2,
    gradient_accumulation_steps=4,
    learning_rate=2e-4,
    num_train_epochs=3,
    bf16=True,
    remove_unused_columns=False,
)

trainer = SFTTrainer(
    model=model,
    args=training_args,
    train_dataset=train_dataset,
    data_collator=collate_fn, # processor.apply_chat_template 활용
)
trainer.train()
```

## 5. 핵심 학습 포인트
1.  **Thought-Action 일관성**: 사고 과정에서 계산된 좌표와 실제 이동 명령의 파라미터가 일치하도록 학습 유도.
2.  **Native Tool Calling 활용**: `tokenizer.apply_chat_template`의 `tools` 인자를 사용하여 모델이 사전에 학습된 툴 호출 토큰을 사용하도록 설정.
3.  **멀티모달 정렬**: 시각 데이터(이미지 내 동물 위치)와 텍스트 데이터(좌표 정보) 간의 연관 관계 강화.

## 6. 검증 및 평가
*   **Inference 테스트**: 시야 분석 능력 및 사고 과정의 논리성 확인.
*   **성능 지표**: 미션 성공률, 평균 소요 턴 수, 툴 호출 정확도 측정.
