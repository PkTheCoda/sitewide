"use client"

import { useAuth } from "@/services/context/authContext"


export default function Dashboard() {

  const { user, loading } = useAuth()

  return (
    <div>
      <h1>Dashboard</h1>
    </div>
  )
}