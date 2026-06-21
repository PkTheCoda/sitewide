"use client";

const COLS = 12;
const ROWS = 1;

import logo from "@/public/assets/sitewide-logo-v3.svg"
import Image from "next/image";
import { IoIosArrowRoundForward } from "react-icons/io";
import Link from "next/link";

export default function Navbar() {

    const navLinks = [
        {
            label: "Features",
            href: "/features"
        },
        {
            label: "Solutions",
            href: "/solutions"
        },
        {
            label: "Pricing",
            href: "/pricing"
        }
    ]

  return (
    <nav className="relative w-full bg-slate-50 h-24">

      <div
        aria-hidden
        className="absolute inset-0 grid grid-cols-12 grid-rows-1 gap-px bg-slate-100 h-full"
      >
        {Array.from({ length: COLS * ROWS }).map((_, i) => (
          <div key={i} className="bg-white border-b border-slate-100 rounded-md" />
        ))}
      </div>

      <div className="relative grid grid-cols-12 grid-rows-1 gap-px h-full">

        <div className="w-full h-full bg-white rounded-md border-b border-slate-100 col-start-2 col-span-10 py-6 px-10 flex items-center justify-between">
            <div className="flex items-center gap-2">
                <Image src={logo} alt="Sitewide Logo" className="size-8" />
                <h3 className="three-title tracking-tighter font-medium">Site<span className="text-orange-600">wide</span></h3>
            </div>

            <div className="flex items-center gap-4">
                {navLinks.map((link) => (
                    <Link href={link.href} key={link.label} className="text-lg tracking-tight hover:text-orange-600 transition-colors duration-300">
                        {link.label}
                    </Link>
                ))}
            </div>

            <div className="flex items-center gap-2">
                <Link
                    href="/signup"
                    className="h-max px-4 py-2 rounded-r-2xl rounded-l-md flex items-center gap-2 bg-orange-600 hover:bg-orange-600 text-white shadow"
                    aria-label="Sign Up"
                >
                    <h4 className="text-sm font-medium">
                        Sign Up
                    </h4>
                    <IoIosArrowRoundForward className="size-6"/>
                </Link>
            </div> 

        </div>

      </div>
    </nav>
  )
}