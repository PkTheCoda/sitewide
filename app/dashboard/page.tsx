"use client"

import { useState, useEffect } from "react"
import ProtectedRoute from "@/components/ProtectedRoute"
import { useAuth } from "@/services/context/authContext"
import logo from "@/public/assets/sitewide-logo-v7.svg"
import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
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

import dashboardCta1 from "@/public/assets/dashboard-cta-1-2.svg"
import dashboardCta2 from "@/public/assets/dashboard-cta-2.svg"

type SidebarLink = {
  url: string
  name: string
  icon: IconType
}

const sidebarLinks: SidebarLink[] = [
  { url: "/dashboard", name: "Overview", icon: LuLayoutDashboard },
  { url: "/dashboard/experiments", name: "Experiments", icon: LuFlaskConical },
  { url: "/dashboard/analyses", name: "Analyses", icon: LuFileSearch },
  { url: "/dashboard/analytics", name: "Analytics", icon: LuChartBar },
  { url: "/dashboard/settings", name: "Settings", icon: LuSettings },
]

function isActivePath(pathname: string, url: string) {
  if (url === "/dashboard") return pathname === "/dashboard"
  return pathname === url || pathname.startsWith(`${url}/`)
}

export default function Dashboard() {
  const pathname = usePathname()
  const { user } = useAuth()

  const [sidebarClosed, setSidebarClosed] = useState(false)

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

                {/* Sidebar Header */}
                <div className={`flex gap-2 items-center justify-between rounded-t-xl p-3 bg-white shadow-xs border border-stone-200 ${sidebarClosed ? "justify-center rounded-b-xl" : ""}`}>
                  <div className="flex gap-x-2 items-center min-w-0">
                    <Image src={logo} alt="logo" className="h-10 w-max shrink-0" />
                    {!sidebarClosed && <div className="min-w-0">
                      <h3 className="font-medium tracking-tight text-lg text-stone-800">
                        Sitewide
                      </h3>
                      <p className="text-xs text-stone-500">Free Plan</p>
                    </div>}
                  </div>
                  {!sidebarClosed && <button
                    type="button"
                    aria-label="Collapse sidebar"
                    className="p-2 rounded-lg hover:bg-stone-100 transition-colors cursor-pointer shrink-0"
                  >
                    <VscLayoutSidebarLeftDock className="size-5 text-stone-400" onClick={() => setSidebarClosed((prev) => !prev)}/>
                  </button>}
                </div>

                {/* Sidebar Search */}
                {!sidebarClosed && <div className="relative flex items-center group gap-4">
                  <LuSearch className="absolute left-3 size-4 text-stone-400 pointer-events-none group-focus-within:text-white" />
                  <input
                    type="search"
                    placeholder="Search anything"
                    className="w-full pl-9 pr-3 py-3 text-sm rounded-b-xl border border-stone-200 border-t-0 bg-white shadow-xs text-stone-800 placeholder:text-stone-400 focus:outline-none focus:bg-orange-600 focus:placeholder-white transition-colors focus:text-white"
                  />
                </div>}
                
              </div>

              {/* Sidebar Navigation */}
              <nav className="flex flex-col gap-0.5">
                {!sidebarClosed && <p className="px-3 pt-1 pb-2 text-[11px] font-medium tracking-wider text-stone-400 uppercase">
                  Navigation
                </p>}
                <div className="space-y-2">
                  {sidebarLinks.map((link) => {
                    const Icon = link.icon
                    const active = isActivePath(pathname, link.url)
                    return (
                      <Link
                        key={link.url}
                        href={link.url}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
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

              {/* Sidebar Footer (User Section) */}
              <div className="mt-auto border-t p-2 rounded-xl shadow-xs bg-white border border-stone-200">
                <Link
                  href="/dashboard/settings"
                  className={`flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-stone-100 transition-colors ${sidebarClosed ? "justify-center" : ""}`}
                >
                  <div className="size-9 rounded-full bg-stone-200 flex items-center justify-center text-xs font-semibold text-stone-600 shrink-0">
                    {initials}
                  </div>
                  {!sidebarClosed && <>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-stone-800 truncate">
                        {displayName}
                      </p>
                      <p className="text-xs text-stone-500 truncate">{user?.email}</p>
                    </div>
                    <LuSettings className="size-4 text-stone-400 shrink-0" />
                  </>}
                </Link>
              </div>
          </aside>

          <div className="bg-white flex flex-col gap-3 p-16 h-full w-full col-span-4 shadow-xs rounded-xl border border-stone-200">
              
              <div className="flex flex-col gap-y-2">
                <h1 className="three-title tracking-tight">
                  What now, <span className="font-medium text-orange-600">@{displayName}?</span>
                </h1>
                <p className="text-stone-500">
                  Lorem ipsum dolor sit amet consectetur adipisicing elit. Necessitatibus sit, id iste quaerat eos
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3">

                  {/* Analyze Page CTA Cards */}
                  <div className="w-full bg-stone-50 rounded-2xl grid grid-cols-2 relative shadow-xs border border-stone-200 hover:bg-stone-200 hover:border-stone-400 cursor-pointer transition-colors">
                    <div className="p-4 flex flex-col justify-center gap-2 text-left">
                      <h1 className="one-title font-medium tracking-tight ">
                        Run new <br /> Site Analysis
                      </h1>
                      <p className="text-xs text-stone-500">
                        Analyze your page's funnel top to bottom.
                      </p>
                    </div>
                    <div className="flex justify-center items-end px-4 pt-4">
                      <Image src={dashboardCta1} alt="dashboard cta 1" className="w-full h-full shadow-xs" />
                    </div>
                  </div>

                  <div className="w-full bg-stone-50 rounded-2xl grid grid-cols-2 relative shadow-xs border border-stone-200 hover:bg-stone-200 hover:border-stone-400 cursor-pointer transition-colors">
                    <div className="p-4 flex flex-col justify-center gap-2 text-left">
                      <h1 className="one-title font-medium tracking-tight ">
                        Create new <br /> Experiment
                      </h1>
                      <p className="text-xs text-stone-500">
                        Create a new A/B test on your pages.
                      </p>
                    </div>
                    <div className="flex justify-center items-end px-4 pt-4">
                      <Image src={dashboardCta2} alt="dashboard cta 1" className="w-full h-full shadow-xs" />
                    </div>
                  </div>

                  <div className="w-full bg-stone-50 rounded-2xl grid grid-cols-2 relative shadow-xs border border-stone-200 hover:bg-stone-200 hover:border-stone-400 cursor-pointer transition-colors">
                    <div className="p-4 flex flex-col justify-center gap-2 text-left">
                      <h1 className="one-title font-medium tracking-tight ">
                        View your <br /> Experiments
                      </h1>
                      <p className="text-xs text-stone-500">
                        View your experiment analytics and results.
                      </p>
                    </div>
                    <div className="flex justify-center items-end px-4 pt-4">
                      <Image src={dashboardCta1} alt="dashboard cta 1" className="w-full h-full shadow-xs" />
                    </div>
                  </div>
    
              </div>

          </div>

        </div>

      </div>
    </ProtectedRoute>
  )
}


