"use client"

import ProtectedRoute from "@/components/ProtectedRoute"
import Navbar from "@/components/homepage/Navbar"


export default function Dashboard() {

  return (
    <ProtectedRoute>
      <div className="w-full bg-red-100 min-h-screen flex flex-col">
        <Navbar />
      </div>
    </ProtectedRoute>
  )
}