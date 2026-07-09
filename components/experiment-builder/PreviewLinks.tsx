"use client";

import { useState } from "react";

type PreviewLink = { label: string; url: string };

// A stack of "open on your site" preview links, one per variant, each with a
// copy button (founders paste these into Slack for their cofounder). The URLs
// come from lib/preview.ts buildPreviewLink — the page URL plus a
// ?sw_preview token the snippet knows how to apply.
export default function PreviewLinks({ links }: { links: PreviewLink[] }) {
    const [copied, setCopied] = useState<number | null>(null);

    async function copy(url: string, idx: number) {
        try {
            await navigator.clipboard.writeText(url);
            setCopied(idx);
            setTimeout(() => setCopied(null), 1500);
        } catch {
            /* clipboard blocked — the link is still right there to select */
        }
    }

    return (
        <div className="flex flex-col gap-1.5">
            {links.map((link, idx) => (
                <div
                    key={idx}
                    className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-md py-1.5 px-2.5"
                >
                    <span className="text-[11px] font-medium text-slate-600 shrink-0">
                        {link.label}
                    </span>
                    <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        title={link.url}
                        className="flex-1 min-w-0 truncate text-[11px] text-orange-600 hover:text-orange-700 transition-colors"
                    >
                        Open on your site ↗
                    </a>
                    <button
                        type="button"
                        onClick={() => copy(link.url, idx)}
                        className="text-[11px] text-slate-500 hover:text-orange-600 shrink-0 transition-colors"
                    >
                        {copied === idx ? "Copied!" : "Copy link"}
                    </button>
                </div>
            ))}
        </div>
    );
}
