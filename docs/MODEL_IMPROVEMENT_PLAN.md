# 사파리 에이전트 모델 성능 분석 및 개선 계획 (VLM Finetuning Plan)

본 문서는 `notebook/vllm_test.ipynb`를 통해 확인된 **Qwen3-VL-Thinking** 모델의 사파리 게임 수행 능력을 분석하고, 향후 성능 개선을 위한 파인튜닝 전략을 제안합니다.

## 1. 현재 성능 요약 (Baseline Analysis)

| 테스트 레벨 | 항목 | 결과 | 주요 실패 원인 |
| :--- | :--- | :--- | :--- |
| **Level 1** | 단순 이동 | **PASS** | 기본 도구 호출 문법 이해 |
| **Level 2** | 복합 이동 (좌표 계산) | **FAIL** | 과도한 Reasoning으로 인한 토큰 고갈 (Max Tokens 5000 초과) |
| **Level 3** | 다중 도구 동시 호출 | **PASS** | `move` + `update_notepad` 병렬 호출 가능 |
| **Level 4** | 장애물 우회 추론 | **FAIL** | 논리적 경로 생성 실패 및 도구 호출 누락 |
| **Level 5** | 이미지 분석 + 도구 호출 | **FAIL** | Visual Grounding(이미지 내 좌표 파악) 및 추론 루프 발생 |
| **Level 6** | 멀티턴 시뮬레이션 | **PASS** | 단계별 명시적 지시(Scaffolding) 시 성공 |

## 2. 핵심 문제점 (Pain Points)

### 2.1 "Thinking"의 비효율성 (Thinking Trap)
- **증상:** 모델이 `<think>` 태그 내에서 동일한 계산을 반복하거나 너무 장황하게 사고함.
- **결과:** 정작 도구(Tool Call)를 출력해야 할 시점에 `max_tokens`에 도달하여 응답이 끊김.
- **원인:** 범용 모델이 사파리 게임의 단순한 격자 규칙을 너무 복잡한 철학적 문제로 접근함.

### 2.2 시각적 좌표 매핑 능력 부족 (Visual Grounding Issue)
- **증상:** 이미지 내의 '빨간 원숭이'는 인식하지만, 그것이 격자상 (x, y) 어디인지 매핑하지 못함.
- **결과:** 엉뚱한 방향으로 이동하거나 이동 자체를 포기함.

### 2.3 복잡한 JSON 스키마 숙달 미흡
- **증상:** `move` 도구의 `actions` 리스트 내에 여러 `Action` 객체를 넣는 문법에서 실수가 잦음.
- **결과:** 잘못된 인자(Arguments) 전달로 인한 실행 에러 또는 호출 생략.

## 3. 파인튜닝 개선 방향 (Finetuning Strategy)

### 3.1 사고 과정의 정제 (Reasoning Distillation)
- **목표:** `<think>` 내용을 사파리 게임에 최적화된 짧고 명확한 단계로 고정.
- **데이터 예시:** 
    ```text
    <think>
    1. 현재 위치: (3, 3) / 목표: (5, 1)
    2. 장애물: LEFT(나무)
    3. 경로 계획: RIGHT 2칸 이동 후 DOWN 2칸 이동.
    </think>
    [move(actions=[{"direction": "RIGHT", "steps": 2}, {"direction": "DOWN", "steps": 2}])]
    ```

### 3.2 시각적 데이터셋 강화 (Visual-Grid Alignment)
- **방법:** `data/safari-dataset`의 이미지와 실제 게임 엔진의 좌표 데이터를 결합.
- **학습 내용:** "이 이미지의 (x, y) 지점에 어떤 오브젝트가 있는가?"에 대한 질의응답 데이터를 대량 학습시켜 VLM의 공간 인지력을 높임.

### 3.3 에이전트 전용 행동 패턴 학습
- **패턴 1 (탐험):** 주변에 아무것도 없을 때 `update_notepad`와 함께 효율적인 탐색 경로 생성.
- **패턴 2 (우회):** 장애물을 만났을 때 즉각적인 우회 알고리즘 수행.
- **패턴 3 (종료):** 목표 도달 시 반드시 `declare_found`를 호출하는 루틴.

## 4. 실행 로드맵 (Execution Roadmap)

1.  **데이터 생성 (Data Gen):** `game-engine.ts`와 `data-collector.ts`를 활용해 성공 사례(Oracle Trajectories) 1,000건 수집.
2.  **학습 환경 설정:** `images/safari_vlm_train/` 환경에서 Qwen3-VL-2B/4B 기반 LoRA 학습 수행.
3.  **검증:** `vllm_test.ipynb`의 실패 레벨(L2, L4, L5) 재테스트 및 통과율 확인.
4.  **배포:** 실제 `web/server/utils/safari/llm.ts`에 개선된 모델 적용.
