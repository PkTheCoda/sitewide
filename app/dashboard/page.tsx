"use client"

import ProtectedRoute from "@/components/ProtectedRoute"


export default function Dashboard() {

  return (
    <ProtectedRoute>
      <h1>Dashboard</h1>
    </ProtectedRoute>
  )
}