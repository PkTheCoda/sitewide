"use client"

import ProtectedRoute from "@/components/ProtectedRoute"
import Navbar from "@/components/homepage/Navbar"

import logo from "@/public/assets/sitewide-logo-v7.svg"
import Image from "next/image"
import { GoSidebarExpand } from "react-icons/go";
import { VscLayoutSidebarLeftDock } from "react-icons/vsc";

export default function Dashboard() {

  

  return (
    <ProtectedRoute>
      <div className="w-full bg-stone-100 h-screen flex flex-col p-3">
        <div className="w-full h-full grid grid-cols-5 gap-3">

          <div className="h-full w-full col-span-1 flex flex-col gap-3">

            <div className="bg-white flex gap-2 items-center justify-between h-max w-full p-3 col-span-1 shadow-xs rounded-xl border-[0.5px] border-stone-200">
              

                <div className="flex gap-x-2 items-center">
                  <Image src={logo} alt="logo" className="h-10 w-max" />
                  <div>
                    <h3 className="font-medium tracking-tight text-lg">
                      Sitewide
                    </h3>
                    <p className="text-xs text-slate-600 ">
                      Free Plan
                    </p>
                  </div>
                </div>

                <div className="p-2 rounded-md hover:bg-slate-100 transition-colors cursor-pointer">
                  <VscLayoutSidebarLeftDock className="size-5 text-slate-400"/>
                </div>

            </div>

            {/* <div className="rounded-xl w-full px-4 py-2 bg-orange-600 text-center text-white tracking-tight shadow-xs">
              New Experiment
            </div> */}

          </div>

          <div className="bg-white p-16 h-full w-full col-span-4 shadow-xs rounded-xl border-[0.5px] border-stone-200">
            col2
          </div>


        </div>
      </div>
    </ProtectedRoute>
  )
}