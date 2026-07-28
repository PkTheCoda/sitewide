"use client";

import { Fragment, ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { LuChevronRight, LuExternalLink } from "react-icons/lu";

import logo from "@/public/assets/sitewide-logo-v7.svg";

type Crumb = { label: string; href?: string };

// Floating "island" header shared by the report and experiment-builder
// canvases (the two full-screen pages that live outside the dashboard shell,
// and therefore outside its sidebar nav). Three islands over the canvas:
//   left   — logo + breadcrumbs, so the dashboard is always one click away
//   center — mac-style browser bar naming the page under test
//   right  — the page's primary action (CTA, picking-goal pill…)
// Sticky with a gradient fade so it stays legible over the scrolling
// screenshot without a wall-to-wall white bar.
export default function CanvasHeader({
    crumbs,
    url,
    score,
    right,
}: {
    crumbs: Crumb[];
    url: string;
    score?: number | null;
    right?: ReactNode;
}) {
    const bareUrl = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const domain = bareUrl.replace(/\/.*$/, "");

    return (
        <div className="sticky top-0 z-30 px-8 pt-4 pb-3 bg-gradient-to-b from-stone-100 via-stone-100/90 to-transparent">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                {/* Left island — where am I, how do I get back */}
                <nav className="justify-self-start flex items-center gap-1 bg-white border border-stone-200 rounded-full shadow-xs pl-1.5 pr-3.5 py-1">
                    <Link href="/dashboard" title="Back to dashboard" className="shrink-0">
                        <Image src={logo} alt="Sitewide" className="h-7 w-auto" />
                    </Link>
                    {crumbs.map((crumb, i) => (
                        <Fragment key={i}>
                            <LuChevronRight className="size-3 text-stone-300 shrink-0" />
                            {crumb.href ? (
                                <Link
                                    href={crumb.href}
                                    className="text-xs text-stone-500 hover:text-stone-800 transition-colors whitespace-nowrap"
                                >
                                    {crumb.label}
                                </Link>
                            ) : (
                                <span className="text-xs font-medium text-stone-800 whitespace-nowrap">
                                    {crumb.label}
                                </span>
                            )}
                        </Fragment>
                    ))}
                </nav>

                {/* Center island — the page under test, mac-window style */}
                <div className="justify-self-center flex items-center gap-2.5 bg-white border border-stone-200 rounded-full shadow-xs px-4 py-2 min-w-0 max-w-md">
                    <span className="flex items-center gap-1.5 shrink-0" aria-hidden>
                        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
                        <span className="size-2.5 rounded-full bg-[#febc2e]" />
                        <span className="size-2.5 rounded-full bg-[#28c840]" />
                    </span>
                    <span className="h-4 w-px bg-stone-200 shrink-0" />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                        alt=""
                        className="size-4 rounded-sm shrink-0"
                    />
                    <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        title={`Open ${bareUrl} in a new tab`}
                        className="group flex items-center gap-1.5 min-w-0 text-xs text-stone-600 hover:text-stone-800 transition-colors"
                    >
                        <span className="truncate">{bareUrl}</span>
                        <LuExternalLink className="size-3 text-stone-300 group-hover:text-stone-500 transition-colors shrink-0" />
                    </a>
                    {typeof score === "number" && (
                        <span
                            className={`shrink-0 font-robot font-semibold text-[11px] tabular-nums rounded-full px-2 py-0.5 ${
                                score >= 8
                                    ? "bg-emerald-50 text-emerald-600"
                                    : score >= 6
                                      ? "bg-amber-50 text-amber-600"
                                      : "bg-rose-50 text-rose-600"
                            }`}
                        >
                            {score}/10
                        </span>
                    )}
                </div>

                {/* Right island — the page's primary action */}
                <div className="justify-self-end flex items-center gap-2">{right}</div>
            </div>
        </div>
    );
}
