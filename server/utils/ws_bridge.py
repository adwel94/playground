import asyncio
import json
from typing import Dict
from fastapi import WebSocket


class WebSocketBridge:
    """Transparent WebSocket request/response bridge.

    - ``send(msg)``    : fire-and-forget
    - ``request(msg)`` : send and await the correlated response
    - ``async for msg in bridge`` : iterate over application messages
      (response messages are resolved internally and never surfaced)

    Usage::

        ws = WebSocketBridge(websocket)

        # In a background task — caller just awaits the result:
        response = await ws.request({"type": "capture_request"})

        # In the main loop — only application messages appear:
        async for message in ws:
            handle(message)
    """

    def __init__(self, websocket: WebSocket):
        self._ws = websocket
        self._counter = 0
        self._pending: Dict[int, asyncio.Future] = {}

    def _next_id(self) -> int:
        self._counter += 1
        return self._counter

    async def send(self, message: dict):
        """Fire-and-forget: send a JSON message to the client."""
        await self._ws.send_text(json.dumps(message))

    async def request(self, message: dict, *, timeout: float = 30.0) -> dict:
        """Send *message* and wait for the correlated response.

        A ``step_id`` is automatically injected into the message.
        The client must echo that ``step_id`` in its reply.
        """
        step_id = self._next_id()
        message["step_id"] = step_id

        future = asyncio.get_event_loop().create_future()
        self._pending[step_id] = future

        await self.send(message)
        try:
            return await asyncio.wait_for(future, timeout)
        finally:
            self._pending.pop(step_id, None)

    # --- async iterator ---------------------------------------------------
    # Reads every incoming WebSocket frame.  Messages whose ``step_id``
    # matches a pending ``request()`` are resolved silently; everything
    # else is yielded to the caller's ``async for`` loop.

    def __aiter__(self):
        return self

    async def __anext__(self) -> dict:
        while True:
            raw = await self._ws.receive_text()  # raises WebSocketDisconnect on close
            message = json.loads(raw)
            step_id = message.get("step_id")
            if step_id is not None and step_id in self._pending:
                future = self._pending[step_id]
                if not future.done():
                    future.set_result(message)
                continue
            return message

    # --- lifecycle helpers -------------------------------------------------

    def clear(self):
        """Cancel all pending requests."""
        for future in self._pending.values():
            if not future.done():
                future.cancel()
        self._pending.clear()

    def reset(self):
        """Clear pending requests and reset the step counter."""
        self.clear()
        self._counter = 0
