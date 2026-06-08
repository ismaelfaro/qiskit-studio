/**
 * Copyright contributors to the Qiskit Studio project
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest"
import {
  validateWorkflow,
  buildWorkflowPrompt,
  SUPPORTED_NODE_TYPES,
} from "./workflow-agent"

describe("validateWorkflow", () => {
  const validNode = {
    id: "n1",
    type: "circuitLibraryNode",
    position: { x: 0, y: 0 },
    data: { label: "Circuit", category: "Basic" },
  }

  it("accepts a well-formed workflow", () => {
    const wf = validateWorkflow({ nodes: [validNode], edges: [] })
    expect(wf.nodes).toHaveLength(1)
    expect(wf.nodes[0].type).toBe("circuitLibraryNode")
  })

  it("keeps edges that reference existing nodes and drops dangling ones", () => {
    const wf = validateWorkflow({
      nodes: [
        validNode,
        { ...validNode, id: "n2", type: "runtimeNode" },
      ],
      edges: [
        { source: "n1", target: "n2" },
        { source: "n1", target: "ghost" },
      ],
    })
    expect(wf.edges).toHaveLength(1)
    expect(wf.edges[0].source).toBe("n1")
    expect(wf.edges[0].target).toBe("n2")
  })

  it("defaults edge id/type/animated when omitted", () => {
    const wf = validateWorkflow({
      nodes: [validNode, { ...validNode, id: "n2" }],
      edges: [{ source: "n1", target: "n2" }],
    })
    expect(wf.edges[0].id).toBeTruthy()
    expect(wf.edges[0].type).toBe("smoothstep")
    expect(wf.edges[0].animated).toBe(true)
  })

  it("synthesizes a position when missing", () => {
    const wf = validateWorkflow({
      nodes: [{ id: "n1", type: "runtimeNode", data: {} }],
      edges: [],
    })
    expect(typeof wf.nodes[0].position.x).toBe("number")
    expect(typeof wf.nodes[0].position.y).toBe("number")
  })

  it("rejects non-object input", () => {
    expect(() => validateWorkflow(null)).toThrow()
    expect(() => validateWorkflow("nope")).toThrow()
  })

  it("rejects missing nodes/edges arrays", () => {
    expect(() => validateWorkflow({ nodes: [] })).toThrow()
    expect(() => validateWorkflow({ edges: [] })).toThrow()
  })

  it("rejects unsupported node types", () => {
    expect(() =>
      validateWorkflow({ nodes: [{ ...validNode, type: "bogusNode" }], edges: [] }),
    ).toThrow(/unsupported type/)
  })

  it("rejects duplicate node ids", () => {
    expect(() =>
      validateWorkflow({ nodes: [validNode, validNode], edges: [] }),
    ).toThrow(/Duplicate/)
  })

  it("rejects nodes without an id", () => {
    expect(() =>
      validateWorkflow({ nodes: [{ type: "runtimeNode", data: {} }], edges: [] }),
    ).toThrow(/id/)
  })

  it("rejects an empty workflow", () => {
    expect(() => validateWorkflow({ nodes: [], edges: [] })).toThrow(/empty/)
  })
})

describe("buildWorkflowPrompt", () => {
  it("includes the user request and supported node types", () => {
    const prompt = buildWorkflowPrompt("make a bell state")
    expect(prompt).toContain("make a bell state")
    for (const t of SUPPORTED_NODE_TYPES) {
      expect(prompt).toContain(t)
    }
  })

  it("includes the current workflow when provided", () => {
    const prompt = buildWorkflowPrompt("extend it", {
      nodes: [
        {
          id: "existing",
          type: "runtimeNode",
          position: { x: 0, y: 0 },
          data: { label: "Sampler" },
        },
      ],
      edges: [],
    })
    expect(prompt).toContain("CURRENT workflow")
    expect(prompt).toContain("existing")
  })

  it("omits the current-workflow block when empty", () => {
    const prompt = buildWorkflowPrompt("start fresh", { nodes: [], edges: [] })
    expect(prompt).not.toContain("CURRENT workflow")
  })
})
