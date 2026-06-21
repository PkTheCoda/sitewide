"use client";

const COLS = 16;
const ROWS = 8;

import { IoIosArrowRoundForward } from "react-icons/io";
import { CiGlobe } from "react-icons/ci";
import { PiClockAfternoonDuotone } from "react-icons/pi";


export default function Hero() {
  return (
    <section className="relative min-h-screen w-full bg-slate-50">
      {/* LINES — a full 12×8 grid. The 1px gaps reveal the container
          color underneath, so the gaps *are* your grid lines.
          This layer is purely visual and never changes. */}
      <div
        aria-hidden
        className="absolute inset-0 grid grid-cols-16 grid-rows-8 gap-px bg-slate-100"
      >
        {Array.from({ length: COLS * ROWS }).map((_, i) => (
          <div key={i} className="bg-slate-100">
            <div className="bg-white w-full h-full rounded-md">

            </div>
          </div>
        ))}
      </div>

      {/* CONTENT — same grid, but empty. Build your UI here with
          col-start / col-span / row-start / row-span. Give each block a
          background (bg-slate-50) so it covers the lines it sits on top of.
          Leave an area empty and the lines show through. */}
      <div className="relative grid grid-cols-16 grid-rows-8 gap-px min-h-screen">
 

        {/* Main Hero Box */}
        <div className="flex flex-col gap-y-6 items-center justify-center col-start-5 col-span-8 row-start-2 row-span-5 bg-slate-100">
          
            <div className="flex flex-col gap-y-6 items-center justify-center bg-white w-full h-full rounded-md">
                <div className="flex items-center gap-2 bg-slate-50 bg-opacity-90 rounded-full p-1 pr-3 text-slate-900 font-medium w-fit">
                    <span className="flex items-center justify-center rounded-full bg-orange-600 w-7 h-7">
                    {/* Waitlist icon — swap this for desired icon */}
                    <PiClockAfternoonDuotone className="size-5 text-white"/>
                    </span>
                    <h5 className="text-sm font-medium">
                    Join the Waitlist for early access!
                    </h5>
                </div>
                <h1 className="seven-title text-center tracking-tighter">
                    AI Agents that <br /> <span className="">Fix your Funnel</span>
                </h1>
                <h4 className="max-w-120 text-base text-center">
                    Sitewide is the agentic CRO toolkit for founders to {" "}
                    <span className="bg-slate-100 p-1 rounded-md font-medium">generate, analyze, and automate funnel testing.</span>
                </h4>
                <form
                className="flex items-center justify-between w-full max-w-lg bg-white border border-slate-200 rounded-2xl p-2 shadow-[0_0px_60px_-10px_rgba(0,0,0,0.1)]"
                onSubmit={(e) => e.preventDefault()}
                >
                <div className="flex items-center ml-2">
                    {/* Globe Icon */}
                    <span className="mr-2 flex items-center text-slate-400">
                    <CiGlobe className="size-5"/>
                    </span>
                    <input
                    type="text"
                    className="flex-1 outline-none bg-transparent text-base placeholder-slate-400"
                    placeholder="Join The Waitlist"
                    autoComplete="off"
                    />
                </div>
                <button
                    type="submit"
                    className="h-full px-4 py-1 rounded-r-xl rounded-l-md flex items-center bg-orange-600 hover:bg-orange-600 text-white shadow"
                    aria-label="Join The Waitlist"
                >
                    <IoIosArrowRoundForward className="size-6"/>
                </button>
                </form>
            </div>

        </div>

        {/* Border Curve Boxes */}

        {/* row 2, col 2 size 1 */}
        <div className="row-start-2 row-span-1 col-start-2 col-span-1 bg-slate-100 p-px">
            <div className="w-full h-full rounded-md relative bg-slate-50">
                <h3 className="font-robot text-xs text-slate-300 absolute bottom-2 left-2">
                    CRO <br />
                    SEO <br />

                </h3>
            </div>
        </div>
   

        {/* row 8, col 6, size 4 */}
        <div className="row-start-1 row-span-1 col-start-4 col-span-4 bg-slate-100 p-px">
            <div className="relative bg-slate-50 w-full h-full rounded-md">
                <h3 className="font-robot text-xs text-slate-300 absolute top-2 left-2 text-left">
                    A/B TESTING <br />
                    SPLIT TESTING <br />
                </h3>
            </div>
        </div>

        {/* row 5, col 1, size 4 */}
        <div className="row-start-5 row-span-4 col-start-1 col-span-1 bg-slate-100 p-px">
            <div className="relative bg-slate-50 w-full h-full rounded-md">
                <h3 className="font-robot text-xs text-slate-300 absolute left-2 bottom-2 text-left">
                    SPLIT TESTING
                </h3>
            </div>
        </div>

        {/* row 2, col 11, size 2 */}
        <div className="row-start-2 row-span-1 col-start-14 col-span-2 bg-slate-100 p-px">
            <div className="relative bg-slate-50 w-full h-full rounded-md">
                <h3 className="font-robot text-xs text-slate-300 absolute top-2 right-2 uppercase text-right">
                    FOUNDERS <br />
                    SAAS COMPANIES <br />
                    GROWTH TEAMS <br />
                    E-COMMERCE <br />
                </h3>
            </div>
        </div>

        {/* row 4, col 12, size 3 */}
        <div className="row-start-4 row-span-3 col-start-14 col-span-1 bg-slate-100 p-px">
            <div className="relative bg-slate-50 w-full h-full rounded-md">
                <h3 className="font-robot text-xs text-slate-300 absolute bottom-2 left-2 text-left">
                    GA4 <br />
                    POSTHOG
                </h3>
            </div>
        </div>

        <div className="row-start-7 row-span-2 col-start-16 col-span-1 bg-slate-100 p-px">
            <div className="relative bg-slate-50 w-full h-full rounded-md">
                <h3 className="font-robot text-xs text-slate-300 absolute top-2 right-2 uppercase text-right">
                    Landing <br />
                    Auth Flow <br />
                    Content 
                </h3>
            </div>
        </div>

        {/* row 8, col 6, size 4 */}
        <div className="row-start-8 row-span-1 col-start-10 col-span-4 bg-slate-100 p-px">
            <div className="relative bg-slate-50 w-full h-full rounded-md">

            </div>
        </div>

      </div>

    </section>
  );
}