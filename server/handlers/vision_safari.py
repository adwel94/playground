import asyncio
import json
import os
from fastapi import WebSocket
from typing import Dict, Any, List

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from langchain.memory import ConversationBufferMemory
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from pydantic import BaseModel, Field

# --- 에이전트가 사용할 도구(Action)의 스키마 정의 ---
class MoveAction(BaseModel):
    """Move the player in the game grid."""
    direction: str = Field(description="The direction to move: 'UP', 'DOWN', 'LEFT', 'RIGHT'")
    steps: int = Field(default=1, description="Number of tiles to move")
    reason: str = Field(description="Why this move is chosen based on visual analysis")

class IdleAction(BaseModel):
    """Stop moving when the goal is reached or no move is possible."""
    reason: str = Field(description="Why the agent is stopping")

# --- 에이전트 세션 관리 클래스 ---
class SafariAgentSession:
    def __init__(self):
        self.llm = ChatGoogleGenerativeAI(
            model="gemini-2.0-flash-exp",
            temperature=0
        )
        # 1. Memory 구성
        self.memory = ConversationBufferMemory(return_messages=True)
        
        # 2. Tool Binding (Structured Output)
        # 모델이 MoveAction 또는 IdleAction 중 하나를 선택하도록 강제
        self.agent_with_tools = self.llm.bind_tools([MoveAction, IdleAction])
        
        self.last_image_data = None
        self.current_goal = ""

    async def decide_next_action(self, user_command: str, image_base64: str) -> Dict[str, Any]:
        self.current_goal = user_command
        
        # 시스템 프롬프트 구성
        system_prompt = """
        You are an AI Game Agent in 'Vision Safari'. 
        You see a grid with:
        - 'P' (Player, Blue Circle)
        - '🌲' (Obstacles, Trees)
        - Animals on colors (Targets)
        
        Goal: Navigate the Player to the target mentioned by the user.
        Rule: Avoid trees. Move step by step.
        """

        # 이미지 데이터 처리
        if "," in image_base64:
            image_base64 = image_base64.split(",")[1]

        # 메시지 구성 (Memory + Current Vision)
        messages = [
            SystemMessage(content=system_prompt),
            *self.memory.chat_memory.messages,
            HumanMessage(content=[
                {"type": "text", "text": f"Current Goal: {user_command}\nDecide your next move based on this screenshot."},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_base64}"}}
            ])
        ]

        # 모델 호출
        response = await self.agent_with_tools.ainvoke(messages)
        
        # Tool Call 결과 해석
        if response.tool_calls:
            tool_call = response.tool_calls[0]
            action_name = tool_call["name"]
            args = tool_call["args"]
            
            # 메모리에 에이전트의 결정 저장
            self.memory.chat_memory.add_user_message(f"Action taken: {action_name} with args {args}")
            self.memory.chat_memory.add_ai_message(f"Decision reason: {args.get('reason')}")
            
            return {"action": action_name.upper(), **args}
        
        return {"action": "IDLE", "reason": "No clear tool call generated."}

# --- 글로벌 세션 저장소 ---
agent_sessions: Dict[str, SafariAgentSession] = {}

async def handle_vision_safari(websocket: WebSocket, message: Dict[str, Any]):
    session_id = str(hash(websocket))
    if session_id not in agent_sessions:
        agent_sessions[session_id] = SafariAgentSession()
    
    agent = agent_sessions[session_id]
    event_type = message.get("event")

    if event_type == "USER_COMMAND":
        # 사용자가 명령을 내리면 메모리에 저장하고 관찰 시작
        user_payload = message.get("payload")
        agent.current_goal = user_payload
        agent.memory.chat_memory.add_user_message(f"New User Goal: {user_payload}")
        await websocket.send_text(json.dumps({"action": "CAPTURE_SCREEN"}))
        
    elif event_type == "SCREEN_DATA":
        image_data = message.get("image")
        
        # 에이전트가 판단
        decision = await agent.decide_next_action(agent.current_goal, image_data)
        
        # 클라이언트에 명령 전송
        if decision["action"] == "MOVEACTION": # Pydantic 클래스명이 소문자로 올 수 있음
            await websocket.send_text(json.dumps({
                "action": "MOVE",
                "direction": decision["direction"],
                "steps": decision.get("steps", 1)
            }))
        else:
            await websocket.send_text(json.dumps({"action": "IDLE", "reason": decision.get("reason")}))
        
    elif event_type == "MOVE_COMPLETE":
        # 이동이 완료되면 메모리에 결과 업데이트
        pos = message.get("pos")
        agent.memory.chat_memory.add_user_message(f"Movement complete. Current position: {pos}")
        
        # 여기서 자동으로 다음 CAPTURE_SCREEN을 보내면 "연속적인 에이전트 행동"이 가능해집니다.
        # print(f"[Vision Safari] Agent moved to {pos}, continuing goal...")
        # await websocket.send_text(json.dumps({"action": "CAPTURE_SCREEN"}))
