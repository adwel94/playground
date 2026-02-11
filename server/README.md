# Vision Safari Agent Backend

Vision Safari 게임의 에이전트를 제어하기 위한 FastAPI 기반 WebSocket 서버입니다. LangChain과 Gemini API를 통합하여 시각 정보 분석 및 의사결정을 수행합니다.

## 프로젝트 구조

```text
server/
├── main.py              # 서버 진입점 및 WebSocket 라우팅
├── .env                 # 환경 변수 설정 파일
├── handlers/            # 게임별 비즈니스 로직 핸들러
│   ├── __init__.py
│   └── vision_safari.py # Vision Safari 게임용 AI 로직
├── requirements.txt     # Python 의존성 목록
└── server.log           # 서버 로그 파일
```

## 시작하기

### 1. 환경 준비 (Conda)

현재 Conda 환경을 사용 중이시라면 별도의 가상 환경 생성 없이 필요한 라이브러리를 설치합니다.

```bash
# 필요한 패키지 설치
pip install -r requirements.txt
pip install python-dotenv langchain-google-genai langchain-core
```

### 2. 환경 변수 설정

`server/.env` 파일을 생성하고 필요한 값을 입력합니다.

```env
PORT=8000
GOOGLE_API_KEY=your_gemini_api_key_here
```

### 3. 서버 실행

```bash
# 서버 실행 (Conda 환경이 활성화된 상태에서)
python main.py
```

서버가 실행되면 `http://0.0.0.0:8000`에서 요청을 대기하며, 클라이언트는 `ws://localhost:8000/ws/{game_id}`를 통해 연결할 수 있습니다.

## 주요 기능

- **실시간 통신**: WebSocket을 통한 지연 없는 양방향 제어.
- **멀티 게임 지원**: 각 게임별로 독립적인 핸들러를 구성하여 확장 가능.
- **AI 에이전트**: LangChain을 통해 Gemini Pro Vision 모델과 연동하여 게임 화면을 분석하고 행동 결정.
- **자동 복구**: AI API 호출 실패 시 시뮬레이션 모드로 전환되어 연결 유지.

## 통신 프로토콜

### Client -> Server (Events)
- `USER_COMMAND`: 사용자의 자연어 명령 전송.
- `SCREEN_DATA`: 게임 화면의 Base64 캡처 데이터 전송.
- `MOVE_COMPLETE`: 이동 완료 후 현재 좌표 보고.

### Server -> Client (Actions)
- `CAPTURE_SCREEN`: 클라이언트에게 화면 캡처 및 전송 요청.
- `MOVE`: 플레이어 이동 명령 (방향, 스텝 수).
- `IDLE`: 대기 또는 목표 달성 보고.
