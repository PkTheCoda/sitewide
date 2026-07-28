"use client";

import { useState } from "react";
import { LuCheck, LuCopy, LuExternalLink } from "react-icons/lu";

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
                    className="flex items-center gap-2 bg-stone-50 border border-stone-200 rounded-lg py-1.5 px-2.5"
                >
                    <span className="text-[11px] font-medium text-stone-600 shrink-0">
                        {link.label}
                    </span>
                    <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        title={link.url}
                        className="flex-1 min-w-0 truncate flex items-center gap-1 text-[11px] text-orange-600 hover:text-orange-700 transition-colors"
                    >
                        Open on your site
                        <LuExternalLink className="size-3 shrink-0" />
                    </a>
                    <button
                        type="button"
                        onClick={() => copy(link.url, idx)}
                        className="flex items-center gap-1 text-[11px] text-stone-500 hover:text-orange-600 shrink-0 transition-colors cursor-pointer"
                        aria-label={`Copy ${link.label} preview link`}
                    >
                        {copied === idx ? (
                            <>
                                <LuCheck className="size-3 text-emerald-500" /> Copied
                            </>
                        ) : (
                            <>
                                <LuCopy className="size-3" /> Copy
                            </>
                        )}
                    </button>
                </div>
            ))}
        </div>
    );
}
