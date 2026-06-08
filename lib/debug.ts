/**
 * Copyright contributors to the Qiskit Studio project
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Debug utility for conditional logging
 * Can be controlled via NEXT_PUBLIC_DEBUG environment variable
 */

// Check if debug mode is enabled
const isDebugEnabled = () => {
  if (typeof window !== 'undefined') {
    // Client-side: check environment variable and localStorage
    return process.env.NEXT_PUBLIC_DEBUG === 'true' || 
           localStorage.getItem('qiskit-studio-debug') === 'true';
  }
  // Server-side: only check environment variable
  return process.env.NEXT_PUBLIC_DEBUG === 'true';
};

// Debug categories for more granular control
export const DEBUG_CATEGORIES = {
  API: 'API',
  COMPOSER: 'COMPOSER',
  NODES: 'NODES',
  PYTHON_CODE: 'PYTHON_CODE',
  HOOK: 'HOOK',
  ALL: 'ALL'
} as const;

type DebugCategory = keyof typeof DEBUG_CATEGORIES;

/**
 * Debug logging function that respects debug mode setting
 */
export const debugLog = (category: DebugCategory, message: string, ...args: any[]) => {
  if (!isDebugEnabled()) return;
  
  const categoryEmoji = getCategoryEmoji(category);
  const timestamp = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  
  console.log(`${categoryEmoji} [${timestamp}] [${category}] ${message}`, ...args);
};

/**
 * Debug error logging
 */
export const debugError = (category: DebugCategory, message: string, error?: any) => {
  if (!isDebugEnabled()) return;
  
  const categoryEmoji = getCategoryEmoji(category);
  const timestamp = new Date().toISOString().slice(11, 23);
  
  console.error(`${categoryEmoji} [${timestamp}] [${category}] ERROR: ${message}`, error);
};

/**
 * Debug warning logging
 */
export const debugWarn = (category: DebugCategory, message: string, ...args: any[]) => {
  if (!isDebugEnabled()) return;
  
  const categoryEmoji = getCategoryEmoji(category);
  const timestamp = new Date().toISOString().slice(11, 23);
  
  console.warn(`${categoryEmoji} [${timestamp}] [${category}] WARNING: ${message}`, ...args);
};

/**
 * Get emoji for debug category
 */
function getCategoryEmoji(category: DebugCategory): string {
  switch (category) {
    case 'API': return '🔧';
    case 'COMPOSER': return '🚀';
    case 'NODES': return '🎛️';
    case 'PYTHON_CODE': return '🎯';
    case 'HOOK': return '🎣';
    case 'ALL': return '🔍';
    default: return '🔍';
  }
}

/**
 * Client-side function to enable/disable debug mode
 */
export const setDebugMode = (enabled: boolean) => {
  if (typeof window !== 'undefined') {
    if (enabled) {
      localStorage.setItem('qiskit-studio-debug', 'true');
    } else {
      localStorage.removeItem('qiskit-studio-debug');
    }
    console.log(`Debug mode ${enabled ? 'enabled' : 'disabled'}`);
  }
};

/**
 * Get current debug mode status
 */
export const getDebugMode = (): boolean => {
  return isDebugEnabled();
};

/**
 * Debug utility to log object properties in a formatted way
 */
export const debugObject = (category: DebugCategory, title: string, obj: any) => {
  if (!isDebugEnabled()) return;
  
  debugLog(category, `${title}:`, obj);
};

/**
 * Debug utility for timing operations
 */
export const debugTime = (category: DebugCategory, label: string) => {
  if (!isDebugEnabled()) return;
  
  const categoryEmoji = getCategoryEmoji(category);
  console.time(`${categoryEmoji} [${category}] ${label}`);
};

export const debugTimeEnd = (category: DebugCategory, label: string) => {
  if (!isDebugEnabled()) return;
  
  const categoryEmoji = getCategoryEmoji(category);
  console.timeEnd(`${categoryEmoji} [${category}] ${label}`);
};