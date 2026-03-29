# server.py
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from langchain_core.messages import HumanMessage

from graph import app_graph  # import your compiled graph
from dotenv import load_dotenv

load_dotenv()
MLFLOW_URL = os.getenv("URL", "")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        MLFLOW_URL,
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    run_id: str
    message: str


class ChatResponse(BaseModel):
    answer: str
    run_id: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    try:
        result = app_graph.invoke(
            {
                "run_id": req.run_id,
                "messages": [
                    HumanMessage(
                        content=f"Run ID is {req.run_id}. {req.message}"
                    )
                ],
            },
            {
                "configurable": {
                    "thread_id": "1"
                }
            },
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Grab the final assistant message
    answer = ""
    for msg in reversed(result["messages"]):
        content = getattr(msg, "content", None)
        if isinstance(content, str) and content.strip():
            answer = content
            break

    return ChatResponse(answer=answer, run_id=req.run_id)