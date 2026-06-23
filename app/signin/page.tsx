"use client";

import { useState } from "react";
import Link from "next/link";
import { SiGoogle } from "react-icons/si";
import Image from "next/image";
import logo from "@/public/assets/sitewide-logo-v3.svg";

import { createNewUser, signInWithEmail } from "@/services/auth";

const COLS = 12;
const ROWS = 5;

type Tab = "login" | "signup";

import { NewUserData } from "@/services/auth";
import { useRouter } from "next/navigation";

export default function AuthPage() {
  const [tab, setTab] = useState<Tab>("signup");
  const isLogin = tab === "login";
  const router = useRouter();

  const [authData, setAuthData] = useState<NewUserData>({
    username: "",
    email: "",
    password: "",
  })

  function handleAuthInput(e: React.ChangeEvent<HTMLInputElement>) {
    const {name, value} = e.target;
    setAuthData({
      ...authData,
      [name]: value,
    })

    console.log(authData)
  }

  function handleAuthSubmit(e: React.MouseEvent<HTMLButtonElement>) {
    // TODO: if error, data shouldn't reset + show error message
    e.preventDefault();
    if (isLogin) {
      signInWithEmail(authData);
    } else {
      createNewUser(authData); 
      setAuthData({
        username: "",
        email: "",
        password: "",
      })
    }
    router.push("/dashboard")
    console.log(authData)
  }

  return (
    <section className="relative h-screen w-full bg-slate-50">
      <div
        aria-hidden
        className="absolute inset-0 grid grid-cols-12 grid-rows-5 gap-px bg-slate-100"
      >
        {Array.from({ length: COLS * ROWS }).map((_, i) => (
          <div key={i} className="bg-slate-100">
            <div className="bg-white w-full h-full rounded-sm" />
          </div>
        ))}
      </div>

      <div className="relative grid grid-cols-12 grid-rows-5 gap-px min-h-screen">

        {/* Main auth card */}
        <div className="col-start-2 sm:col-start-4 lg:col-start-5 col-span-10 sm:col-span-6 lg:col-span-4 row-start-1 sm:row-start-2 row-span-5 sm:row-span-4 bg-slate-100 p-px">
          <div className="bg-white w-full h-full rounded-md flex flex-col items-center justify-center p-6 lg:px-10 lg:py-6 gap-y-8">

            {/* Logo */}
            <div className="flex items-center gap-2.5">
              <Image src={logo} alt="Sitewide Logo" className="size-10" />
              <span className="five-title font-medium tracking-tight">
                Site<span className="text-orange-600">wide</span>
              </span>
            </div>

            {/* Pill toggle */}
            <div className="flex items-center bg-slate-100 rounded-full p-1 w-full">
              <button
                onClick={() => setTab("login")}
                className={`flex-1 text-center py-1.5 text-sm font-medium rounded-full transition-all ${
                  isLogin
                    ? "text-slate-900 bg-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Log In
              </button>
              <button
                onClick={() => setTab("signup")}
                className={`flex-1 text-center py-1.5 text-sm font-medium rounded-full transition-all ${
                  !isLogin
                    ? "text-slate-900 bg-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Sign Up
              </button>
            </div>

            {/* Form */}
            <form className="w-full flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>

              <div className={!isLogin ? "flex gap-4" : ""}>
                {!isLogin && (
                  <>
                    <div className="flex flex-col gap-1.5 flex-1">
                      <label className="text-sm font-medium text-slate-800">Username</label>
                      <input
                        type="text"
                        placeholder="John Doe"
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-400/30 focus:border-orange-400 placeholder-slate-400 bg-white transition"
                        name="username"
                        onChange={handleAuthInput}
                        value={authData.username}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5 flex-1">
                      <label className="text-sm font-medium text-slate-800">Email</label>
                      <input
                        type="email"
                        placeholder="name@example.com"
                        className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-400/30 focus:border-orange-400 placeholder-slate-400 bg-white transition"
                        name="email"
                        onChange={handleAuthInput}
                        value={authData.email}
                      />
                    </div>
                  </>
                )}
                {isLogin && (
                  <div className="flex flex-col gap-1.5 w-full">
                    <label className="text-sm font-medium text-slate-800">Email</label>
                    <input
                      type="email"
                      placeholder="name@example.com"
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-400/30 focus:border-orange-400 placeholder-slate-400 bg-white transition"
                      name="email"
                      onChange={handleAuthInput}
                      value={authData.email}
                    />
                  </div>
                )}
              </div>
      

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-800">Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-400/30 focus:border-orange-400 placeholder-slate-400 bg-white transition"
                  name="password"
                  onChange={handleAuthInput}
                  value={authData.password}
                />
              </div>

              <button
                type="submit"
                className="w-full bg-orange-600 hover:bg-orange-700 text-white font-medium py-2.5 rounded-full transition-colors mt-1"
                onClick={handleAuthSubmit}
              >
                {isLogin ? "Log In" : "Create Account"}
              </button>
              <button
                type="button"
                className="w-full flex items-center justify-center gap-2.5 bg-black hover:bg-neutral-900 text-white font-medium py-2.5 rounded-full transition-colors text-sm"
              >
                <SiGoogle className="size-4" />
                {isLogin ? "Continue with Google" : "Sign Up with Google"}
              </button>
            </form>

            {/* Footer */}
            <p className="text-xs text-slate-400 text-center leading-relaxed">
              {/* {isLogin ? "By logging in" : "By signing up"}, you agree to our{" "}<br /> */}
              <Link href="#" className="underline hover:text-slate-600 transition-colors">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="#" className="underline hover:text-slate-600 transition-colors">
                Privacy Policy
              </Link>
            </p>

          </div>
        </div>

      </div>
    </section>
  );
}
