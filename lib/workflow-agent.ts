/**
 * Copyright contributors to the Qiskit Studio project
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Workflow Agent: turns a natural-language request into a Qiskit Studio
 * canvas workflow (ReactFlow nodes + edges) by prompting an LLM agent with
 * JSON examples of the node/workflow schema plus the user's instruction.
 */

import type { Node, Edge } from "reactflow"
import { getDemoById } from "./demo-circuits"
import { debugLog, debugError } from "./debug"

export interface GeneratedWorkflow {
  nodes: Node[]
  edges: Edge[]
}

export interface WorkflowAgentResult {
  success: boolean
  workflow?: GeneratedWorkflow
  error?: string
  /** The raw text returned by the agent, useful for debugging failures. */
  raw?: string
}

/** Node types the canvas knows how to render (see quantum-composer nodeTypes). */
export const SUPPORTED_NODE_TYPES = [
  "quantumInfoNode",
  "circuitLibraryNode",
  "transpilerNode",
  "transpilerPassNode",
  "executionNode",
  "runtimeNode",
  "visualizationNode",
  "chemistryMapNode",
  "chemistryNode",
  "pythonNode",
  "postProcessNode",
] as const

/**
 * Strip runtime-only fields (callbacks, transient flags) from a node so the
 * example we show the LLM only contains the serializable schema.
 */
function sanitizeNode(node: Node): Node {
  const {
    onInputChange,
    onParameterChange,
    isUpdating,
    ...data
  } = (node.data ?? {}) as Record<string, unknown>
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    data,
  } as Node
}

/**
 * Build a compact, valid example workflow from a bundled demo to teach the
 * LLM the exact JSON shape it must return.
 */
function buildExampleWorkflow(): GeneratedWorkflow {
  const demo = getDemoById("chemistry-simulation")
  if (!demo) return { nodes: [], edges: [] }
  return {
    nodes: demo.nodes.map(sanitizeNode),
    edges: demo.edges,
  }
}

/**
 * Construct the full prompt sent to the agent.
 */
export function buildWorkflowPrompt(
  userInput: string,
  current?: GeneratedWorkflow,
): string {
  const example = buildExampleWorkflow()

  const currentBlock = current && current.nodes.length > 0
    ? `\nThe user's CURRENT workflow on the canvas is:\n\`\`\`json\n${JSON.stringify(
        { nodes: current.nodes.map(sanitizeNode), edges: current.edges },
        null,
        2,
      )}\n\`\`\`\n`
    : ""

  return `You are a Qiskit Studio workflow generator. You design quantum computing
workflows as a graph of nodes and edges that render on a visual canvas.

The only valid node "type" values are:
${SUPPORTED_NODE_TYPES.map((t) => `  - ${t}`).join("\n")}

Each node has: a unique string "id", a "type" from the list above, a
"position" {x, y} (lay nodes left-to-right in columns ~350px apart, top-to-bottom
~250px apart, grouped by Qiskit pattern step: map -> optimize -> execute ->
post-process), and a "data" object with at least a "label" and "category".

Each edge has: a unique string "id", a "source" node id, a "target" node id,
and should use "type": "smoothstep" with "animated": true.

Here is a complete, valid EXAMPLE workflow (use it only to learn the JSON shape):
\`\`\`json
${JSON.stringify(example, null, 2)}
\`\`\`
${currentBlock}
USER REQUEST:
"${userInput}"

Respond with ONLY a single JSON object of the form {"nodes": [...], "edges": [...]}.
Do not include any explanation, comments, or markdown fences.`
}

/**
 * Extract a JSON object from possibly-noisy LLM text (handles ```json fences
 * and surrounding prose by locating the outermost braces).
 */
function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text

  const start = candidate.indexOf("{")
  const end = candidate.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in agent response")
  }
  return JSON.parse(candidate.slice(start, end + 1))
}

/**
 * Validate and normalize a parsed object into a GeneratedWorkflow, throwing a
 * descriptive error if it does not match the expected schema.
 */
export function validateWorkflow(parsed: unknown): GeneratedWorkflow {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Agent response is not a JSON object")
  }
  const obj = parsed as { nodes?: unknown; edges?: unknown }
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) {
    throw new Error("Agent response must contain 'nodes' and 'edges' arrays")
  }

  const validTypes = new Set<string>(SUPPORTED_NODE_TYPES)
  const seenIds = new Set<string>()

  const nodes: Node[] = obj.nodes.map((raw, i) => {
    const n = raw as Partial<Node> & { data?: Record<string, unknown> }
    if (!n.id || typeof n.id !== "string") {
      throw new Error(`Node ${i} is missing a string "id"`)
    }
    if (seenIds.has(n.id)) {
      throw new Error(`Duplicate node id "${n.id}"`)
    }
    seenIds.add(n.id)
    if (!n.type || !validTypes.has(n.type)) {
      throw new Error(`Node "${n.id}" has unsupported type "${n.type}"`)
    }
    const position =
      n.position && typeof n.position.x === "number" && typeof n.position.y === "number"
        ? n.position
        : { x: 50 + (i % 4) * 350, y: 50 + Math.floor(i / 4) * 250 }
    return {
      id: n.id,
      type: n.type,
      position,
      data: { label: n.id, ...(n.data ?? {}) },
    } as Node
  })

  const edges: Edge[] = obj.edges
    .map((raw, i) => {
      const e = raw as Partial<Edge>
      if (!e.source || !e.target) return null
      if (!seenIds.has(e.source) || !seenIds.has(e.target)) return null
      return {
        id: e.id || `e-${e.source}-${e.target}-${i}`,
        source: e.source,
        target: e.target,
        type: e.type || "smoothstep",
        animated: e.animated ?? true,
        style: e.style ?? { stroke: "#2563EB" },
      } as Edge
    })
    .filter((e): e is Edge => e !== null)

  if (nodes.length === 0) {
    throw new Error("Agent returned an empty workflow")
  }

  return { nodes, edges }
}

/**
 * Call the workflow agent and return a validated workflow.
 */
export async function generateWorkflow(
  userInput: string,
  current?: GeneratedWorkflow,
): Promise<WorkflowAgentResult> {
  const url =
    process.env.NEXT_PUBLIC_WORKFLOW_API_URL || process.env.NEXT_PUBLIC_API_URL

  if (!url) {
    return {
      success: false,
      error:
        "Workflow agent URL not configured. Set NEXT_PUBLIC_WORKFLOW_API_URL or NEXT_PUBLIC_API_URL in .env.local",
    }
  }

  const prompt = buildWorkflowPrompt(userInput, current)
  debugLog("API", "Workflow agent prompt built", { length: prompt.length })

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input_value: prompt,
        output_type: "chat",
        input_type: "chat",
        session_id: "workflow-agent",
        prompt,
      }),
    })

    if (!response.ok) {
      throw new Error(`Workflow agent request failed with status ${response.status}`)
    }

    const result = await response.json()
    const text: string = result.response
      ? JSON.parse(result.response)["final_prompt"]
      : result.output
    if (!text) {
      throw new Error("Empty response from workflow agent")
    }

    const workflow = validateWorkflow(extractJsonObject(text))
    debugLog("API", "Workflow agent produced workflow", {
      nodes: workflow.nodes.length,
      edges: workflow.edges.length,
    })
    return { success: true, workflow, raw: text }
  } catch (error) {
    debugError("API", "Workflow agent failed", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
