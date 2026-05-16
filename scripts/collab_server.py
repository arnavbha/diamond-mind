"""Local collaboration server for Track A / Track B agent communication.

Run with:
    uvicorn scripts.collab_server:app --port 8765

Agents send messages via:
    curl -s -X POST http://localhost:8765/send \
      -H "Content-Type: application/json" \
      -d '{"from": "jack", "message": "your message here"}'

Poll for new messages via:
    curl -s "http://localhost:8765/messages?since=0"
"""

from datetime import datetime
from typing import List

from fastapi import FastAPI, Query
from pydantic import BaseModel, Field

app = FastAPI(title="diamond-mind collab", docs_url="/")

_messages: List[dict] = []
_next_id: int = 1


class Outgoing(BaseModel):
    model_config = {"populate_by_name": True}

    from_: str = Field(alias="from")
    message: str


@app.post("/send")
def send(payload: Outgoing):
    global _next_id
    entry = {
        "id": _next_id,
        "from": payload.from_,
        "message": payload.message,
        "at": datetime.now().strftime("%H:%M:%S"),
    }
    _messages.append(entry)
    _next_id += 1
    return entry


@app.get("/messages")
def messages(since: int = Query(default=0)):
    return [m for m in _messages if m["id"] > since]
