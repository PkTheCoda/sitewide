"use client";

const COLS = 12;
const ROWS = 8;

import { IoIosArrowRoundForward } from "react-icons/io";
import { CiGlobe } from "react-icons/ci";
import { PiClockAfternoonDuotone } from "react-icons/pi";

import Hero from "@/components/homepage/Hero"
import Navbar from "@/components/homepage/Navbar"

export default function Homepage() {
  return (
    <div className="relative">
      <Navbar />
      <Hero />
    </div>
  );
}