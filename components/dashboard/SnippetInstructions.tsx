"use client";

import { useState } from "react";

// Shown after activating an experiment: the one script tag the founder pastes
// into their site's <head>. site_id comes from activation (sites row is
// created on first activate for a domain).
export default function SnippetInstructions({ siteId }: { siteId: string }) {
    const [copied, setCopied] = useState(false);

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    // Synchronous on purpose — NO defer/async. The script must run before the
    // browser paints, or visitors see the original content flash to the
    // variant. The route bakes this site's config into the (edge-cached)
    // response, so the cost is one small blocking request.
    const tag = `<script src="${origin}/api/snippet/js/${siteId}"></script>`;

    async function copy() {
        await navigator.clipboard.writeText(tag);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    return (
        <div className="flex flex-col gap-2 bg-stone-50 border border-stone-200 rounded-xl p-4 shadow-[0_15px_30px_-15px_rgba(0,0,0,0.1)] z-99">
            <p className="text-xs font-medium text-stone-700">
                Install the snippet to start serving this experiment
            </p>
            <p className="text-xs text-stone-500 leading-relaxed">
                Paste this at the <span className="font-medium">top</span> of your site&apos;s{" "}
                <code className="text-orange-700">&lt;head&gt;</code>, before other scripts,
                and don&apos;t add <code className="text-orange-700">defer</code> or{" "}
                <code className="text-orange-700">async</code>{" "} (that&apos;s what keeps your page
                from flashing). Our tag automatically covers every page and every experiment on this domain.
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
