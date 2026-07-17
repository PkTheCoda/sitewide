"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import ProtectedRoute from "@/components/ProtectedRoute"
import { useAuth } from "@/services/context/authContext"
import logo from "@/public/assets/sitewide-logo-v7.svg"
import Image from "next/image"
import { IconType } from "react-icons"
import {
  LuChartBar,
  LuFileSearch,
  LuFlaskConical,
  LuLayoutDashboard,
  LuSearch,
  LuSettings,
} from "react-icons/lu"
import { VscLayoutSidebarLeftDock } from "react-icons/vsc"

type Section = "overview" | "experiments" | "analyses" | "analytics" | "settings"

type SidebarLink = {
  section: Section
  name: string
  href: string
  icon: IconType
}

const sidebarLinks: SidebarLink[] = [
  { section: "overview", name: "Overview", href: "/dashboard", icon: LuLayoutDashboard },
  { section: "experiments", name: "Experiments", href: "/dashboard/experiments", icon: LuFlaskConical },
  { section: "analyses", name: "Analyses", href: "/dashboard/analyses", icon: LuFileSearch },
  { section: "analytics", name: "Analytics", href: "/dashboard/analytics", icon: LuChartBar },
]

function getActiveSection(pathname: string): Section {
  if (pathname === "/dashboard") return "overview"
  if (pathname.startsWith("/dashboard/experiments")) return "experiments"
  if (pathname.startsWith("/dashboard/analyses")) return "analyses"
  if (pathname.startsWith("/dashboard/analytics")) return "analytics"
  if (pathname.startsWith("/dashboard/settings")) return "settings"
  return "overview"
}

export default function DashboardShellLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user } = useAuth()
  const pathname = usePathname()
  const [sidebarClosed, setSidebarClosed] = useState(false)
  const activeSection = getActiveSection(pathname)

  const displayName =
    user?.user_metadata?.full_name ??
    user?.user_metadata?.name ??
    user?.email?.split("@")[0] ??
    "Account"

  const initials = displayName
    .split(" ")
    .map((part: string) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <ProtectedRoute>
      <div className="w-full bg-stone-100 h-screen flex flex-col p-3">
        <div className="w-full h-full flex gap-3">
          <aside className={`h-full w-full flex flex-col gap-3 ${sidebarClosed ? "max-w-16" : "max-w-60"}`}>
            <div className="flex flex-col">
              <div className={`flex gap-2 items-center justify-between rounded-t-xl p-3 bg-white shadow-xs border border-stone-200 ${sidebarClosed ? "justify-center rounded-b-xl" : ""}`}>
                <div className="flex gap-x-2 items-center min-w-0">
                  <Image src={logo} alt="logo" className="h-10 w-max shrink-0" />
                  {!sidebarClosed && (
                    <div className="min-w-0">
                      <h3 className="font-medium tracking-tight text-lg text-stone-800">
                        Sitewide
                      </h3>
                      <p className="text-xs text-stone-500">Free Plan</p>
                    </div>
                  )}
                </div>
                {!sidebarClosed && (
                  <button
                    type="button"
                    aria-label="Collapse sidebar"
                    onClick={() => setSidebarClosed((prev) => !prev)}
                    className="p-2 rounded-lg hover:bg-stone-100 transition-colors cursor-pointer shrink-0"
                  >
                    <VscLayoutSidebarLeftDock className="size-5 text-stone-400" />
                  </button>
                )}
              </div>

              {!sidebarClosed && (
                <div className="relative flex items-center group gap-4">
                  <LuSearch className="absolute left-3 size-4 text-stone-400 pointer-events-none group-focus-within:text-white" />
                  <input
                    type="search"
                    placeholder="Search anything"
                    className="w-full pl-9 pr-3 py-3 text-sm rounded-b-xl border border-stone-200 border-t-0 bg-white shadow-xs text-stone-800 placeholder:text-stone-400 focus:outline-none focus:bg-orange-600 focus:placeholder-white transition-colors focus:text-white"
                  />
                </div>
              )}
            </div>

            <nav className="flex flex-col gap-0.5">
              {!sidebarClosed && (
                <p className="px-3 pt-1 pb-2 text-[11px] font-medium tracking-wider text-stone-400 uppercase">
                  Navigation
                </p>
              )}
              <div className="space-y-2">
                {sidebarLinks.map((link) => {
                  const Icon = link.icon
                  const active = activeSection === link.section
                  return (
                    <Link
                      key={link.section}
                      href={link.href}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                        active
                          ? "bg-stone-200/80 text-stone-900 font-medium"
                          : "text-stone-600 hover:bg-stone-100"
                      } ${sidebarClosed ? "justify-center" : ""}`}
                    >
                      <Icon className="size-[18px] shrink-0" />
                      {!sidebarClosed && <span>{link.name}</span>}
                    </Link>
                  )
                })}
              </div>
            </nav>

            <div className="mt-auto border-t p-2 rounded-xl shadow-xs bg-white border border-stone-200">
              <Link
                href="/dashboard/settings"
                className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-stone-100 transition-colors ${sidebarClosed ? "justify-center" : ""}`}
              >
                <div className="size-9 rounded-full bg-stone-200 flex items-center justify-center text-xs font-semibold text-stone-600 shrink-0">
                  {initials}
                </div>
                {!sidebarClosed && (
                  <>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-medium text-stone-800 truncate">
                        {displayName}
                      </p>
                      <p className="text-xs text-stone-500 truncate">{user?.email}</p>
                    </div>
                    <LuSettings className="size-4 text-stone-400 shrink-0" />
                  </>
                )}
              </Link>
            </div>
          </aside>

          <div className="bg-white flex flex-col gap-3 p-10 h-full w-full shadow-xs rounded-xl border border-stone-200 overflow-y-auto">
            {children}
          </div>
        </div>
      </div>
    </ProtectedRoute>
  )
}
