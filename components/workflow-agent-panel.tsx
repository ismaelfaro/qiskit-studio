/**
 * Copyright contributors to the Qiskit Studio project
 * SPDX-License-Identifier: Apache-2.0
 */

"use client"

import { useState, useCallback, type KeyboardEvent } from "react"
import { Sparkles, Loader2, X, AlertCircle } from "lucide-react"
import {
  generateWorkflow,
  type GeneratedWorkflow,
} from "@/lib/workflow-agent"

interface WorkflowAgentPanelProps {
  /** Current canvas workflow, passed to the agent as context. */
  getCurrentWorkflow: () => GeneratedWorkflow
  /** Apply the generated workflow to the canvas. */
  onApplyWorkflow: (workflow: GeneratedWorkflow) => void
}

export function WorkflowAgentPanel({
  getCurrentWorkflow,
  onApplyWorkflow,
}: WorkflowAgentPanelProps) {
  const [open, setOpen] = useState(true)
  const [prompt, setPrompt] = useState("")
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = useCallback(async () => {
    const trimmed = prompt.trim()
    if (!trimmed || isGenerating) return

    setIsGenerating(true)
    setError(null)
    try {
      const result = await generateWorkflow(trimmed, getCurrentWorkflow())
      if (result.success && result.workflow) {
        onApplyWorkflow(result.workflow)
        setPrompt("")
        setOpen(false)
      } else {
        setError(result.error || "Failed to generate workflow")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error")
    } finally {
      setIsGenerating(false)
    }
  }, [prompt, isGenerating, getCurrentWorkflow, onApplyWorkflow])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open workflow agent"
        className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg transition-colors hover:bg-blue-700"
      >
        <Sparkles className="h-4 w-4" />
        Generate workflow with AI
      </button>
    )
  }

  return (
    <div className="absolute top-4 left-72 right-4 z-[60] mx-auto max-w-[40rem] rounded-xl border border-gray-200 bg-white p-4 shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <Sparkles className="h-4 w-4 text-blue-600" />
          Describe the workflow you want
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close workflow agent"
          className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isGenerating}
        rows={3}
        autoFocus
        placeholder="e.g. Build a CHSH inequality experiment: a Bell circuit, transpile it, run with the Sampler, then plot a histogram."
        className="w-full resize-y rounded-lg border border-gray-300 p-3 text-sm text-white placeholder:text-gray-300 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
      />

      {error && (
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-gray-400">
          Replaces the current canvas · ⌘/Ctrl + Enter to submit
        </span>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isGenerating || !prompt.trim()}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              Generate
            </>
          )}
        </button>
      </div>
    </div>
  )
}
