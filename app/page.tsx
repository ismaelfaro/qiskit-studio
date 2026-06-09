/**
 * Copyright contributors to the Qiskit Studio project
 * SPDX-License-Identifier: Apache-2.0
 */

"use client"

import dynamic from "next/dynamic"
import "@/lib/debug-utils"

// QuantumComposer is a heavy client-only tree (ReactFlow, 3Dmol, all node
// editors). Server-rendering it adds a large, pointless cost to every cold
// load — the component can't do anything useful without the browser. Loading it
// with ssr:false lets the server return an instant shell + visible loading
// state, instead of blocking on a full SSR render (which left the tab blank).
const QuantumComposer = dynamic(
  () => import("@/components/quantum-composer").then((m) => m.QuantumComposer),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading Qiskit Studio…
      </div>
    ),
  },
)

export default function Home() {
  return (
    <main className="min-h-screen">
      <QuantumComposer />
    </main>
  )
}
