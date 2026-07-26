// Automated-traffic filtering — ONE list, two consumers.
//
// Used by:
//   - GET /api/snippet/js/[siteId]  → baked into __SW_EMBED__.bots so the
//     snippet can drop bot events before they ever leave the browser
//   - POST /api/snippet/event       → backstop on the real User-Agent header
//     (catches legacy installs and anything that spoofed navigator.userAgent)
//
// Why the list lives here and not in public/snippet.js: snippet.js is served
// verbatim as a static file, so a list inside it can't be shared with the
// server and can't be updated without editing the runner itself. Shipping it
// through the embed keeps snippet.js to the ~20 lines of matching logic, gives
// both sides the same source of truth, and means list changes propagate on the
// config route's existing 30s edge TTL.
//
// What this is NOT: an anti-fraud system. Stealth-plugin scrapers and agentic
// browsers (ChatGPT Atlas, Perplexity Comet, Claude-in-Chrome) send an
// ordinary Chrome User-Agent and are not detectable this way by anyone. This
// catches the traffic that actually shows up on a marketing site — search
// crawlers, Lighthouse/PageSpeed runs, uptime monitors, prerender services and
// un-stealthed Puppeteer/Playwright — which is the overwhelming majority of it.
//
// Deliberately absent: behavioural rules (short sessions, no mouse movement,
// no interaction). Exposures are the denominator of every result, and
// engagement is precisely what a variant changes — filtering on it drops more
// visitors from the winning arm than the losing one and can flip a result.
// Everything below is decidable before the visitor sees anything.

// Lowercase substrings, matched with indexOf against a lowercased UA.
//
// The generic patterns carry most of the weight: well-behaved crawlers put
// "Bot/1.0" and a "+http://…/bot.html" contact URL in their UA, and no real
// browser has either. Bare "bot" is deliberately NOT here — "Cubot" is an
// Android phone brand and appears in genuine mobile UAs.
const BOT_UA_TOKENS = [
    // Generic conventions
    "bot/",
    "bot;",
    "bot)",
    "+http",
    "crawler",
    "spider",
    "scraper",

    // Headless / automation runtimes
    "headlesschrome",
    "headlessfirefox",
    "phantomjs",
    "selenium",
    "webdriver",
    "playwright",
    "puppeteer",
    "cypress",

    // Performance + uptime tooling (very common on marketing sites)
    "lighthouse",
    "pagespeed",
    "gtmetrix",
    "webpagetest",
    "pingdom",
    "uptimerobot",
    "better uptime",
    "betteruptime",
    "sentryuptimebot",
    "statuscake",
    "site24x7",
    "checkly",
    "newrelicpinger",
    "datadogsynthetics",

    // Prerender / screenshot services
    "prerender",
    "vercel-screenshot",
    "vercelbot",

    // Search engines that execute JavaScript
    "googlebot",
    "google-inspectiontool",
    "google web preview",
    "google-read-aloud",
    "googleother",
    "adsbot-google",
    "mediapartners-google",
    "storebot-google",
    "bingbot",
    "bingpreview",
    "adidxbot",
    "msnbot",
    "duckduckbot",
    "yandexbot",
    "yandex.com/bots",
    "baiduspider",
    "applebot",
    "petalbot",
    "slurp",
    "seznambot",
    "sogou",

    // SEO suites
    "ahrefs",
    "semrush",
    "mj12bot",
    "dotbot",
    "dataforseo",
    "screaming frog",
    "sitebulb",
    "rogerbot",
    "blexbot",
    "serpstatbot",

    // AI crawlers
    "gptbot",
    "oai-searchbot",
    "chatgpt-user",
    "claudebot",
    "claude-web",
    "anthropic-ai",
    "perplexitybot",
    "ccbot",
    "bytespider",
    "amazonbot",
    "meta-externalagent",
    "google-cloudvertexbot",

    // Link unfurlers
    "facebookexternalhit",
    "facebookcatalog",
    "linkedinbot",
    "twitterbot",
    "slackbot",
    "discordbot",
    "telegrambot",
    "pinterestbot",
    "redditbot",
    "embedly",
    "skypeuripreview",
    "w3c_validator",

    // Archives
    "archive.org_bot",
    "ia_archiver",

    // Raw HTTP clients — can't reach the snippet, but the event route is
    // public and these are what hand-rolled hits to it look like.
    "wget",
    "curl/",
    "python-requests",
    "python-urllib",
    "scrapy",
    "go-http-client",
    "okhttp",
    "libwww-perl",
    "node-fetch",
    "guzzlehttp",
    "apache-httpclient",
    "java/",
];

// Pipe-joined for the embed — one compact string the snippet splits once
// (~800 bytes raw, ~400 gzipped, on a response that is already edge-cached).
export const BOT_UA_PATTERN = BOT_UA_TOKENS.join("|");

export function isBotUserAgent(ua: string | null | undefined): boolean {
    // A browser always sends a User-Agent; an empty one is a script.
    if (!ua) return true;
    const lower = ua.toLowerCase();
    return BOT_UA_TOKENS.some((token) => lower.indexOf(token) !== -1);
}
