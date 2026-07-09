import { VariantPayload } from "@/lib/types";

// Builds a shareable preview URL: the founder's page with ?sw_preview=<token>,
// where the token is base64url({ s: selector, f: fallback, p: payload }).
// snippet.js decodes it and applies exactly that one change — no bucketing,
// no visitor cookie, no events.
//
// Because the change rides IN the link (not in the database), previews work
// BEFORE the experiment exists — straight from unsaved builder state — and
// for drafts, which the config route deliberately never serves. The only
// requirement is that the snippet is installed on the page.
export function buildPreviewLink(
    pageUrl: string,
    selector: string,
    fallback: { tag: string; text: string } | null,
    payload: VariantPayload
): string | null {
    if (!payload) return null; // control = the page as-is; nothing to preview
    let url: URL;
    try {
        url = new URL(pageUrl);
    } catch {
        return null;
    }
    const json = JSON.stringify({ s: selector, f: fallback, p: payload });
    // UTF-8 → binary string → base64url. Must mirror the snippet's decode
    // (atob → escape → decodeURIComponent), which reads the bytes as UTF-8.
    const bytes = new TextEncoder().encode(json);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    const token = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    url.searchParams.set("sw_preview", token);
    return url.toString();
}
