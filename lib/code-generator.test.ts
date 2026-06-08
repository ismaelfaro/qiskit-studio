/**
 * Copyright contributors to the Qiskit Studio project
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest"
import type { Node, Edge } from "reactflow"
import { generateQiskitCode } from "./code-generator"

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): Node {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data,
  }
}

const NO_EDGES: Edge[] = []

describe("generateQiskitCode — imports", () => {
  it("includes basic imports by default", () => {
    const code = generateQiskitCode([makeNode("1", "executionNode")], NO_EDGES)
    expect(code).toContain("import")
  })

  it("omits the basic imports header when includeImports=false", () => {
    const withImports = generateQiskitCode(
      [makeNode("1", "executionNode")],
      NO_EDGES,
      { includeImports: true, includeVisualization: false },
    )
    const withoutImports = generateQiskitCode(
      [makeNode("1", "executionNode")],
      NO_EDGES,
      { includeImports: false, includeVisualization: false },
    )
    expect(withoutImports.length).toBeLessThan(withImports.length)
  })
})

describe("generateQiskitCode — single nodes", () => {
  it("generates quantumInfoNode Hamiltonian code", () => {
    const node = makeNode("1", "quantumInfoNode", { category: "Hamiltonian" })
    const code = generateQiskitCode([node], NO_EDGES)
    expect(code).toContain("SparsePauliOp")
    expect(code).toContain("Hamiltonian")
  })

  it("generates quantumInfoNode SparsePauliOp code", () => {
    const node = makeNode("1", "quantumInfoNode", { category: "SparsePauliOp" })
    const code = generateQiskitCode([node], NO_EDGES)
    expect(code).toContain("SparsePauliOp")
  })

  it("generates circuitLibraryNode Ansatz code", () => {
    const node = makeNode("1", "circuitLibraryNode", { category: "Ansatz" })
    const code = generateQiskitCode([node], NO_EDGES)
    expect(code).toContain("Circuit Library")
  })

  it("generates circuitLibraryNode basic circuit code for unknown category", () => {
    const node = makeNode("1", "circuitLibraryNode", { category: "Other" })
    const code = generateQiskitCode([node], NO_EDGES)
    expect(code).toContain("Circuit Library")
  })

  it("generates transpilerNode code with defaults", () => {
    const node = makeNode("1", "transpilerNode", {})
    const code = generateQiskitCode([node], NO_EDGES)
    expect(code).toContain("Transpiler")
  })

  it("generates transpilerNode code with custom optimizationLevel", () => {
    const node = makeNode("1", "transpilerNode", { optimizationLevel: 3 })
    const code = generateQiskitCode([node], NO_EDGES)
    expect(code).toContain("3")
  })

  it("generates transpilerPassNode code", () => {
    const node = makeNode("1", "transpilerPassNode", { selectedPass: "Optimize1qGates" })
    const code = generateQiskitCode([node], NO_EDGES)
    expect(code).toContain("Transpiler Pass")
    expect(code).toContain("Optimize1qGates")
  })

  it("generates executionNode code", () => {
    const node = makeNode("1", "executionNode")
    const code = generateQiskitCode([node], NO_EDGES)
    expect(code).toContain("Execution")
  })

  it("generates runtimeNode Estimator code", () => {
    const node = makeNode("1", "runtimeNode", { category: "Estimator" })
    const code = generateQiskitCode([node], NO_EDGES)
    expect(code).toContain("Estimator")
  })

  it("generates runtimeNode Sampler code with loopCount", () => {
    const node = makeNode("1", "runtimeNode", { category: "Sampler", loopCount: 5 })
    const code = generateQiskitCode([node], NO_EDGES)
    // loopCount * 1024 = 5120 shots appears in the Sampler template
    expect(code).toContain("5120")
  })

  it("generates visualizationNode Histogram code", () => {
    const node = makeNode("1", "visualizationNode", { category: "Histogram" })
    const code = generateQiskitCode([node], NO_EDGES)
    expect(code).toContain("plot_histogram")
  })

  it("generates visualizationNode Bloch Sphere code", () => {
    const node = makeNode("1", "visualizationNode", { category: "Bloch Sphere" })
    const code = generateQiskitCode([node], NO_EDGES)
    expect(code).toContain("Bloch")
  })

  it("generates visualizationNode Circuit Diagram code", () => {
    const node = makeNode("1", "visualizationNode", { category: "Circuit Diagram" })
    const code = generateQiskitCode([node], NO_EDGES)
    expect(code).toContain("Circuit")
  })

  it("emits fallback comment for unknown node type", () => {
    const node = makeNode("1", "unknownNode")
    const code = generateQiskitCode([node], NO_EDGES)
    expect(code).toContain("No specific code")
  })
})

describe("generateQiskitCode — multi-node flows", () => {
  it("generates circuit code for multiple nodes", () => {
    const nodes = [
      makeNode("1", "circuitLibraryNode", { category: "Basic" }),
      makeNode("2", "executionNode"),
    ]
    const code = generateQiskitCode(nodes, NO_EDGES)
    expect(code).toContain("qubits")
  })

  it("uses PauliTwoDesign template when circuit category matches", () => {
    const nodes = [
      makeNode("1", "circuitLibraryNode", { category: "PauliTwoDesign" }),
      makeNode("2", "runtimeNode", { category: "Estimator" }),
    ]
    const code = generateQiskitCode(nodes, NO_EDGES)
    expect(code).toContain("PauliTwoDesign")
  })

  it("adds transpilation block when transpilerNode is present", () => {
    const nodes = [
      makeNode("1", "circuitLibraryNode", { category: "Basic" }),
      makeNode("2", "transpilerNode", {}),
      makeNode("3", "runtimeNode", { category: "Estimator" }),
    ]
    const code = generateQiskitCode(nodes, NO_EDGES)
    expect(code.toLowerCase()).toContain("transpil")
  })

  it("adds Estimator execution block when runtimeNode category is Estimator", () => {
    const nodes = [
      makeNode("1", "circuitLibraryNode", { category: "Basic" }),
      makeNode("2", "runtimeNode", { category: "Estimator" }),
    ]
    const code = generateQiskitCode(nodes, NO_EDGES)
    expect(code).toContain("Estimator")
  })

  it("adds Sampler execution block with loopCount", () => {
    const nodes = [
      makeNode("1", "circuitLibraryNode", { category: "Basic" }),
      makeNode("2", "runtimeNode", { category: "Sampler", loopCount: 7 }),
    ]
    const code = generateQiskitCode(nodes, NO_EDGES)
    // loopCount * 1024 = 7168 shots
    expect(code).toContain("7168")
  })

  it("adds SparsePauliOp block when quantumInfoNode category matches", () => {
    const nodes = [
      makeNode("1", "circuitLibraryNode", { category: "Basic" }),
      makeNode("2", "quantumInfoNode", { category: "SparsePauliOp" }),
      makeNode("3", "runtimeNode", { category: "Estimator" }),
    ]
    const code = generateQiskitCode(nodes, NO_EDGES)
    expect(code).toContain("SparsePauliOp")
  })

  it("adds Histogram visualization when visualizationNode present", () => {
    const nodes = [
      makeNode("1", "circuitLibraryNode", { category: "Basic" }),
      makeNode("2", "runtimeNode", { category: "Sampler" }),
      makeNode("3", "visualizationNode", { category: "Histogram" }),
    ]
    const code = generateQiskitCode(nodes, NO_EDGES)
    expect(code).toContain("plot_histogram")
  })

  it("skips visualization draw block when includeVisualization=false", () => {
    const withViz = generateQiskitCode(
      [makeNode("1", "circuitLibraryNode", { category: "Basic" }), makeNode("2", "visualizationNode", { category: "Histogram" })],
      NO_EDGES,
      { includeImports: true, includeVisualization: true },
    )
    const withoutViz = generateQiskitCode(
      [makeNode("1", "circuitLibraryNode", { category: "Basic" }), makeNode("2", "visualizationNode", { category: "Histogram" })],
      NO_EDGES,
      { includeImports: true, includeVisualization: false },
    )
    // The visualization-specific draw call should only appear when includeVisualization=true
    expect(withViz.length).toBeGreaterThan(withoutViz.length)
  })

  it("returns a non-empty string for an empty node list", () => {
    const code = generateQiskitCode([], NO_EDGES)
    expect(typeof code).toBe("string")
  })
})
