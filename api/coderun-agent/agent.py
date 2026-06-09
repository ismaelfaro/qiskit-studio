# Copyright contributors to the Qiskit Studio project
# SPDX-License-Identifier: Apache-2.0

from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
import uvicorn
import socket
import argparse
import subprocess
import sys
import os
import asyncio
import logging
import json
from json.decoder import JSONDecodeError
import re

# Global variable to control execution mode
LOCAL_MODE = True

# Hard limits for sandboxed user-code execution.
EXEC_TIMEOUT_SECONDS = int(os.environ.get("CODERUN_TIMEOUT_SECONDS", str(30 * 60)))
EXEC_MEMORY_BYTES = int(os.environ.get("CODERUN_MEMORY_BYTES", str(2 * 1024 * 1024 * 1024)))
EXEC_CPU_SECONDS = int(os.environ.get("CODERUN_CPU_SECONDS", str(30 * 60)))

# Optional shared-secret auth. When CODERUN_API_KEY is set, every /run request
# must carry it in the `X-API-Key` header. Unset = open (local dev only).
API_KEY = os.environ.get("CODERUN_API_KEY")

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

if not API_KEY:
    logger.warning(
        "CODERUN_API_KEY is not set: the /run endpoint is UNAUTHENTICATED. "
        "Set it (and bind to 127.0.0.1) outside trusted local development."
    )

app = FastAPI()


def require_api_key(request: Request) -> None:
    """Reject requests lacking the shared secret, when one is configured."""
    if not API_KEY:
        return
    provided = request.headers.get("x-api-key")
    if not provided or not _constant_time_eq(provided, API_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


def _constant_time_eq(a: str, b: str) -> bool:
    import hmac

    return hmac.compare_digest(a, b)


# CORS — origins come from CORS_ALLOW_ORIGINS (comma-separated), matching the
# other agents. Defaults to the local frontend. No wildcard + credentials combo.
_cors_origins = [
    o.strip()
    for o in os.environ.get("CORS_ALLOW_ORIGINS", "http://localhost:3000").split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Key"],
)

# Add exception handler for JSON decode errors
@app.exception_handler(JSONDecodeError)
async def json_decode_exception_handler(request: Request, exc: JSONDecodeError):
    return JSONResponse(
        status_code=400,
        content={"detail": "Invalid JSON format in request body"},
    )


def replace_ibm_quantum_config(code: str, ibm_config: dict = None) -> str:
    """Replace IBM Quantum Config section based on execution mode and IBM config."""

    # If IBM config is provided, use IBM Quantum Runtime Service
    if ibm_config and ibm_config.get("token"):
        token = ibm_config["token"]
        channel = ibm_config.get("channel", "ibm_quantum")
        instance = ibm_config.get("instance")
        region = ibm_config.get("region")

        logger.info("IBM config provided. Injecting token (value redacted).")
        logger.info(
            f"Channel: {channel}, Instance: {'yes' if instance else 'no'}, Region: {region or 'none'}"
        )

        # Pattern to match AerSimulator config (if switching from local to cloud)
        aer_pattern = r"from qiskit_aer import AerSimulator\n\nbackend = AerSimulator\(\)\nprint\(\"Using local simulator\.\.\.\"\)"

        # Pattern to match IBM Quantum imports and backend setup (without token)
        ibm_pattern_no_token = r"from qiskit_ibm_runtime import QiskitRuntimeService\n\nservice = QiskitRuntimeService\(\)\nbackend = service\.least_busy\(operational=True, simulator=False\)"

        # Pattern to match IBM Quantum imports and backend setup (with existing token)
        ibm_pattern_with_token = r"from qiskit_ibm_runtime import QiskitRuntimeService\n\nservice = QiskitRuntimeService\(token='[^']+'\)\nbackend = service\.least_busy\(operational=True, simulator=False\)"

        # Build service initialization parameters
        service_params = [f'channel="{channel}"', f'token="{token}"']

        if instance:
            service_params.append(f'instance="{instance}"')

        if region:
            service_params.append(f'region="{region}"')

        service_params_str = ",\n    ".join(service_params)

        # Replacement text with IBM Quantum Runtime Service and full config
        replacement = f"""from qiskit_ibm_runtime import QiskitRuntimeService

# Initialize IBM Quantum Runtime Service with provided configuration
service = QiskitRuntimeService(
    {service_params_str}
)
backend = service.least_busy(operational=True, simulator=False)
print(f"Using IBM Quantum backend: {{backend.name}}")"""

        # Replace AerSimulator with IBM Quantum if found
        if re.search(aer_pattern, code, re.DOTALL):
            logger.info("Found AerSimulator config, replacing with IBM Quantum config.")
            return re.sub(aer_pattern, replacement, code, flags=re.DOTALL)

        # Replace existing IBM Quantum config (without token) to include token
        if re.search(ibm_pattern_no_token, code, re.DOTALL):
            logger.info("Found IBM Quantum config without token, injecting token.")
            return re.sub(ibm_pattern_no_token, replacement, code, flags=re.DOTALL)

        # Replace existing IBM Quantum config (with token) to update token
        if re.search(ibm_pattern_with_token, code, re.DOTALL):
            logger.info("Found IBM Quantum config with existing token, updating it.")
            return re.sub(ibm_pattern_with_token, replacement, code, flags=re.DOTALL)

        # If no exact patterns found, try to find and inject token into existing QiskitRuntimeService calls
        if "QiskitRuntimeService()" in code:
            logger.info("Found generic 'QiskitRuntimeService()', injecting parameters.")
            modified_code = code.replace(
                "QiskitRuntimeService()",
                f"QiskitRuntimeService(\n    {service_params_str}\n)",
            )
            return modified_code

        logger.info(
            "No specific IBM Quantum pattern matched for token injection. Returning original code."
        )
        return code

    # Only replace with local simulator if LOCAL_MODE is True and no token provided
    if not LOCAL_MODE:
        logger.info(
            "Cloud mode is active and no token provided. No code replacement will be performed."
        )
        return code

    logger.info(
        "No token provided and local mode is active. Attempting to replace IBM Quantum config with local simulator."
    )

    # Replacement text with local simulator
    replacement = """from qiskit_aer import AerSimulator

backend = AerSimulator()
print("Using local simulator...")"""

    # Find the IBM Quantum Config section
    ibm_config_pattern = r"## STEP 0 : IBM Quantum Config"
    if re.search(ibm_config_pattern, code):
        logger.info("Found IBM Quantum Config section header.")

        # Split the code into sections based on "## STEP" markers
        sections = re.split(r"(## STEP \d+.*?\n)", code)

        # If we have at least 3 elements (before STEP 0, STEP 0 marker, STEP 0 content)
        if len(sections) >= 3:
            # Replace the content of STEP 0 with our simulator code
            for i in range(1, len(sections), 2):
                if "STEP 0" in sections[i] and "IBM Quantum Config" in sections[i]:
                    # Replace the content (which is in the next section)
                    sections[i+1] = "\n" + replacement + "\n\n"
                    break

            # Join the sections back together
            modified_code = "".join(sections)

            # Remove all IBM Runtime specific options
            logger.info("Removing any remaining IBM Runtime options from code.")
            modified_code = re.sub(r".*?\.options\..*?\n", "", modified_code)

            return modified_code

    # If we didn't find a structured IBM Quantum Config section, try the old patterns
    ibm_patterns = [
        r"from qiskit_ibm_runtime import QiskitRuntimeService\n\nservice = QiskitRuntimeService\(token='[^']+'\)\nbackend = service\.least_busy\(operational=True, simulator=False\)\nprint\(f\"Using IBM Quantum backend: {[^}]+}\"\)",
        r"from qiskit_ibm_runtime import QiskitRuntimeService\n\nservice = QiskitRuntimeService\(\)\nbackend = service\.least_busy\(operational=True, simulator=False\)",
    ]

    # Try each pattern
    for i, pattern in enumerate(ibm_patterns):
        if re.search(pattern, code, re.DOTALL):
            logger.info(
                f"Matched IBM Quantum pattern #{i + 1}. Replacing with local simulator."
            )
            modified_code = re.sub(pattern, replacement, code, flags=re.DOTALL)
            # Remove all IBM Runtime specific options
            logger.info("Removing any remaining IBM Runtime options from code.")
            modified_code = re.sub(r".*?\.options\..*?\n", "", modified_code)
            return modified_code

    logger.info(
        "No IBM Quantum patterns matched for local simulator replacement. Returning original code."
    )
    return code


def _apply_resource_limits() -> None:
    """preexec_fn for the sandbox subprocess: start a new session (so the child
    can't signal the parent) and cap CPU time, address space, and core dumps.

    Limits are best-effort: some platforms (notably macOS) reject RLIMIT_AS, so
    each is applied independently and failures are ignored. On Linux containers
    — the production target — all three are enforced.
    """
    import resource

    try:
        os.setsid()
    except OSError:
        pass
    for res, limit in (
        (resource.RLIMIT_CPU, EXEC_CPU_SECONDS),
        (resource.RLIMIT_AS, EXEC_MEMORY_BYTES),
        (resource.RLIMIT_CORE, 0),
    ):
        try:
            resource.setrlimit(res, (limit, limit))
        except (ValueError, OSError):
            pass


def execute_python_code(code: str, ibm_config: dict = None) -> str:
    """Execute user code in an isolated subprocess and capture stdout/stderr.

    The code runs in a fresh `python -I` interpreter (isolated mode: ignores
    PYTHON* env vars and the user site dir) with a scrubbed environment, CPU/
    memory rlimits, and a wall-clock timeout. This contains the blast radius of
    untrusted code far better than an in-process exec(), which shared this
    server's interpreter state, builtins, and full privileges.

    NOTE: this does not block network access. For untrusted multi-tenant use,
    run this service inside a network-isolated sandbox (nsjail/gVisor/container
    with no egress).
    """
    logger.info("Beginning code execution process.")
    # Replace IBM Quantum Config section automatically
    code = replace_ibm_quantum_config(code, ibm_config)
    logger.info("Code transformation complete. Preparing isolated execution.")

    # Minimal environment: keep PATH and IBM-runtime needs, drop everything else
    # (e.g. CODERUN_API_KEY, OPENAI_API_KEY) so user code cannot read our secrets.
    clean_env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": os.environ.get("HOME", "/tmp"),
        "LANG": os.environ.get("LANG", "C.UTF-8"),
    }

    try:
        logger.info("Executing user-provided code in isolated subprocess.")
        proc = subprocess.run(
            [sys.executable, "-I", "-"],
            input=code,
            capture_output=True,
            text=True,
            timeout=EXEC_TIMEOUT_SECONDS,
            env=clean_env,
            preexec_fn=_apply_resource_limits,
        )
        logger.info("Finished executing user-provided code (rc=%s).", proc.returncode)

        output = (proc.stdout or "") + (proc.stderr or "")
        return output if output else "Code executed successfully (no output)"

    except subprocess.TimeoutExpired:
        logger.warning("User code execution timed out.")
        return f"Error: Code execution timed out after {EXEC_TIMEOUT_SECONDS} seconds."
    except Exception as e:
        logger.error("An exception occurred launching user code.", exc_info=True)
        return f"Error executing code: {str(e)}"


@app.post("/run")
async def run_program(request: Request, _auth: None = Depends(require_api_key)):
    logger.info("Received /run request from %s.", request.client.host)
    data = await request.json()
    if not isinstance(data, dict) or "input_value" not in data:
        raise HTTPException(status_code=400, detail="Missing 'input_value'")
    code = data["input_value"]
    if not isinstance(code, str):
        raise HTTPException(status_code=400, detail="'input_value' must be a string")

    ibm_token = data.get("ibm_token")  # Optional IBM Quantum token
    channel = data.get("channel", "ibm_quantum")  # Default to ibm_quantum
    instance = data.get("instance")  # Optional instance CRN
    region = data.get("region")  # Optional region

    # Create IBM config object
    ibm_config = (
        {"token": ibm_token, "channel": channel, "instance": instance, "region": region}
        if ibm_token
        else None
    )

    if ibm_config:
        logger.info("Request includes IBM Quantum configuration.")
    else:
        logger.info(
            "Request does not include IBM Quantum configuration; will use local simulator if agent is in local mode."
        )
    logger.info("Dispatching code execution to a background thread.")

    try:
        # Execute the blocking Python code in a separate thread to avoid freezing the event loop.
        # This prevents timeouts from upstream components like load balancers.
        # A 30-minute timeout is also applied to the execution itself.
        loop = asyncio.get_running_loop()
        timeout_seconds = 30 * 60  # 30 minutes

        output = await asyncio.wait_for(
            loop.run_in_executor(None, execute_python_code, code, ibm_config),
            timeout=timeout_seconds,
        )
        logger.info("Background execution task completed successfully.")
    except asyncio.TimeoutError:
        output = (
            f"Error: Code execution timed out after {timeout_seconds / 60:.0f} minutes."
        )
        logger.warning("Background execution task timed out.")

    logger.info("Sending response for /run request from %s.", request.client.host)
    # Fix for escaped newlines in chemistry simulation output
    # Replace any double escaped newlines with actual newlines
    if output and isinstance(output, str):
        output = output.replace('\\\\n', '\n')
    return JSONResponse({"output": output})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Run the FastAPI app with a custom port."
    )
    parser.add_argument(
        "--port", type=int, default=8000, help="Port to run the server on"
    )
    parser.add_argument(
        "--host",
        default=os.environ.get("CODERUN_HOST", "127.0.0.1"),
        help="Interface to bind (default 127.0.0.1; use 0.0.0.0 in containers)",
    )
    parser.add_argument(
        "--local",
        action="store_true",
        default=False,
        help="Enable local mode (replace IBM Quantum with AerSimulator)",
    )
    parser.add_argument(
        "--cloud",
        action="store_true",
        default=False,
        help="Enable cloud mode (use QiskitRuntimeService)",
    )
    args = parser.parse_args()

    # Set execution mode based on arguments
    if args.cloud:
        LOCAL_MODE = False
        logger.info("Starting in CLOUD mode - using QiskitRuntimeService")
    else:
        # Default behavior
        LOCAL_MODE = True
        logger.info("Starting in LOCAL mode (default) - replacing with AerSimulator")

    uvicorn.run(app, host=args.host, port=args.port)
