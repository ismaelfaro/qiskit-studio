/**
 * Copyright contributors to the Qiskit Studio project
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Custom hook for managing AI code generation state and operations
 * Can be used by any component that needs AI code generation functionality
 */

import { useState, useCallback } from 'react'
import {
  generateAICodeForParameterChange,
  generateAICodeImprovement,
  AICodeGenerationRequest,
  AICodeImprovementRequest,
  AICodeGenerationResponse
} from '@/lib/api-service'
import { debugLog, debugError, debugObject } from '@/lib/debug'

export interface UseAICodeGenerationReturn {
  // State
  isGenerating: boolean
  generatingNodeIds: Set<string>
  lastError: string | null
  
  // Actions
  generateCodeForParameter: (request: AICodeGenerationRequest) => Promise<AICodeGenerationResponse>
  generateCodeImprovement: (request: AICodeImprovementRequest) => Promise<AICodeGenerationResponse>
  setNodeUpdating: (nodeId: string, isUpdating: boolean) => void
  clearError: () => void
  
  // Utilities
  isNodeUpdating: (nodeId: string) => boolean
}

export function useAICodeGeneration(): UseAICodeGenerationReturn {
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatingNodeIds, setGeneratingNodeIds] = useState<Set<string>>(new Set())
  const [lastError, setLastError] = useState<string | null>(null)

  const setNodeUpdating = useCallback((nodeId: string, isUpdating: boolean) => {
    setGeneratingNodeIds(prev => {
      const newSet = new Set(prev)
      if (isUpdating) {
        newSet.add(nodeId)
      } else {
        newSet.delete(nodeId)
      }
      return newSet
    })
    
    // Update global generating state
    setIsGenerating(prev => isUpdating ? true : generatingNodeIds.size > 1)
  }, [generatingNodeIds.size])

  const generateCodeForParameter = useCallback(async (
    request: AICodeGenerationRequest
  ): Promise<AICodeGenerationResponse> => {
    debugObject('HOOK', 'generateCodeForParameter called', {
      nodeId: request.nodeId,
      parameterName: request.parameterName,
      newValue: request.newValue
    });

    setLastError(null)
    debugLog('HOOK', 'Setting node as updating:', request.nodeId);
    setNodeUpdating(request.nodeId, true)

    try {
      debugLog('HOOK', 'Calling generateAICodeForParameterChange...');
      const response = await generateAICodeForParameterChange(request)

      debugObject('HOOK', 'generateAICodeForParameterChange response', {
        success: response.success,
        hasCode: !!response.code,
        error: response.error
      });

      if (!response.success) {
        setLastError(response.error || 'Failed to generate code')
      }

      return response
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      debugError('HOOK', 'Error in generateCodeForParameter:', errorMessage);
      setLastError(errorMessage)
      return {
        success: false,
        error: errorMessage
      }
    } finally {
      debugLog('HOOK', 'Setting node as not updating:', request.nodeId);
      setNodeUpdating(request.nodeId, false)
    }
  }, [setNodeUpdating])

  const generateCodeImprovement = useCallback(async (
    request: AICodeImprovementRequest
  ): Promise<AICodeGenerationResponse> => {
    setLastError(null)
    setNodeUpdating(request.nodeId, true)
    
    try {
      const response = await generateAICodeImprovement(request)
      
      if (!response.success) {
        setLastError(response.error || 'Failed to improve code')
      }
      
      return response
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setLastError(errorMessage)
      return {
        success: false,
        error: errorMessage
      }
    } finally {
      setNodeUpdating(request.nodeId, false)
    }
  }, [setNodeUpdating])

  const clearError = useCallback(() => {
    setLastError(null)
  }, [])

  const isNodeUpdating = useCallback((nodeId: string) => {
    return generatingNodeIds.has(nodeId)
  }, [generatingNodeIds])

  return {
    isGenerating,
    generatingNodeIds,
    lastError,
    generateCodeForParameter,
    generateCodeImprovement,
    setNodeUpdating,
    clearError,
    isNodeUpdating
  }
}