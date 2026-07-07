"use client";

import { useState } from "react";

// Shown after activating an experiment: the one script tag the founder pastes
// into their site's <head>. site_id comes from activation (sites row is
// created on first activate for a domain).
export default function SnippetInstructions({ siteId }: { siteId: string }) {
    const [copied, setCopied] = useState(false);

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const tag = `<script defer src="${origin}/snippet.js" data-site-id="${siteId}"></script>`;

    async function copy() {
        await navigator.clipboard.writeText(tag);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    return (
        <div className="flex flex-col gap-2 bg-stone-50 border border-stone-200 rounded-xl p-4">
            <p className="text-xs font-medium text-stone-700">
                Install the snippet to start serving this experiment
            </p>
            <p className="text-xs text-stone-500 leading-relaxed">
                Paste this inside the <code className="text-orange-700">&lt;head&gt;</code> of
                your site. One tag covers every page and every experiment on this domain.
            </p>
            <div className="flex items-start gap-2">
                <pre className="flex-1 text-[11px] text-stone-700 bg-white border border-stone-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
                    {tag}
                </pre>
                <button
                    onClick={copy}
                    className="text-xs font-medium text-white bg-orange-600 hover:bg-orange-700 rounded-lg px-3 py-2 shrink-0 transition-colors"
                >
                    {copied ? "Copied!" : "Copy"}
                </button>
            </div>
        </div>
    );
}
