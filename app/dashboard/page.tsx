"use client"

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

        <div className="w-full h-full grid grid-cols-5 gap-3">

          <aside className="h-full w-full col-span-1 flex flex-col gap-3">
              
              <div className="flex flex-col">
                <div className="flex gap-2 items-center justify-between rounded-t-xl p-3 bg-white shadow-xs border border-stone-200">
                  <div className="flex gap-x-2 items-center min-w-0">
                    <Image src={logo} alt="logo" className="h-10 w-max shrink-0" />
                    <div className="min-w-0">
                      <h3 className="font-medium tracking-tight text-lg text-stone-800">
                        Sitewide
                      </h3>
                      <p className="text-xs text-stone-500">Free Plan</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Collapse sidebar"
                    className="p-2 rounded-lg hover:bg-stone-100 transition-colors cursor-pointer shrink-0"
                  >
                    <VscLayoutSidebarLeftDock className="size-5 text-stone-400" />
                  </button>
                </div>
                <div className="relative group">
                  <LuSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-stone-400 pointer-events-none group-focus-within:text-white" />
                  <input
                    type="search"
                    placeholder="Search anything"
                    className="w-full pl-9 pr-3 py-3 text-sm rounded-b-xl border border-stone-200 border-t-0 bg-white shadow-xs text-stone-800 placeholder:text-stone-400 focus:outline-none focus:bg-orange-600 focus:placeholder-white transition-colors focus:text-white"
                  />
                </div>
              </div>

              <nav className="flex flex-col gap-0.5">
                <p className="px-3 pt-1 pb-2 text-[11px] font-medium tracking-wider text-stone-400 uppercase">
                  Navigation
                </p>
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
                      }`}
                    >
                      <Icon className="size-[18px] shrink-0" />
                      <span>{link.name}</span>
                    </Link>
                  )
                })}
              </nav>

              <div className="mt-auto border-t p-2 rounded-xl shadow-xs bg-white border border-stone-200">
                <Link
                  href="/dashboard/settings"
                  className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-stone-100 transition-colors"
                >
                  <div className="size-9 rounded-full bg-stone-200 flex items-center justify-center text-xs font-semibold text-stone-600 shrink-0">
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-stone-800 truncate">
                      {displayName}
                    </p>
                    <p className="text-xs text-stone-500 truncate">{user?.email}</p>
                  </div>
                  <LuSettings className="size-4 text-stone-400 shrink-0" />
                </Link>
              </div>
          </aside>

          <div className="bg-white p-16 h-full w-full col-span-4 shadow-xs rounded-xl border border-stone-200">
            col2
          </div>
        </div>

      </div>
    </ProtectedRoute>
  )
}
