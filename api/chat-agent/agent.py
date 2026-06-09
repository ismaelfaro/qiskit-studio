# Copyright contributors to the Qiskit Studio project
# SPDX-License-Identifier: Apache-2.0
#
# Lightweight LLM agent: a direct OpenAI-compatible (OpenRouter) chat endpoint,
# replacing the previous Maestro workflow server. Same HTTP contract the frontend
# expects: POST /chat -> {"output": "..."} and POST /chat/stream (SSE).
#
# Configured entirely from the environment:
#   OPENAI_BASE_URL     OpenAI-compatible base (default OpenRouter)
#   OPENAI_API_KEY      API key
#   LLM_MODEL           model slug (e.g. nex-agi/nex-n2-pro:free)
#   AGENT_MODE          "chat" (return prose) or "codegen" (extract python blocks)
#   SYSTEM_PROMPT       path to the system prompt file (default system-prompt.md)
#   CORS_ALLOW_ORIGINS  comma-separated allowed origins

import json
import os
import re

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

# Load a local .env (OPENAI_API_KEY, LLM_MODEL, ...) when present. In containers
# these come from the environment instead, so a missing file is fine.
load_dotenv()

OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "nex-agi/nex-n2-pro:free")
# Free models are shared and frequently rate-limited (429) or overloaded (502).
# Try the primary model first, then fall back through these in order.
LLM_FALLBACK_MODELS = [
    m.strip()
    for m in os.environ.get(
        "LLM_FALLBACK_MODELS",
        "google/gemma-4-31b-it:free,z-ai/glm-4.5-air:free,openai/gpt-oss-120b:free",
    ).split(",")
    if m.strip()
]
AGENT_MODE = os.environ.get("AGENT_MODE", "chat")  # "chat" | "codegen"
SYSTEM_PROMPT_FILE = os.environ.get("SYSTEM_PROMPT", "system-prompt.md")
CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get("CORS_ALLOW_ORIGINS", "http://localhost:3000").split(",")
    if o.strip()
]
REQUEST_TIMEOUT = float(os.environ.get("LLM_TIMEOUT_SECONDS", "120"))


def _load_system_prompt() -> str:
    try:
        with open(SYSTEM_PROMPT_FILE, "r", encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


SYSTEM_PROMPT = _load_system_prompt()

# Extract python code blocks (replaces the old codegen regex-extractor step).
_PY_BLOCK = re.compile(r"```python\s*\n([\s\S]*?)\n```")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


def _extract_code(text: str) -> str:
    matches = [m for m in _PY_BLOCK.findall(text) if m]
    return "\n".join(matches) if matches else text


def _format_output(content: str) -> str:
    return _extract_code(content) if AGENT_MODE == "codegen" else content


def _prompt_from(body: dict) -> str:
    prompt = body.get("input_value") or body.get("prompt")
    if not isinstance(prompt, str) or not prompt.strip():
        raise HTTPException(status_code=400, detail="Missing 'input_value'/'prompt'")
    return prompt


def _messages(prompt: str) -> list:
    msgs = []
    if SYSTEM_PROMPT.strip():
        msgs.append({"role": "system", "content": SYSTEM_PROMPT})
    msgs.append({"role": "user", "content": prompt})
    return msgs


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }


async def _try_model(client: httpx.AsyncClient, model: str, prompt: str):
    """Return (text, None) on success, or (None, error_str) on failure."""
    resp = await client.post(
        f"{OPENAI_BASE_URL}/chat/completions",
        headers=_headers(),
        json={"model": model, "messages": _messages(prompt)},
    )
    if resp.status_code != 200:
        return None, f"{model}: HTTP {resp.status_code} {resp.text[:200]}"
    try:
        data = resp.json()
    except ValueError:
        return None, f"{model}: non-JSON {resp.text[:200]}"
    # OpenRouter can return HTTP 200 with an error body (rate limit, model pulled,
    # moderation) and no choices — treat that as a failure and fall back.
    choices = data.get("choices")
    if not choices:
        return None, f"{model}: {json.dumps(data.get('error') or data)[:200]}"
    return (choices[0].get("message") or {}).get("content") or "", None


async def _complete(prompt: str) -> str:
    """Call the LLM, falling back through LLM_FALLBACK_MODELS on 429/502/no-choices."""
    errors = []
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        for model in [LLM_MODEL, *LLM_FALLBACK_MODELS]:
            text, err = await _try_model(client, model, prompt)
            if err is None:
                return text
            errors.append(err)
    raise HTTPException(
        status_code=502, detail="All models failed: " + " | ".join(errors)
    )


@app.post("/chat")
async def chat(request: Request):
    body = await request.json()
    prompt = _prompt_from(body)
    content = await _complete(prompt)
    return JSONResponse({"output": _format_output(content)})


@app.post("/chat/stream")
async def chat_stream(request: Request):
    body = await request.json()
    prompt = _prompt_from(body)

    # The frontend renders the first llm_step event's text in full (it simulates
    # the typing effect client-side), so emit one complete event, not token deltas.
    async def event_stream():
        try:
            content = _format_output(await _complete(prompt))
        except HTTPException as exc:
            content = f"Error: {exc.detail}"
        event = {"step_name": "llm_step", "step_result": content}
        yield f"data: {json.dumps(event)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/health")
async def health():
    return {"status": "ok", "mode": AGENT_MODE, "model": LLM_MODEL}
