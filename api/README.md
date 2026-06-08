# Qiskit Studio Backend API

## Quick start with Docker Compose (recommended)

The fastest way to run the **entire stack** (frontend, all three agents, and the
RAG vector database) is the `docker-compose.yml` at the repository root. It
replaces the multi-terminal setup described further below with a single command.

Prerequisites:

- Docker (with the Compose plugin)
- An OpenAI-compatible LLM endpoint reachable from the containers. By default the
  stack targets a host-local [Ollama](https://ollama.com):
  ```bash
  ollama pull granite3.3:8b      # chat + codegen model
  ollama pull nomic-embed-text   # embeddings for RAG
  ```

Bring everything up from the repository root:

```bash
# optional: override defaults (ports, LLM URL, models, ...)
cp .env.docker.template .env

docker compose up --build
```

Services and ports:

| Service        | URL                          | Purpose                         |
| -------------- | ---------------------------- | ------------------------------- |
| frontend       | http://127.0.0.1:3000        | Qiskit Studio UI                |
| chat-agent     | http://127.0.0.1:8000/chat   | RAG-backed chat                 |
| codegen-agent  | http://127.0.0.1:8001/chat   | Parameter / code updates        |
| coderun-agent  | http://127.0.0.1:8002/run    | Executes Qiskit programs        |
| knowledge-mcp  | http://127.0.0.1:8030        | Vector-DB retrieval (RAG)       |
| milvus         | 127.0.0.1:19530 / :9091      | Vector database                 |

Populate the vector DB with Qiskit documentation (one-shot, run after the stack
is up so chat answers are grounded in the docs):

```bash
docker compose --profile preload run --rm preloader
```

> Note: On Linux, `host.docker.internal` is wired to the host gateway via
> `extra_hosts`, so the containers can reach an Ollama running on your machine.
> Point `OPENAI_BASE_URL` / `CUSTOM_EMBEDDING_URL` elsewhere in `.env` to use a
> remote LLM provider.

To run only the backend agents (no frontend), start the services you need, e.g.
`docker compose up --build chat-agent codegen-agent coderun-agent`.

## Getting Started (manual, without Compose)

### Agent Workflow API

The API is based on Maestro you can install it as follows (you need to have [uv installed](https://docs.astral.sh/uv/getting-started/installation/))

Clone this repository and switch to the api directory
```bash
git clone https://github.com/AI4quantum/qiskit-studio
cd qiskit-studio/api/
```

Create an `.env` file for each maestro agent by copying [`.env.template`](.env.template) into each agent directory
```bash
cp .env.template chat-agent/.env
cp .env.template codegen-agent/.env
```

Start each agent in separate terminals

```bash
cd chat-agent/
uv run maestro serve agents.yaml workflow.yaml
```

```bash
cd codegen-agent/
uv run maestro serve agents.yaml workflow.yaml --port 8001
```

```bash
cd coderun-agent/
uv run python agent.py --port 8002
```

Setup the vector database using maestro-knowledge
```bash
git clone https://github.com/AI4quantum/maestro-knowledge.git
cd maestro-knowledge
CUSTOM_EMBEDDING_URL=http://127.0.0.1:11434/v1 CUSTOM_EMBEDDING_MODEL=nomic-embed-text CUSTOM_EMBEDDING_VECTORSIZE=768 CUSTOM_EMBEDDING_API_KEY=dummy uv run ./start.sh
```

Populate the vector database for use by the chat agent
```bash
cd chat-agent/
uv run python scripts/add-rag-docs-remote-embed.py
```

### LLM

Be sure that you have installed [Ollama](ollama.com) or similar local LLM provider and download `granite3.3:8b`

You can change the endpoint in `.env` or switch this model for other by editing `agents.yaml` before starting maestro.

## Usage

After installing dependencies and starting the Maestro workflow servers, you can call the APIs at:

```
http://127.0.0.1:8000/chat # chat agent
http://127.0.0.1:8001/chat # code generation agent
http://127.0.0.1:8002/run  # coderun agent
```

## Building and running in Docker

Each agent has a Dockerfile and can be built and run with the following commands:

```bash
cd chat-agent/
docker build -t chat-agent:latest .
docker run -p 8000:8000 --env-file .env chat-agent:latest
```

```bash
cd codegen-agent/
docker build -t codegen-agent:latest .
docker run -p 8001:8000 --env-file .env codegen-agent:latest
```

Note: You may need to update the urls in `.env` and `chat-agent/agent.py` to use docker compatible endpoints.

## Running in Kubernetes

Follow the instructions in [charts/qiskit-studio/README.md](../../charts/qiskit-studio/README.md) to run the entire qiskit studio stack in a kubernetes cluster using a helm chart

## Creating new maestro workflows

Below is an example maestro agent with notes on different possible fields and values:

```yaml
apiVersion: maestro/v1alpha1
kind: Agent
metadata:
  name: llm-agent
  labels:
    app: qiskit-studio
spec:
  model: granite3.3:8b # add a 'ollama/' prefix when using dspy
  framework: openai # or dspy or beeai
  mode: local
  url: "http://localhost:11434" # http://host.docker.internal:11434 # only used by dspy
  description: Generates text using LLMs
  instructions: <instructions to add to the system prompt>
```
