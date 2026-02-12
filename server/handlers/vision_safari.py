import asyncio
import json
from fastapi import WebSocket
from typing import Optional, Literal, Annotated

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from pydantic import BaseModel
from langchain_core.tools import Tool
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages

from utils.ws_bridge import WebSocketBridge

# --- 도구 인자 스키마 ---

class MoveArgs(BaseModel):
    direction: Literal["UP", "DOWN", "LEFT", "RIGHT"]
    steps: int = 1

class SaveNoteArgs(BaseModel):
    note: str

class DeclareFoundArgs(BaseModel):
    target: str

# --- 도구 정의 ---

TOOLS = [
    Tool(
        name="Move",
        description="플레이어를 지정한 방향으로 N칸 이동시킨다. 이동 후 위치와 동물 도달 여부를 반환한다.",
        func=lambda direction, steps=1: None,
        args_schema=MoveArgs,
    ),
    Tool(
        name="SaveNote",
        description="관찰 내용을 영구 메모리에 저장한다 (히스토리 트리밍에서도 유지됨). 동물 목격 정보와 추정 좌표, 장애물 위치, 탐색 전략 등을 기록할 때 사용한다.",
        func=lambda note: None,
        args_schema=SaveNoteArgs,
    ),
    Tool(
        name="DeclareFound",
        description="특정 타겟을 찾아서 도달했음을 선언한다. 타겟 동물 위에 도착했을 때 호출한다. 나머지 타겟 탐색을 위해 미션은 계속된다.",
        func=lambda target: None,
        args_schema=DeclareFoundArgs,
    ),
    Tool(
        name="DeclareDone",
        description="전체 미션이 완료되었음을 선언한다. DeclareFound로 모든 타겟을 찾은 후에만 호출한다.",
        func=lambda: None,
    ),
]

SYSTEM_PROMPT = """너는 'Vision Safari' 게임의 AI 에이전트야.
50x50 그리드를 탐색하지만, 플레이어 주변 10x10 영역만 볼 수 있어.

그리드에서 보이는 것들:
- 'P' (파란 원) = 플레이어 (너)
- '🌲' = 나무 (장애물, 통과 불가)
- 색깔 배경 위의 동물 이모지 = 타겟

매 턴마다 현재 10x10 시야가 이미지로 자동 제공돼. 직접 캡처할 필요 없어.

사용 가능한 도구:
1. Move(direction, steps) - 지정 방향으로 N칸(1~10) 이동. 이동 후 위치, 실제 이동 칸수, 동물 도달 여부를 반환.
2. SaveNote(note) - 관찰 내용을 영구 메모리에 저장. 동물 목격 정보와 추정 좌표, 장애물 위치, 탐색 메모 등을 기록할 때 사용. 히스토리 트리밍에도 유지됨.
3. DeclareFound(target) - 특정 타겟을 찾아 도달했음을 선언 (예: "빨간배경 호랑이"). 타겟 동물 위에 도착했을 때 호출. 나머지 타겟 탐색을 위해 미션은 계속됨.
4. DeclareDone() - 전체 미션 완료를 선언. DeclareFound로 모든 타겟을 찾은 후에만 호출.

필수 규칙:
- 턴당 정확히 하나의 도구만 호출. 여러 도구를 한 번에 호출하지 마.
- 제공된 시야 이미지를 분석한 후 다음 행동을 결정해.
- Move 결과에 "on_animal"이 포함되면, 타겟과 일치하는지 확인하고 DeclareFound(target)를 호출해.
- 모든 타겟을 찾은 후 DeclareDone()을 호출해.
- 이동이 막혔으면(actual_steps < 요청한 수) 다른 방향을 시도해.

멀티 미션 워크플로우:
- 여러 타겟을 찾아야 할 수 있어 (예: "빨간 호랑이와 분홍 기린을 찾아").
- 타겟을 찾을 때마다: DeclareFound(target)를 호출해 (예: "빨간배경 호랑이").
- 모든 타겟을 찾은 후: DeclareDone()을 호출해서 미션을 종료해.
- 메모리 컨텍스트의 "찾은 타겟" 항목을 확인해서 이미 찾은 타겟을 파악해.

메모리 전략:
- 시야에 동물이 보이면 SaveNote로 추정 좌표와 함께 기록해.
- 좌표 추정법: 메모리 컨텍스트에 현재 위치가 표시돼. 시야는 너를 중심으로 10x10이야. 시야 내 상대 오프셋으로 동물의 절대 좌표를 추정해.
- 기억한 타겟으로 이동하기 전에 저장된 메모를 확인해.
- 장애물, 막다른 길, 이미 탐색한 영역도 메모해.

탐색 전략:
- 타겟이 10x10 시야에 보이면 바로 그쪽으로 이동해.
- 보이지 않으면 저장된 메모에서 이전 목격 정보를 확인해.
- 그래도 없으면 체계적으로 탐색해 (예: 행 단위 스캔 또는 나선형 탐색).
- 한 번에 여러 칸(steps=1~10) 이동해서 빠르게 거리를 커버할 수 있어.
- 나무는 이동을 막아. 우회해서 지나가.
"""

MAX_HISTORY = 40


# --- LangGraph 상태 ---

class AgentState(BaseModel):
    messages: Annotated[list, add_messages]
    mission_complete: bool = False
    memory_notes: list[str] = []
    found_targets: list[str] = []
    current_position: dict = {"x": 25, "y": 25}
    last_tool_name: str = ""
    turn_count: int = 0


# --- LLM (싱글턴) ---

llm = ChatGoogleGenerativeAI(model="gemini-3-flash-preview", temperature=0)
llm_with_tools = llm.bind_tools(TOOLS)


# --- 노드 함수 (config에서 ws를 꺼내 사용) ---

async def capture_view_node(state: AgentState, config: RunnableConfig) -> dict:
    """ws.request로 화면 캡처 → 이미지를 HumanMessage로 state.messages에 추가한다."""
    ws: WebSocketBridge = config["configurable"]["ws"]
    await ws.send({"type": "agent_log", "log_type": "system", "message": "자동: CaptureView()"})
    response = await ws.request({"type": "capture_request"})
    image_data = response.get("image")

    if image_data:
        if "," in image_data:
            image_b64 = image_data.split(",", 1)[1]
        else:
            image_b64 = image_data
        return {"messages": [HumanMessage(content=[
            {"type": "text", "text": "현재 10x10 시야 이미지야. 분석하고 다음 행동을 결정해."},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}},
        ])]}

    return {"messages": [HumanMessage(content="[CaptureView 실패 — 이미지 없음. 이전 컨텍스트를 기반으로 다음 행동을 결정해.]")]}


def _summarize_message(m) -> str:
    """메시지를 로그용 한 줄 요약으로 변환한다."""
    role = type(m).__name__.replace("Message", "")
    content = m.content
    if isinstance(content, list):
        # 멀티모달 메시지 (이미지 포함)
        parts = []
        for part in content:
            if isinstance(part, dict):
                if part.get("type") == "image_url":
                    parts.append("[이미지]")
                else:
                    parts.append(str(part.get("text", ""))[:100])
            else:
                parts.append(str(part)[:100])
        text = " ".join(parts)
    else:
        text = str(content)[:200]
    # AIMessage의 tool_calls 표시
    if hasattr(m, "tool_calls") and m.tool_calls:
        tc = m.tool_calls[0]
        text = f"→ {tc['name']}({json.dumps(tc['args'], ensure_ascii=False)[:80]})"
    return f"[{role}] {text}"


async def agent_node(state: AgentState, config: RunnableConfig) -> dict:
    """LLM 호출 → Move, SaveNote, DeclareFound, DeclareDone 중 하나를 결정한다."""
    ws: WebSocketBridge = config["configurable"]["ws"]
    turn = state.turn_count + 1

    # 히스토리 트리밍: 시스템+유저(첫 2개) + 최근 MAX_HISTORY개
    msgs = list(state.messages)
    trimmed = len(msgs) > MAX_HISTORY + 2
    if trimmed:
        msgs = msgs[:2] + msgs[-MAX_HISTORY:]

    # 메모리 컨텍스트 주입 (LLM에만 전달, state.messages에는 저장하지 않음)
    memory_lines = []
    pos = state.current_position
    memory_lines.append(f"## 현재 위치: ({pos.get('x', 25)}, {pos.get('y', 25)})")

    if state.found_targets:
        memory_lines.append(f"## 찾은 타겟 ({len(state.found_targets)}개):")
        for t in state.found_targets:
            memory_lines.append(f"  ✓ {t}")
    else:
        memory_lines.append("## 찾은 타겟: 아직 없음")

    if state.memory_notes:
        memory_lines.append("## 저장된 메모:")
        for n in state.memory_notes:
            memory_lines.append(f"  • {n}")

    memory_text = "\n".join(memory_lines)
    memory_context = SystemMessage(content=memory_text)

    # 메모리 컨텍스트 로그
    await ws.send({
        "type": "agent_log",
        "log_type": "memory",
        "message": f"[턴 {turn}] 메모리: 위치({pos.get('x', 25)},{pos.get('y', 25)}), 타겟 {len(state.found_targets)}개 발견, 메모 {len(state.memory_notes)}개",
        "detail": memory_text,
    })

    # 시스템 프롬프트(index 0) 뒤, 나머지 메시지 앞에 삽입
    llm_msgs = [msgs[0], memory_context] + msgs[1:]

    # 프롬프트 로그 (LLM 호출 직전)
    trim_label = ", 트리밍됨" if trimmed else ""
    detail_lines = [_summarize_message(m) for m in llm_msgs]
    await ws.send({
        "type": "agent_log",
        "log_type": "prompt",
        "message": f"[턴 {turn}] LLM 호출 (메시지 {len(llm_msgs)}개{trim_label})",
        "detail": "\n".join(detail_lines),
    })

    response = await llm_with_tools.ainvoke(llm_msgs)

    # 응답 로그
    response_content = str(response.content) if response.content else ""
    if response.tool_calls:
        tc = response.tool_calls[0]
        args_str = json.dumps(tc["args"], ensure_ascii=False)
        summary = f"[턴 {turn}] LLM 응답 → {tc['name']}({args_str[:80]})"
        detail = f"도구: {tc['name']}\n인자: {args_str}\n\n원본 응답:\n{response_content}" if response_content else f"도구: {tc['name']}\n인자: {args_str}"
    else:
        summary = f"[턴 {turn}] LLM 응답 (도구 호출 없음)"
        detail = response_content

    await ws.send({
        "type": "agent_log",
        "log_type": "response",
        "message": summary,
        "detail": detail if detail else None,
    })

    # tool_calls가 없으면 → 재촉 메시지 추가
    if not response.tool_calls:
        if response.content:
            await ws.send({
                "type": "agent_log",
                "log_type": "thinking",
                "message": f"생각 중: {str(response.content)[:200]}",
                "detail": str(response.content) if len(str(response.content)) > 200 else None,
            })
        return {
            "messages": [
                response,
                HumanMessage(content="Move, SaveNote, DeclareFound, DeclareDone 중 하나를 호출해서 진행해."),
            ],
            "turn_count": turn,
        }

    return {"messages": [response], "turn_count": turn}


async def tool_executor_node(state: AgentState, config: RunnableConfig) -> dict:
    """Move, SaveNote, DeclareFound, DeclareDone 도구를 실행한다."""
    ws: WebSocketBridge = config["configurable"]["ws"]

    last_ai: AIMessage = state.messages[-1]
    tc = last_ai.tool_calls[0]
    name = tc["name"]
    args = tc["args"]

    if name == "Move":
        direction = args.get("direction", "UP")
        steps = max(1, min(10, args.get("steps", 1)))
        await ws.send({"type": "agent_log", "log_type": "tool", "message": f"도구: Move({direction}, {steps})"})
        response = await ws.request({
            "type": "move_request",
            "direction": direction,
            "steps": steps,
        })
        moved = response.get("moved", False)
        actual_steps = response.get("actual_steps", 0)
        pos = response.get("pos", {})
        on_animal = response.get("on_animal")
        log_parts = [
            f"이동 {direction}×{actual_steps}/{steps}",
            f"→ ({pos.get('x')}, {pos.get('y')})",
        ]
        if on_animal:
            log_parts.append(f"동물 위: {on_animal.get('emoji')}")
        await ws.send({"type": "agent_log", "log_type": "tool", "message": " ".join(log_parts)})
        result_data = {"moved": moved, "actual_steps": actual_steps, "position": pos}
        if on_animal:
            result_data["on_animal"] = on_animal
        return {
            "messages": [ToolMessage(content=json.dumps(result_data), tool_call_id=tc["id"])],
            "current_position": pos,
            "last_tool_name": "Move",
        }

    elif name == "SaveNote":
        note = args.get("note", "")
        await ws.send({"type": "agent_log", "log_type": "tool", "message": f"도구: SaveNote(\"{note[:80]}\")"})
        new_notes = list(state.memory_notes) + [note]
        return {
            "messages": [ToolMessage(content=json.dumps({"status": "saved", "note": note}), tool_call_id=tc["id"])],
            "memory_notes": new_notes,
            "last_tool_name": "SaveNote",
        }

    elif name == "DeclareFound":
        target = args.get("target", "")
        new_found = list(state.found_targets) + [target]
        await ws.send({"type": "agent_log", "log_type": "tool", "message": f"도구: DeclareFound(\"{target}\") — 현재까지 {len(new_found)}개 타겟 발견"})
        return {
            "messages": [ToolMessage(content=json.dumps({"status": "found", "target": target, "total_found": len(new_found)}), tool_call_id=tc["id"])],
            "found_targets": new_found,
            "last_tool_name": "DeclareFound",
        }

    elif name == "DeclareDone":
        found_summary = ", ".join(state.found_targets) if state.found_targets else "없음"
        await ws.send({"type": "agent_log", "log_type": "tool", "message": f"도구: DeclareDone() — 미션 완료! 찾은 타겟: [{found_summary}]"})
        await ws.send({"type": "agent_done"})
        return {
            "messages": [ToolMessage(content=json.dumps({"status": "done", "found_targets": state.found_targets}), tool_call_id=tc["id"])],
            "mission_complete": True,
            "last_tool_name": "DeclareDone",
        }

    # 알 수 없는 도구 — 무시하고 ToolMessage만 반환
    return {
        "messages": [ToolMessage(content=json.dumps({"error": f"알 수 없는 도구: {name}"}), tool_call_id=tc["id"])],
        "last_tool_name": name,
    }


# --- 라우팅 ---

def after_agent(state: AgentState) -> str:
    """agent 노드 이후 라우팅: tool_calls가 있으면 tool_executor, 없으면 다시 agent(재촉)."""
    last = state.messages[-1]
    if isinstance(last, AIMessage) and last.tool_calls:
        return "tool_executor"
    return "agent"


def after_tool(state: AgentState) -> str:
    """tool_executor 이후 라우팅:
    - DeclareDone → END
    - SaveNote → agent (화면 변화 없으므로 capture_view 스킵)
    - Move, DeclareFound → capture_view
    """
    if state.mission_complete:
        return END
    if state.last_tool_name == "SaveNote":
        return "agent"
    return "capture_view"


# --- 그래프 (싱글턴) ---
# START → capture_view → agent → (Move/DeclareFound → tool_executor → capture_view)
#                                  (SaveNote → tool_executor → agent)
#                                  (DeclareDone → tool_executor → END)

def build_safari_graph():
    """LangGraph 플로우를 정의하고 컴파일한다. 세션 의존성은 런타임 config로 주입한다."""
    graph = StateGraph(AgentState)
    graph.add_node("capture_view", capture_view_node)
    graph.add_node("agent", agent_node)
    graph.add_node("tool_executor", tool_executor_node)

    graph.add_edge(START, "capture_view")
    graph.add_edge("capture_view", "agent")
    graph.add_conditional_edges("agent", after_agent, ["agent", "tool_executor"])
    graph.add_conditional_edges("tool_executor", after_tool, ["capture_view", "agent", END])

    return graph.compile()

safari_graph = build_safari_graph()


# --- 에이전트 세션 ---

class SafariAgentSession:
    def __init__(self, ws: WebSocketBridge):
        self.ws = ws
        self.max_steps = 200
        self.agent_task: Optional[asyncio.Task] = None
        self.mission_complete = False

    async def run_agent_loop(self, user_command: str):
        """LangGraph 기반 에이전트 루프를 실행한다."""
        self.mission_complete = False

        initial_state = AgentState(
            messages=[
                SystemMessage(content=SYSTEM_PROMPT),
                HumanMessage(content=f"유저 명령: {user_command}"),
            ],
            mission_complete=False,
        )

        try:
            config = {
                "recursion_limit": self.max_steps,
                "configurable": {"ws": self.ws},
            }
            final_state = await safari_graph.ainvoke(initial_state, config=config)

            if not final_state.get("mission_complete", False):
                await self.ws.send({
                    "type": "agent_log",
                    "log_type": "system",
                    "message": f"최대 스텝({self.max_steps})에 도달. 중단합니다.",
                })
                await self.ws.send({"type": "agent_done"})

        except asyncio.CancelledError:
            try:
                await self.ws.send({
                    "type": "agent_log",
                    "log_type": "system",
                    "message": "에이전트 루프 취소됨 (새 명령 또는 연결 해제).",
                })
                await self.ws.send({"type": "agent_done"})
            except Exception:
                pass
        except Exception as e:
            print(f"[Vision Safari] 에이전트 루프 에러: {e}")
            try:
                await self.ws.send({
                    "type": "agent_error",
                    "message": f"에이전트 에러: {str(e)}",
                })
            except Exception:
                pass


# --- 이벤트 핸들러 ---

async def _cancel_agent(agent: SafariAgentSession):
    """실행 중인 에이전트 태스크를 안전하게 취소한다."""
    if agent.agent_task and not agent.agent_task.done():
        agent.agent_task.cancel()
        try:
            await agent.agent_task
        except (asyncio.CancelledError, Exception):
            pass


async def _on_user_command(agent: SafariAgentSession, message: dict):
    await _cancel_agent(agent)
    agent.ws.reset()
    agent.mission_complete = False

    payload = message.get("payload", "")
    await agent.ws.send({
        "type": "agent_log",
        "log_type": "system",
        "message": f'에이전트 루프 시작: "{payload}"',
    })
    agent.agent_task = asyncio.create_task(agent.run_agent_loop(payload))


async def _on_stop_agent(agent: SafariAgentSession, _message: dict):
    await _cancel_agent(agent)
    agent.ws.reset()
    agent.mission_complete = False
    await agent.ws.send({"type": "agent_log", "log_type": "system", "message": "유저가 에이전트를 중단했습니다."})
    await agent.ws.send({"type": "agent_done"})


EVENT_HANDLERS = {
    "USER_COMMAND": _on_user_command,
    "STOP_AGENT": _on_stop_agent,
}


# --- WebSocket 진입점 ---

async def handle_vision_safari(websocket: WebSocket):
    ws = WebSocketBridge(websocket)
    agent = SafariAgentSession(ws)

    try:
        async for message in ws:
            handler = EVENT_HANDLERS.get(message.get("event"))
            if handler:
                await handler(agent, message)
    finally:
        await _cancel_agent(agent)
