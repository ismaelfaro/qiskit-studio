/**
 * Copyright contributors to the Qiskit Studio project
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reusable API service for generating AI-powered code updates
 * Can be used by any component that needs to update code through AI
 */

import { debugLog, debugError, debugObject, debugTime, debugTimeEnd } from './debug';

/** A parameter value that can be sent to the code-generation API. */
export type ParameterValue = string | number | boolean | Record<string, unknown>

/** Shape of the responses returned by the Maestro / coderun backends. */
interface BackendResponse {
  response?: string
  output?: string
}

export interface AICodeGenerationRequest {
  nodeId: string
  nodeType: string
  currentCode: string
  parameterName: string
  newValue: ParameterValue
  nodeLabel?: string
  sessionId?: string
  qiskitPatternStep?: 'STEP 1' | 'STEP 2' | 'STEP 3' | 'STEP 4'
  preserveStructure?: boolean
  optimize?: boolean
  addNoise?: boolean
  visualize?: boolean
}

export interface AICodeGenerationResponse {
  success: boolean
  code?: string
  error?: string
}

export interface AICodeImprovementRequest {
  nodeId: string
  nodeType: string
  currentCode: string
  userPrompt: string
  sessionId?: string
}

export interface AIChatRequest {
  message: string
  sessionId?: string
}

export interface AIChatResponse {
  success: boolean
  message?: string
  error?: string
}

export interface AIStreamChatResponse {
  success: boolean
  stream?: ReadableStream<Uint8Array>
  error?: string
}

/**
 * Build the standard chat payload shared by every backend call.
 */
function buildChatPayload(text: string, sessionId: string) {
  return {
    input_value: text,
    output_type: "chat",
    input_type: "chat",
    session_id: sessionId,
    prompt: text,
  }
}

/**
 * POST a JSON payload and return the parsed response, throwing on non-2xx.
 */
async function postJson(url: string, payload: unknown): Promise<BackendResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}`)
  }
  return response.json()
}

/**
 * Generate AI-powered code updates for parameter changes
 */
export async function generateAICodeForParameterChange(
  request: AICodeGenerationRequest
): Promise<AICodeGenerationResponse> {
  debugObject('API', 'generateAICodeForParameterChange called with', {
    nodeId: request.nodeId,
    nodeType: request.nodeType,
    parameterName: request.parameterName,
    newValue: request.newValue,
    currentCodeLength: request.currentCode.length
  });

  // Use the dedicated parameter update endpoint if available, otherwise fall back to main API
  const apiUrl = process.env.NEXT_PUBLIC_PARAMETER_UPDATE_API_URL || process.env.NEXT_PUBLIC_API_URL

  debugObject('API', 'API URL selection', {
    parameterUpdateUrl: process.env.NEXT_PUBLIC_PARAMETER_UPDATE_API_URL ? 'Configured' : 'Not configured',
    mainUrl: process.env.NEXT_PUBLIC_API_URL ? 'Configured' : 'Not configured',
    selectedUrl: apiUrl,
    usingDedicatedEndpoint: !!process.env.NEXT_PUBLIC_PARAMETER_UPDATE_API_URL
  });

  if (!apiUrl) {
    const errorMsg = 'Parameter update API URL not configured. Set NEXT_PUBLIC_PARAMETER_UPDATE_API_URL or NEXT_PUBLIC_API_URL in .env.local';
    debugError('API', errorMsg);
    return {
      success: false,
      error: errorMsg
    }
  }

  if (!request.currentCode) {
    // Provide default code templates for different node types
    const defaultCode = getDefaultCodeTemplate(request.nodeType)
    if (!defaultCode) {
      return {
        success: false,
        error: 'No Python code available and no default template found'
      }
    }
    request.currentCode = defaultCode
  }

  const prompt = buildParameterChangePrompt(request)

  debugLog('API', 'Generated prompt:', prompt);

  try {
    const payload = {
      input_value: prompt,
      output_type: "chat",
      input_type: "chat",
      session_id: request.sessionId || `param-update-${request.nodeId}`,
      prompt: prompt,
    }

    debugLog('API', 'Sending request to:', apiUrl);
    debugObject('API', 'Payload', {
      input_value_length: payload.input_value.length,
      output_type: payload.output_type,
      input_type: payload.input_type,
      session_id: payload.session_id,
      prompt: payload.prompt
    });

    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }

    debugLog('API', 'Making fetch request...');
    debugTime('API', 'API Request');
    const response = await fetch(apiUrl, options)
    debugTimeEnd('API', 'API Request');
    debugLog('API', 'Response status:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      debugError('API', 'API request failed', {
        status: response.status,
        statusText: response.statusText,
        errorText: errorText
      });
      throw new Error(`API request failed with status ${response.status}: ${errorText}`);
    }

    const result = await response.json()
    debugObject('API', 'Response received', {
      hasOutputs: !!result.outputs,
      hasOutput: !!result.output,
      fullResponse: result
    });

    debugObject('API', 'Response structure analysis', {
      responseKeys: Object.keys(result || {}),
      outputsLength: result.outputs ? result.outputs.length : 0,
      firstOutputKeys: result.outputs?.[0] ? Object.keys(result.outputs[0]) : [],
      firstOutputOutputsLength: result.outputs?.[0]?.outputs ? result.outputs[0].outputs.length : 0,
      firstOutputOutputKeys: result.outputs?.[0]?.outputs?.[0] ? Object.keys(result.outputs[0].outputs[0]) : [],
      hasResultsMessage: !!(result.outputs?.[0]?.outputs?.[0]?.results?.message),
      messageText: result.outputs?.[0]?.outputs?.[0]?.results?.message?.text || 'No text found'
    });

    const newCode = extractCodeFromResponse(result)
    debugLog('API', '----------- Extracted code:')
    debugLog('API', newCode);

    return {
      success: true,
      code: newCode
    }
  } catch (error) {
    debugError('API', 'Error in generateAICodeForParameterChange', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Generate AI-powered code improvements based on user prompts
 */
export async function generateAICodeImprovement(
  request: AICodeImprovementRequest
): Promise<AICodeGenerationResponse> {
  if (!process.env.NEXT_PUBLIC_API_URL) {
    return {
      success: false,
      error: 'API URL not configured. Set NEXT_PUBLIC_API_URL in .env.local'
    }
  }

  const prompt = buildImprovementPrompt(request)

  try {
    const payload = buildChatPayload(prompt, request.sessionId || `improvement-${request.nodeId}`)
    const result = await postJson(process.env.NEXT_PUBLIC_API_URL!, payload)
    const newCode = extractCodeFromResponse(result)

    return {
      success: true,
      code: newCode
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Execute a quantum program via the coderun backend
 */
export async function runQuantumProgramCode(
  request: AIChatRequest
): Promise<AIChatResponse> {
  if (!process.env.NEXT_PUBLIC_RUNCODE_URL) {
    return {
      success: false,
      error: 'RUNCODE URL not configured. Set NEXT_PUBLIC_RUNCODE_URL in .env.local'
    }
  }

  try {
    const payload = buildChatPayload(request.message, request.sessionId || "user_1")
    const result = await postJson(process.env.NEXT_PUBLIC_RUNCODE_URL!, payload)
    const message = extractMessageFromResponse(result)

    return {
      success: true,
      message: message
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}


/**
 * Generate AI chat responses for general queries
 */
export async function generateAIChatResponse(
  request: AIChatRequest
): Promise<AIChatResponse> {
  if (!process.env.NEXT_PUBLIC_API_URL) {
    return {
      success: false,
      error: 'API URL not configured. Set NEXT_PUBLIC_API_URL in .env.local'
    }
  }

  try {
    const payload = buildChatPayload(request.message, request.sessionId || "user_1")
    const result = await postJson(process.env.NEXT_PUBLIC_API_URL!, payload)
    const message = extractMessageFromResponse(result)

    return {
      success: true,
      message: message
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Generate streaming AI chat responses for OpenAI compatible servers
 */
export async function generateStreamingChatResponse(
  request: AIChatRequest
): Promise<AIStreamChatResponse> {
  if (!process.env.NEXT_PUBLIC_API_URL) {
    return {
      success: false,
      error: 'API URL not configured. Set NEXT_PUBLIC_API_URL in .env.local'
    }
  }

  try {
    // Construct streaming URL from the base API URL
    const baseUrl = process.env.NEXT_PUBLIC_API_URL
    // If the URL already ends with /stream, use it as is, otherwise append /stream
    const streamingUrl = baseUrl.includes('/stream') 
      ? baseUrl 
      : baseUrl.replace(/\/chat(?=[^\/]*$)/, "/chat/stream");
    

    // Use the same payload format as non-streaming (remove stream parameter since URL determines streaming)
    const payload = {
      input_value: request.message,
      output_type: "chat",
      input_type: "chat",
      session_id: request.sessionId || "user_1",
      prompt: request.message
    }

    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }

    const response = await fetch(streamingUrl, options)
    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`)
    }

    return {
      success: true,
      stream: response.body || undefined
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Build prompt for parameter change requests (formatted for the Qiskit Code Updater AI Agent)
 */
function buildParameterChangePrompt(request: AICodeGenerationRequest): string {
  // Note: qiskitPatternStep is available but not currently used in the prompt
  void (request.qiskitPatternStep || determineQiskitPatternStep(request.nodeType, request.parameterName))

  // Build the structured prompt for the Parameter Update API using the specific format
  const prompt = `###[${request.nodeLabel || request.nodeType}]

\`\`\`
${request.currentCode}
\`\`\`

NEW PARAMETERS:

${formatParameterValue(request.parameterName, request.newValue)}${buildAdditionalParameters(request)}`

  return prompt
}

/**
 * Determine the appropriate Qiskit Pattern Step based on node type and parameter
 */
function determineQiskitPatternStep(nodeType: string, parameterName: string): string {
  // Map node types and parameters to Qiskit Pattern Steps
  switch (nodeType) {
    case 'circuitNode':
    case 'circuitLibraryNode':
    case 'quantumInfoNode':
      return 'STEP 1' // Mapping the problem - circuit structure and quantum state preparation

    case 'transpilerNode':
    case 'transpilerPassNode':
    case 'transpiler-AI-passes':
      return 'STEP 2' // Optimize Circuit - transpilation and optimization

    case 'runtimeNode':
    case 'executionNode':
      // More specific parameter mapping for runtime nodes
      if (['resilience_level', 'resilience_config', 'trex', 'zne_mitigation', 'pec_mitigation', 'pea_mitigation',
           'dynamical_decoupling', 'gate_twirling', 'measurement_mitigation', 'shots',
           'execution_shots', 'session_max_time'].includes(parameterName)) {
        return 'STEP 3' // Execute - backend configuration and error mitigation
      }
      return 'STEP 3' // Default to execution for runtime nodes

    case 'visualizationNode':
      return 'STEP 4' // Post-process - result analysis and visualization

    case 'pythonNode':
      // Python nodes could be any step - try to determine from parameter name
      if (['optimization_level', 'layout_method', 'routing_method'].includes(parameterName)) {
        return 'STEP 2' // Optimization parameters
      }
      if (['resilience_level', 'shots', 'backend'].includes(parameterName)) {
        return 'STEP 3' // Execution parameters
      }
      if (['visualization_type', 'plot_type'].includes(parameterName)) {
        return 'STEP 4' // Visualization parameters
      }
      return 'STEP 1' // Default to problem mapping

    case 'chemistryNode':
    case 'chemistryMapNode':
      return 'STEP 1' // Problem mapping - molecular to quantum encoding

    default:
      return 'STEP 1' // Default fallback
  }
}

/**
 * Format parameter value for the prompt, handling both simple values and complex objects
 */
function formatParameterValue(parameterName: string, value: ParameterValue): string {
  // Special handling for molecule parameter with detailed molecular definitions
  if (parameterName === 'molecule') {
    const molecularDefinitions: { [key: string]: string } = {
      'H2': `# H₂ - testbed molecule
# Basis set options: Adaptive minimal (~2 qubits), STO-3G (~2 qubits)
mol = pyscf.gto.Mole()
mol.build(
    atom=[["H", (0.0, 0.0, 0.0)], ["H", (0.74, 0.0, 0.0)]],  # bond length ~0.74 Å
    basis="sto-3g",
    spin=0,
    charge=0
)`,
      'LiH': `# LiH - classic VQE demo
# Basis set options: STO-3G (~4–8 qubits), 6-31G
mol = pyscf.gto.Mole()
mol.build(
    atom=[["Li", (0.0, 0.0, 0.0)], ["H", (1.595, 0.0, 0.0)]],  # bond length ~1.595 Å
    basis="sto-3g",
    spin=0,
    charge=0
)`,
      'BeH2': `# BeH₂ - small molecule demo
# Basis set options: STO-3G (~6–10 qubits), 6-31G
mol = pyscf.gto.Mole()
mol.build(
    atom=[
        ["H", (-1.3264, 0.0, 0.0)],
        ["Be", (0.0, 0.0, 0.0)],
        ["H", (1.3264, 0.0, 0.0)]
    ],  # linear geometry, Be–H ~1.3264 Å
    basis="sto-3g",
    spin=0,
    charge=0
)`,
      'H2O': `# H₂O - water molecule
# Basis set options: STO-3G (~8 qubits CAS), 6-31G (~26 qubits), cc-pVDZ (~48 qubits)
mol = pyscf.gto.Mole()
mol.build(
    atom=[
        ["O", (0.000000, 0.000000, 0.000000)],
        ["H", (0.757160, 0.586260, 0.000000)],
        ["H", (-0.757160, 0.586260, 0.000000)]
    ],  # bond ~0.958 Å, angle ~104.45°
    basis="sto-3g",
    spin=0,
    charge=0
)`,
      'N2': `# N₂ - nitrogen molecule
# Basis set options: 6-31G (CAS(10,16)), cc-pVDZ (CAS(10,26))
mol = pyscf.gto.Mole()
mol.build(
    atom=[
        ["N", (0.0, 0.0, 0.0)],
        ["N", (1.0977, 0.0, 0.0)]
    ],  # bond length ~1.0977 Å
    basis="6-31g",
    spin=0,
    charge=0,
    symmetry="Dooh"
)`,
      'CO': `# CO - carbon monoxide
# Basis set options: STO-3G (~10–20 qubits), 6-31G
mol = pyscf.gto.Mole()
mol.build(
    atom=[
        ["C", (0.0, 0.0, 0.0)],
        ["O", (1.1283, 0.0, 0.0)]
    ],  # bond length ~1.1283 Å
    basis="sto-3g",
    spin=0,
    charge=0
)`,
      'NH3': `# NH₃ - ammonia
# Basis set options: STO-3G (~10–20 qubits), 6-31G
mol = pyscf.gto.Mole()
mol.build(
    atom=[
        ["N", (0.000000, 0.000000, 0.000000)],
        ["H", (0.000000, 0.9377, -0.3816)],
        ["H", (0.8121, -0.4688, -0.3816)],
        ["H", (-0.8121, -0.4688, -0.3816)]
    ],  # bond ~1.012 Å, angle ~107.8°
    basis="sto-3g",
    spin=0,
    charge=0
)`,
      'CH4': `# CH₄ - methane
# Basis set options: STO-3G (~10–20 qubits), 6-31G
mol = pyscf.gto.Mole()
mol.build(
    atom=[
        ["C", (0.000000, 0.000000, 0.000000)],
        ["H", (0.629118, 0.629118, 0.629118)],
        ["H", (-0.629118, -0.629118, 0.629118)],
        ["H", (-0.629118, 0.629118, -0.629118)],
        ["H", (0.629118, -0.629118, -0.629118)]
    ],  # bond ~1.09 Å, tetrahedral
    basis="sto-3g",
    spin=0,
    charge=0
)`,
      'Fe2S2': `# Small Fe–S fragment ([2Fe–2S] toy model, reduced active space)
# Basis set options: TZP-DKH (~45 qubits active space), can replace with minimal for demo
mol = pyscf.gto.Mole()
mol.build(
    atom=[
        ["Fe", (0.000000, 0.000000, 0.000000)],
        ["Fe", (2.7, 0.000000, 0.000000)],
        ["S", (-1.35, 2.34, 0.000000)],
        ["S", (-1.35, -2.34, 0.000000)]
    ],
    basis="tzp-dkh",
    spin=0,   # adjust depending on desired oxidation state
    charge=0
)`
    }
    
    const moleculeCode = molecularDefinitions[String(value)] || molecularDefinitions['H2']
    return `    Selected molecule: ${value}
    
REPLACE THE ENTIRE MOLECULAR DEFINITION with this exact code (DO NOT include #### INPUT PYTHON or #### END INPUT PYTHON markers):

${moleculeCode}`
  }
  
  if (typeof value === 'object' && value !== null) {
    // For complex objects like resilience_config, format each property
    const lines: string[] = []
    for (const [key, val] of Object.entries(value)) {
      lines.push(`    ${key}: ${val}`)
    }
    return lines.join('\n')
  } else {
    // For simple values
    return `    ${parameterName}: ${value}`
  }
}

/**
 * Build additional parameters string if any special flags are set
 */
function buildAdditionalParameters(request: AICodeGenerationRequest): string {
  const additionalParams: string[] = []

  if (request.preserveStructure) additionalParams.push('    preserve_structure: true')
  if (request.optimize) additionalParams.push('    optimize: true')
  if (request.addNoise) additionalParams.push('    add_noise: true')
  if (request.visualize) additionalParams.push('    visualize: true')

  return additionalParams.length > 0 ? '\n' + additionalParams.join('\n') : ''
}

/**
 * Build prompt for code improvement requests
 */
function buildImprovementPrompt(request: AICodeImprovementRequest): string {
  return `You are an expert Qiskit programmer.

Given the following Python code for a ${request.nodeType} node:

\`\`\`python
${request.currentCode}
\`\`\`

The user has requested the following improvement:
"${request.userPrompt}"

Please improve the code according to the user's request while maintaining Qiskit best practices.

Respond with ONLY the improved Python code. Do not include markdown formatting or explanations.`
}

/**
 * Extract code from AI response
 */
function extractCodeFromResponse(result: BackendResponse): string {
  let newCode = ""

  if (result.response) { // Handle maestro api response
    const response_json = JSON.parse(result.response)
    newCode = response_json['final_prompt']
  } else if (result.output) {
    newCode = result.output
  } else {
    throw new Error("Could not parse AI response.")
  }

  // Clean up the code by removing markdown formatting
  return newCode.replace(/```python/g, "").replace(/```/g, "").trim()
}

/**
 * Extract message from AI response for chat
 */
function extractMessageFromResponse(result: BackendResponse): string {
  let message = ""

  if (result.response) { // Handle maestro api response
    const response_json = JSON.parse(result.response)
    message = response_json['final_prompt']
  } else if (result.output) {
    message = result.output
  } else {
    throw new Error("Could not parse AI response.")
  }

  return message.trim()
}

/**
 * Get default code templates for different node types
 */
function getDefaultCodeTemplate(nodeType: string): string | null {
  switch (nodeType) {
    case 'runtimeNode':
      return `# Runtime Configuration
from qiskit_ibm_runtime import EstimatorV2 as Estimator

estimator = Estimator(mode=backend)

# Set resilience level
estimator.options.resilience_level = 1

# Configure error mitigation options
options = {
    "resilience_level": 1,
    "optimization_level": 3,
    "dynamical_decoupling": {
        "enable": False,
        "sequence_type": "XY4pm",
        "extra_slack_distribution": "middle",
        "scheduling_method": "alap"
    },
    "resilience": {
        "measure_mitigation": True,
        "zne_mitigation": False,
        "pec_mitigation": False
    },
    "execution": {
        "init_qubits": True,
        "rep_delay": 250e-6
    },
    "experimental": {
        "custom_backend": None
    }
}`

    case 'transpilerNode':
      return `# Transpiler Configuration
from qiskit.transpiler import PassManager
from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager

transpiler_options = {
    "optimization_level": 1,
    "layout_method": "sabre",
    "routing_method": "stochastic",
    "translation_method": "translator",
    "scheduling_method": "none",
    "seed_transpiler": 42
}

pass_manager = generate_preset_pass_manager(**transpiler_options)`

    case 'circuitNode':
      return `# Circuit Configuration
from qiskit import QuantumCircuit
from qiskit.circuit.library import TwoLocal

circuit_type = "TwoLocal"
circuit = TwoLocal(num_qubits=2, rotation_blocks='ry', entanglement_blocks='cz')`

    case 'visualizationNode':
      return `# Visualization Configuration
from qiskit.visualization import plot_histogram

visualization_type = "Histogram"
plot_histogram(counts)`

    case 'quantumInfoNode':
      return `# Quantum Information Configuration
from qiskit.quantum_info import Pauli

quantum_info_type = "Pauli"
pauli = Pauli("XYZ")`

    case 'chemistryNode':
    case 'chemistryMapNode':
      return `#### INPUT PYTHON
# H₂ - testbed molecule
# Basis set options: Adaptive minimal (~2 qubits), STO-3G (~2 qubits)
mol = pyscf.gto.Mole()
mol.build(
    atom=[["H", (0.0, 0.0, 0.0)], ["H", (0.74, 0.0, 0.0)]],  # bond length ~0.74 Å
    basis="sto-3g",
    spin=0,
    charge=0
)
#### END INPUT PYTHON`

    default:
      return null
  }
}

/**
 * Utility function to check if API is configured
 */
export function isAPIConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_API_URL
}

/**
 * Utility function to check if parameter update API is configured
 */
export function isParameterUpdateAPIConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_PARAMETER_UPDATE_API_URL
}

/**
 * Get API configuration status
 */
export function getAPIStatus(): {
  configured: boolean
  url?: string
  parameterUpdateConfigured: boolean
  parameterUpdateUrl?: string
} {
  return {
    configured: isAPIConfigured(),
    url: process.env.NEXT_PUBLIC_API_URL,
    parameterUpdateConfigured: isParameterUpdateAPIConfigured(),
    parameterUpdateUrl: process.env.NEXT_PUBLIC_PARAMETER_UPDATE_API_URL
  }
}

/**
 * Get the appropriate API URL for the given operation
 */
export function getAPIUrl(operation: 'parameter-update' | 'code-improvement' | 'chat'): string | null {
  switch (operation) {
    case 'parameter-update':
      return process.env.NEXT_PUBLIC_PARAMETER_UPDATE_API_URL || process.env.NEXT_PUBLIC_API_URL || null
    case 'code-improvement':
    case 'chat':
      return process.env.NEXT_PUBLIC_API_URL || null
    default:
      return null
  }
}
