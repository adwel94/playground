# Vision Safari 에이전트 통신 환경 구축 계획서

본 문서는 LLM 에이전트(Python)가 게임 환경(Nuxt)을 관찰하고 제어하기 위한 실시간 통신 인프라 설계안입니다.

## 1. 아키텍처 개요
- **Commander (Python/FastAPI)**: LangChain 에이전트가 상주하며, 의사결정을 내립니다.
- **Actor (Nuxt/Vue)**: 실제 게임 로직이 돌아가며, 에이전트의 명령을 실행하고 시각 정보를 제공합니다.
- **Protocol**: **WebSocket**을 사용하여 지연 시간을 최소화하고 양방향 제어를 가능하게 합니다.

## 2. 통신 시퀀스 (Communication Loop)
1. **에이전트 기동**: 사용자가 Nuxt에서 명령을 입력하면 WebSocket을 통해 Python으로 전달됩니다.
2. **관찰 (Observation)**: Python 에이전트가 `CAPTURE_SCREEN` 도구를 호출하면, Nuxt로 캡처 명령이 전송됩니다.
3. **데이터 반환**: Nuxt는 캔버스를 `base64` 이미지로 변환하여 Python으로 즉시 전송합니다.
4. **추론 및 행동 (Reasoning & Action)**: Python 에이전트가 이미지를 분석하고 `MOVE` 도구를 호출하여 Nuxt에 이동 방향을 전송합니다.
5. **피드백**: Nuxt는 이동 완료 여부와 현재 좌표를 다시 Python으로 보고합니다.

## 3. 기술 스택
- **Backend**: Python 3.10+, FastAPI, `websockets` 라이브러리.
- **Frontend**: Nuxt 4 (Vue 3), 브라우저 기본 WebSocket API.
- **Agent**: LangChain (추후 통합 예정).

## 4. 상세 구현 계획

### Step 1: Python 백엔드 (FastAPI) 구축
- `backend/main.py`: WebSocket 엔드포인트 구현.
- 메시지 핸들러: JSON 형태의 메시지(`type`, `payload`) 처리 로직.
- 에이전트 명령 큐 관리.

### Step 2: Nuxt 프론트엔드 연결
- `app/pages/vision-safari.vue`에 WebSocket 클라이언트 추가.
- 명령 수신기 구현:
    - `CAPTURE_SCREEN`: `canvas.toDataURL()` 실행 및 전송.
    - `MOVE`: `movePlayer(dx, dy)` 실행.
- 연결 상태 표시 UI 추가.

### Step 3: 메시지 프로토콜 정의
```json
// Python -> Nuxt (명령)
{ "action": "CAPTURE_SCREEN" }
{ "action": "MOVE", "direction": "UP", "steps": 1 }

// Nuxt -> Python (데이터/응답)
{ "event": "SCREEN_DATA", "image": "base64_string..." }
{ "event": "MOVE_COMPLETE", "pos": { "x": 10, "y": 20 } }
```

## 5. 보안 및 성능 고려사항
- **성능**: 100x100 그리드 이미지는 전송 시 압축률을 조정하여 네트워크 부하를 줄입니다.
- **확장성**: 이후 여러 종류의 게임이 추가되어도 동일한 통신 규격을 사용할 수 있도록 설계합니다.
