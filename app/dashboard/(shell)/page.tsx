"use client"

import { useAuth } from "@/services/context/authContext"
import OverviewSection from "@/components/dashboard/OverviewSection"

export default function DashboardOverviewPage() {
  const { user } = useAuth()

  const displayName =
    user?.user_metadata?.full_name ??
    user?.user_metadata?.name ??
    user?.email?.split("@")[0] ??
    "Account"

  return <OverviewSection displayName={displayName} />
}
