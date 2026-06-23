"use client";

import { useState } from "react";
import Link from "next/link";
import { SiGoogle } from "react-icons/si";
import Image from "next/image";
import logo from "@/public/assets/sitewide-logo-v3.svg";

import { createNewUser, signInWithEmail, NewUserData } from "@/services/auth";
import { useRouter } from "next/navigation";

const COLS = 12;
const ROWS = 5;

type Tab = "login" | "signup";

type FormErrors = {
  username?: string;
  email?: string;
  password?: string;
  form?: string; // top-level error from the backend (e.g. wrong password, email taken)
};

export default function AuthPage() {
  const [tab, setTab] = useState<Tab>("signup");
  const isLogin = tab === "login";
  const router = useRouter();

  const [authData, setAuthData] = useState<NewUserData>({
    username: "",
    email: "",
    password: "",
  });

  const [errors, setErrors] = useState<FormErrors>({});

  // Validate fields client-side before hitting the backend
  function validate(): FormErrors {
    const errs: FormErrors = {};

    if (!isLogin && !authData.username?.trim()) {
      errs.username = "Username is required.";
    }

    if (!authData.email.trim()) {
      errs.email = "Email is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authData.email)) {
      errs.email = "Enter a valid email address.";
    }

    if (!authData.password) {
      errs.password = "Password is required.";
    } else if (authData.password.length < 6) {
      errs.password = "Password must be at least 6 characters.";
    }

    return errs;
  }

  function handleAuthInput(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setAuthData(prev => ({ ...prev, [name]: value }));
    // Clear the specific field error as the user types so they get instant feedback
    if (errors[name as keyof FormErrors]) {
      setErrors(prev => ({ ...prev, [name]: undefined, form: undefined }));
    }
  }

  // Clear errors when switching tabs so stale messages don't carry over
  function handleTabChange(newTab: Tab) {
    setTab(newTab);
    setErrors({});
  }

  async function handleAuthSubmit(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();

    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setErrors({});

    if (isLogin) {
      const { error } = await signInWithEmail(authData);
      if (error) {
        setErrors({ form: "Incorrect email or password." });
        return;
      }
    } else {
      const { error } = await createNewUser(authData);
      if (error) {
        // Supabase returns "User already registered" for duplicate emails
        if (error.message.toLowerCase().includes("already registered")) {
          setErrors({ email: "An account with this email already exists." });
        } else {
          setErrors({ form: "Something went wrong. Please try again." });
        }
        return;
      }
      setAuthData({ username: "", email: "", password: "" });
    }

    router.push("/dashboard");
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
                onClick={() => handleTabChange("login")}
                className={`flex-1 text-center py-1.5 text-sm font-medium rounded-full transition-all ${
                  isLogin
                    ? "text-slate-900 bg-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Log In
              </button>
              <button
                onClick={() => handleTabChange("signup")}
                className={`flex-1 text-center py-1.5 text-sm font-medium rounded-full transition-all ${
                  !isLogin
                    ? "text-slate-900 bg-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Sign Up
              </button>
            </div>

            {/* Form-level error (backend errors not tied to a specific field) */}
            {errors.form && (
              <p className="text-xs text-red-500 text-center w-full -mb-4">
                {errors.form}
              </p>
            )}

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
                        className={`w-full border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-400/30 focus:border-orange-400 placeholder-slate-400 bg-white transition ${
                          errors.username ? "border-red-400" : "border-slate-200"
                        }`}
                        name="username"
                        onChange={handleAuthInput}
                        value={authData.username}
                      />
                      {errors.username && (
                        <p className="text-xs text-red-500">{errors.username}</p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 flex-1">
                      <label className="text-sm font-medium text-slate-800">Email</label>
                      <input
                        type="email"
                        placeholder="name@example.com"
                        className={`w-full border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-400/30 focus:border-orange-400 placeholder-slate-400 bg-white transition ${
                          errors.email ? "border-red-400" : "border-slate-200"
                        }`}
                        name="email"
                        onChange={handleAuthInput}
                        value={authData.email}
                      />
                      {errors.email && (
                        <p className="text-xs text-red-500">{errors.email}</p>
                      )}
                    </div>
                  </>
                )}
                {isLogin && (
                  <div className="flex flex-col gap-1.5 w-full">
                    <label className="text-sm font-medium text-slate-800">Email</label>
                    <input
                      type="email"
                      placeholder="name@example.com"
                      className={`w-full border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-400/30 focus:border-orange-400 placeholder-slate-400 bg-white transition ${
                        errors.email ? "border-red-400" : "border-slate-200"
                      }`}
                      name="email"
                      onChange={handleAuthInput}
                      value={authData.email}
                    />
                    {errors.email && (
                      <p className="text-xs text-red-500">{errors.email}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-slate-800">Password</label>
                <input
                  type="password"
                  placeholder="••••••••"
                  className={`w-full border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-400/30 focus:border-orange-400 placeholder-slate-400 bg-white transition ${
                    errors.password ? "border-red-400" : "border-slate-200"
                  }`}
                  name="password"
                  onChange={handleAuthInput}
                  value={authData.password}
                />
                {errors.password && (
                  <p className="text-xs text-red-500">{errors.password}</p>
                )}
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
