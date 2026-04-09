# pip install langgraph langchain-core langchain-openai mlflow fastapi uvicorn matplotlib

from __future__ import annotations

import io
import base64
import os
from typing import TypedDict, Annotated, Any

from pathlib import Path
import mlflow
from mlflow import MlflowClient
from mlflow.artifacts import download_artifacts
import matplotlib.pyplot as plt

from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langchain_core.tools import tool
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import InMemorySaver  


from dotenv import load_dotenv

load_dotenv()

# -------------------------
# Config
# -------------------------

MLFLOW_TRACKING_URI = os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5.4")
MLFLOW_URL = os.getenv("MLFLOW_URL", "")

mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
ml_client = MlflowClient(tracking_uri=MLFLOW_TRACKING_URI)

llm = ChatOpenAI(model=OPENAI_MODEL)


# -------------------------
# Graph state
# -------------------------

class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    run_id: str


# -------------------------
# Tools
# -------------------------

@tool
def get_run(run_id: str) -> dict[str, Any]:
    """Get MLflow run metadata, params, latest metrics, and tags."""
    run = ml_client.get_run(run_id)
    return {
        "run_id": run.info.run_id,
        "experiment_id": run.info.experiment_id,
        "status": run.info.status,
        "params": dict(run.data.params),
        "metrics": dict(run.data.metrics),
        "tags": dict(run.data.tags),
    }


@tool
def get_metric_history(run_id: str, metric_key: str) -> list[dict[str, Any]]:
    """Get the metric history for a run and metric key."""
    hist = ml_client.get_metric_history(run_id, metric_key)
    return [{"step": m.step, "value": m.value, "timestamp": m.timestamp} for m in hist]


@tool
def search_runs_in_experiment(run_id: str, max_results: int = 10) -> list[dict[str, Any]]:
    """Find other runs in the same experiment as this run."""
    run = ml_client.get_run(run_id)
    experiment_id = run.info.experiment_id
    runs = ml_client.search_runs(
        experiment_ids=[experiment_id],
        max_results=max_results,
        order_by=["attributes.start_time DESC"],
    )
    return [
        {
            "run_id": r.info.run_id,
            "status": r.info.status,
            "params": dict(r.data.params),
            "metrics": dict(r.data.metrics),
            "tags": dict(r.data.tags),
        }
        for r in runs
    ]


@tool
def list_artifacts(run_id: str, path: str = "") -> list[str]:
    """List artifacts for a run recursively."""
    out = []

    def walk(p: str):
        for item in ml_client.list_artifacts(run_id, p):
            if item.is_dir:
                walk(item.path)
            else:
                out.append(item.path)

    walk(path)
    return out


@tool
def render_metric_plot(run_id: str, metric_key: str) -> str:
    """
    Render a metric history plot and return a base64 data URL.
    Useful for multimodal inspection by the model or the UI.
    """
    hist = ml_client.get_metric_history(run_id, metric_key)
    if not hist:
        return ""

    steps = [m.step for m in hist]
    values = [m.value for m in hist]

    fig, ax = plt.subplots(figsize=(6, 4))
    ax.plot(steps, values)
    ax.set_title(metric_key)
    ax.set_xlabel("step")
    ax.set_ylabel("value")
    ax.grid(True)

    buf = io.BytesIO()
    fig.tight_layout()
    fig.savefig(buf, format="png", dpi=150)
    plt.close(fig)

    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{b64}"


@tool
def list_artifacts(run_id: str, path: str = "") -> list[str]:
    """List artifacts for a run recursively."""
    out = []

    def walk(p: str):
        for item in ml_client.list_artifacts(run_id, p):
            if item.is_dir:
                walk(item.path)
            else:
                out.append(item.path)

    walk(path)
    return out


# Metric keys to try to pull history for.
# Add/remove based on what you actually log.
DEFAULT_METRIC_KEYS = [
    "train_loss",
    "val_loss",
    "reward",
    "eval_reward",
    "entropy",
    "kl",
    "ppo_loss",
    "learning_rate",
    "lr",
]

# Artifact path hints for sample completions / text outputs.
DEFAULT_ARTIFACT_HINTS = [
    "sample_completions.json",
    "sample_completions.jsonl",
    "generations.json",
    "generations.jsonl",
    "completions.json",
    "completions.jsonl",
    "samples.json",
    "samples.jsonl",
    "eval_samples.json",
    "eval_samples.jsonl",
    "outputs/sample_completions.json",
    "outputs/generations.json",
]

TEXT_EXTENSIONS = {".txt", ".log", ".json", ".jsonl", ".yaml", ".yml", ".md", ".csv"}

MAX_TEXT_ARTIFACTS = 8
MAX_CHARS_PER_ARTIFACT = 12000
MAX_COMPLETION_PREVIEW_CHARS = 16000
MAX_METRIC_POINTS = 200


def safe_read_text(path: Path, max_chars: int = MAX_CHARS_PER_ARTIFACT) -> str | None:
    try:
        return path.read_text(errors="ignore")[:max_chars]
    except Exception:
        return None


def download_and_read_artifact(
    run_id: str,
    artifact_path: str,
    max_chars: int = MAX_CHARS_PER_ARTIFACT,
) -> str | None:
    try:
        local_path = download_artifacts(run_id=run_id, artifact_path=artifact_path)
        return safe_read_text(Path(local_path), max_chars=max_chars)
    except Exception:
        return None

@tool
def read_text_artifacts(run_id: str, artifact_paths: list[str]) -> dict[str, str]:
    """
    Read a small number of text-like artifacts.
    """
    collected: dict[str, str] = {}
    count = 0

    for artifact_path in artifact_paths:
        if count >= MAX_TEXT_ARTIFACTS:
            break

        suffix = Path(artifact_path).suffix.lower()
        if suffix not in TEXT_EXTENSIONS:
            continue

        text = download_and_read_artifact(run_id, artifact_path)
        if text:
            collected[artifact_path] = text
            count += 1

    return collected


# def collect_completion_artifacts(run_id: str, artifact_paths: list[str]) -> dict[str, str]:
#     """
#     Try hard to find sample completion / generation artifacts.
#     Prefer likely filenames first, then fall back to fuzzy matching.
#     """
#     selected: list[str] = []

#     # Exact / hinted paths first
#     for hint in DEFAULT_ARTIFACT_HINTS:
#         if hint in artifact_paths:
#             selected.append(hint)

#     # Fuzzy fallback
#     if not selected:
#         for p in artifact_paths:
#             lower = p.lower()
#             if any(token in lower for token in ["completion", "generation", "sample", "output"]):
#                 if Path(p).suffix.lower() in TEXT_EXTENSIONS:
#                     selected.append(p)
#             if len(selected) >= 3:
#                 break

#     previews: dict[str, str] = {}
#     for p in selected[:3]:
#         text = download_and_read_artifact(run_id, p, max_chars=MAX_COMPLETION_PREVIEW_CHARS)
#         if text:
#             previews[p] = text

#     return previews


TOOLS = [
    get_run,
    get_metric_history,
    search_runs_in_experiment,
    list_artifacts,
    render_metric_plot,
    read_text_artifacts,
]

llm_with_tools = llm.bind_tools(TOOLS)


# -------------------------
# Nodes
# -------------------------

SYSTEM_PROMPT = f"""
You are an MLflow experiment assistant.

Answer questions about a run and its surrounding experiment.
Use tools when needed.
Do not invent metrics, artifacts, or comparisons.
When evidence is weak, say so.
Prefer comparing runs instead of judging a run in isolation.
Refer to all runs by their name, and not the run id.
Include links to any runs that you reference.
Make sure the links begin with {MLFLOW_URL}.
Your response should be brief.
Unless otherwise requested, give a diagonsis followed by suggested actions for improvement.
Format your response so that there is a clear delineation between sections.
""".strip()


def assistant_node(state: AgentState):
    msgs = state["messages"]

    if not msgs or not isinstance(msgs[0], SystemMessage):
        msgs = [SystemMessage(content=SYSTEM_PROMPT)] + msgs

    response = llm_with_tools.invoke(msgs)
    return {"messages": [response]}


def route_tools(state: AgentState):
    last = state["messages"][-1]
    if getattr(last, "tool_calls", None):
        return "tools"
    return END


from langgraph.prebuilt import ToolNode
tool_node = ToolNode(TOOLS)


# -------------------------
# Memory
# -------------------------

checkpointer = InMemorySaver()


# -------------------------
# Graph
# -------------------------

graph = StateGraph(AgentState)
graph.add_node("assistant", assistant_node)
graph.add_node("tools", tool_node)

graph.set_entry_point("assistant")
graph.add_conditional_edges("assistant", route_tools)
graph.add_edge("tools", "assistant")

app_graph = graph.compile(checkpointer=checkpointer)


# -------------------------
# Example invocation
# -------------------------

if __name__ == "__main__":
    from argparse import ArgumentParser
    parser = ArgumentParser()
    parser.add_argument("prompt", type=str)
    args = parser.parse_args()

    # prompt_default = f"Run ID is {run_id}. Compare this run to nearby runs in the experiment and tell me what likely improved or regressed."
    
    run_id = "YOUR_RUNID"
    
    prompt = f"Run ID is {run_id}. " + args.prompt

    result = app_graph.invoke(
        {
            "run_id": run_id,
            "messages": [
                HumanMessage(
                    content=prompt
                )
            ],
        }
    )

    for m in result["messages"]:
        print(type(m).__name__, getattr(m, "content", ""))