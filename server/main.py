import json
import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from typing import List, Dict, Any, Callable
from dotenv import load_dotenv

# .env 파일 로드
load_dotenv()

from handlers.vision_safari import handle_vision_safari

app = FastAPI()

GAME_HANDLERS: Dict[str, Callable] = {
    "vision-safari": handle_vision_safari,
}

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"New client connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print(f"Client disconnected. Total: {len(self.active_connections)}")

manager = ConnectionManager()

@app.websocket("/ws/{game_id}")
async def websocket_endpoint(websocket: WebSocket, game_id: str):
    await manager.connect(websocket)

    handler = GAME_HANDLERS.get(game_id)
    if not handler:
        await websocket.send_text(json.dumps({"error": f"No handler for {game_id}"}))
        await websocket.close()
        manager.disconnect(websocket)
        return
    try:
        await handler(websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"Error in {game_id} session: {e}")
        manager.disconnect(websocket)

if __name__ == "__main__":
    import uvicorn
    # 환경 변수에서 포트 가져오기 (기본값 8000)
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
