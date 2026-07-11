import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const BROWSERLESS_URL = "https://chrome.browserless.io";
const VIEWPORT = { width: 1440, height: 900 };

// Sonnet 5 by default; set ANALYZE_MODEL=claude-opus-4-8 when the quality of
// this call matters more than its cost — the analysis is the founder's first
// impression of the product.
const ANALYZE_MODEL = Deno.env.get("ANALYZE_MODEL") ?? "claude-sonnet-5";

// What Claude must return. Structured outputs guarantee this exact shape —
// no JSON-escaping prompt rules, no markdown fences to strip. Same pattern
// as lib/propose.ts. Field descriptions here carry the shape guidance that
// used to live in the prompt's JSON template.
const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overall_score", "summary", "comments"],
  properties: {
    overall_score: {
      type: "integer",
      description: "Conversion readiness of the page, 1 (broken) to 10 (excellent)",
    },
    summary: {
      type: "string",
      description: "2 short sentences: the biggest conversion killer and one thing working",
    },
    comments: {
      type: "array",
      description: "3 to 8 findings, strongest first",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "element_id", "element_tag", "section", "dimension", "severity",
          "comment", "why_it_matters", "suggestion", "hypothesis", "variants",
          "test_type", "meta",
        ],
        properties: {
          element_id: {
            type: "integer",
            description: "id of the element from KEY ELEMENTS this finding is about",
          },
          element_tag: { type: "string", description: "tag of that element, e.g. h1" },
          section: { type: "string", description: "page section the element sits in" },
          dimension: {
            type: "string",
            enum: [
              "Value Proposition", "CTA Effectiveness", "Social Proof",
              "Friction & Clarity", "Urgency & Motivation", "Pricing Psychology",
            ],
          },
          severity: { type: "string", enum: ["critical", "warning", "suggestion"] },
          comment: {
            type: "string",
            description: "The problem in 1-2 short sentences. Direct, no filler. What is wrong and why a visitor bounces.",
          },
          why_it_matters: {
            type: "string",
            description: "1-2 sentences on the conversion impact — what this costs the founder in lost signups or clicks",
          },
          suggestion: {
            type: "string",
            description: "One sentence: the specific change to make",
          },
          hypothesis: {
            type: "string",
            description: "If [specific element] is changed to [specific thing], [signups/trials/clicks] will increase because [psychological reason]",
          },
          variants: {
            type: "array",
            items: { type: "string" },
            description: "2 exact drop-in replacements for the element's text, each within ±2 words of the original word_count",
          },
          test_type: { type: "string", enum: ["copy_change", "visibility", "reorder"] },
          meta: {
            type: "object",
            additionalProperties: false,
            required: ["effort", "impact"],
            properties: {
              effort: { type: "string", enum: ["Quick win", "Some work", "Big lift"] },
              impact: { type: "string", enum: ["High", "Medium", "Low"] },
            },
          },
        },
      },
    },
  },
} as const;

// Single Browserless /function call: screenshot + element extraction in one Chrome instance.
// This guarantees that element pixel positions align with the screenshot — they are measured
// from the exact same rendered DOM that was captured. The screenshot is returned as base64
// and decoded in Deno via atob() (standard Web API, no Node Buffer needed).
const EXTRACT_SCRIPT = `
export default async function({ page, context }) {
  const { url } = context;

  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  // Scroll through the full page to trigger lazy-loaded content,
  // then return to top so element positions are measured from the top.
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let total = 0;
      const timer = setInterval(() => {
        window.scrollBy(0, 100);
        total += 100;
        if (total >= document.body.scrollHeight) {
          clearInterval(timer);
          window.scrollTo(0, 0);
          resolve();
        }
      }, 50);
    });
  });

  // Screenshot taken from this same page instance — positions will match exactly.
  // Browserless runs in a browser (Chrome V8) context, not Node.js — no Buffer.
  // Chunk the Uint8Array → binary string to avoid call stack limits on large images.
  const rawScreenshot = await page.screenshot({ fullPage: true, type: 'webp' });
  const bytes = new Uint8Array(rawScreenshot);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const screenshotBase64 = btoa(binary);

  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);

  const elements = await page.evaluate(() => {
    // Original tags first — Claude's summary takes the first 50 elements in
    // capture order, so keeping this order preserves analysis behavior.
    // The tags appended at the end (p, a, li, label, img) exist for the
    // experiment builder, where founders can select any visible element.
    const selectors = [
      'h1','h2','h3','header','nav','footer','section','main',
      'button','form','img[alt]',
      '[class*="hero"]','[class*="cta"]','[class*="feature"]',
      '[class*="pricing"]','[class*="testimonial"]','[class*="trust"]',
      'p','a','li','label','img',
      // Styled fragments inside headings (e.g. the colored half of an h1) —
      // selectable on their own so founders can test just that part.
      'h1 span','h2 span','h3 span',
    ];

    // Unique CSS selector: climb to the nearest uniquely-id'd ancestor (or body),
    // disambiguating same-tag siblings with :nth-of-type at every step. Unique by
    // construction, and immune to unstable utility class names (Tailwind etc).
    function buildSelector(el) {
      const path = [];
      let node = el;
      while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
        if (node.id && document.querySelectorAll('#' + CSS.escape(node.id)).length === 1) {
          path.unshift('#' + CSS.escape(node.id));
          break;
        }
        let seg = node.tagName.toLowerCase();
        const parent = node.parentElement;
        if (parent) {
          const sameTag = Array.from(parent.children).filter(c => c.tagName === node.tagName);
          if (sameTag.length > 1) seg += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
        }
        path.unshift(seg);
        node = parent;
      }
      return path.join(' > ');
    }

    const seen = new Set();
    const results = [];
    let nextId = 0;
    const MAX_ELEMENTS = 300;

    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        if (results.length >= MAX_ELEMENTS) return;

        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = el.innerText?.trim();
        const alt = el.alt?.trim();
        const tag = el.tagName.toLowerCase();

        if (rect.width < 50 || rect.height < 20) return;
        if (!text && !alt && tag !== 'img') return;
        if (style.position === 'fixed' || style.position === 'sticky') return;

        const top  = Math.round(rect.top  + window.scrollY);
        const left = Math.round(rect.left + window.scrollX);
        // Tag-aware key: dedupes the same element matched by two selectors,
        // but keeps distinct nested elements that share a corner (a span at
        // the very start of its h1 would otherwise be dropped).
        const key  = tag + '-' + top + '-' + left;
        if (seen.has(key)) return;
        seen.add(key);

        const wordCount = text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
        const siblingCount = el.parentElement
          ? el.parentElement.querySelectorAll(tag).length
          : 1;

        // Current image URL — the builder shows it next to the replacement
        // field. Data URLs are skipped (huge, and not useful to display).
        const rawSrc = tag === 'img' ? (el.currentSrc || el.src || '') : '';
        const src = rawSrc && !rawSrc.startsWith('data:') ? rawSrc.slice(0, 500) : null;

        // Rich-text support: the text of each text node inside the element,
        // in document order (an h1 with a gradient span yields e.g.
        // ["Ship", "faster", "today"]). The builder shows one input per part
        // and the snippet rewrites text nodes in place — inner spans keep
        // their styling. Only captured when there IS inner markup; 2-8 parts
        // keeps the editor sane and the payload small.
        let textParts = null;
        if (el.children.length > 0 && text) {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          const parts = [];
          let node;
          while ((node = walker.nextNode()) && parts.length <= 8) {
            const t = node.nodeValue && node.nodeValue.trim();
            if (t) parts.push(t.slice(0, 200));
          }
          if (parts.length >= 2 && parts.length <= 8) textParts = parts;
        }

        results.push({
          id:          nextId++,
          tag,
          text:        text ? text.slice(0, 120) : null,
          alt:         alt  || null,
          className:   (el.className || '').toString().slice(0, 80),
          elId:        el.id || '',
          selector:    buildSelector(el),
          // Recovery data: if the selector goes stale after the founder
          // redeploys their site, the snippet re-finds the element by text.
          fallback:    { tag, text: (text || alt || '').slice(0, 80) },
          src,
          // Has child elements (spans, links…) — a plain-text variant would
          // flatten them, so the builder warns before a text test.
          hasMarkup:   el.children.length > 0,
          textParts,
          top, left,
          width:       Math.round(rect.width),
          height:      Math.round(rect.height),
          wordCount,
          siblingCount,
        });
      });
    });

    return results;
  });

  const pageText = await page.evaluate(() => document.body.innerText?.slice(0, 3000) || '');

  return {
    data: { elements, pageHeight, pageText, screenshotBase64 },
    type: 'application/json',
  };
}
`;

// ─── Section detection ────────────────────────────────────────────────────────
// Looks at each element's class names and id to classify it into a page section.
// This lets Claude say "your hero is weak" instead of "this h1 is weak."

type Section = { top: number; bottom: number };

function detectSections(elements: any[]): Record<string, Section> {
  const patterns: Record<string, RegExp> = {
    nav:          /nav|navbar|menu/i,
    hero:         /hero|banner|jumbotron|splash/i,
    features:     /feature|benefit|why|how/i,
    social_proof: /testimonial|review|trust|customer|logo/i,
    pricing:      /pric|plan|tier/i,
    cta:          /cta|signup|get.started/i,
    footer:       /footer/i,
  };

  const sections: Record<string, Section> = {};

  elements.forEach(el => {
    const identifier = `${el.className} ${el.elId} ${el.tag}`;
    for (const [name, pattern] of Object.entries(patterns)) {
      if (pattern.test(identifier)) {
        if (!sections[name]) sections[name] = { top: el.top, bottom: el.top + el.height };
        sections[name].bottom = Math.max(sections[name].bottom, el.top + el.height);
      }
    }
  });

  return sections;
}

function getSectionForElement(el: any, sections: Record<string, Section>): string {
  for (const [name, bounds] of Object.entries(sections)) {
    if (el.top >= bounds.top && el.top <= bounds.bottom) return name;
  }
  return 'body';
}

// ─── Main handler ─────────────────────────────────────────────────────────────

// CORS: the dashboard invokes this function from the browser, which sends an
// OPTIONS preflight first. Without these headers the browser blocks the call
// before it's even sent (shows up as FunctionsFetchError). curl never hits
// this because CORS is a browser-only mechanism.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const { url, user_id, report_id: incoming_report_id } = await req.json();

  const browserlessKey = Deno.env.get('BROWSERLESS_API_KEY')!;
  const anthropicKey   = Deno.env.get('ANTHROPIC_API_KEY')!;
  const supabaseUrl    = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const supabase = createClient(supabaseUrl, supabaseKey);

  let report_id = incoming_report_id;

  try {
    if (report_id) {
      // Called from the API route — report row already exists, just update status
      await supabase.from('reports').update({ status: 'processing' }).eq('id', report_id);
    } else if (user_id) {
      // Called directly (e.g. testing) — create the report row ourselves
      const { data, error } = await supabase
        .from('reports')
        .insert({ url, user_id, status: 'processing' })
        .select('id')
        .single();
      if (error) throw new Error(`Failed to create report: ${error.message}`);
      report_id = data.id;
      console.log('Created report:', report_id);
    }

    // ── Step 1: Screenshot + element extraction in one Chrome instance ────────
    const extractRes = await fetch(`${BROWSERLESS_URL}/function?token=${browserlessKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: EXTRACT_SCRIPT, context: { url } }),
    });

    if (!extractRes.ok) {
      throw new Error(`Browserless error ${extractRes.status}: ${await extractRes.text()}`);
    }

    const extractRaw = await extractRes.json();
    console.log('Extract raw response:', JSON.stringify(extractRaw).slice(0, 300));

    // Browserless may return { data: { ... } } or the payload directly
    const extractData = extractRaw.screenshotBase64 ? extractRaw : (extractRaw.data ?? extractRaw);
    const { elements, pageHeight, pageText, screenshotBase64 } = extractData;
    console.log('Elements extracted:', elements?.length, '| pageHeight:', pageHeight);

    if (!screenshotBase64) throw new Error('No screenshot returned from Browserless');

    // ── Step 2: Upload screenshot to Supabase Storage ──────────────────────
    // atob() is a standard Web API available in Deno — no Node Buffer needed.
    // Strip whitespace first in case the encoding added line breaks.
    const screenshotBytes = Uint8Array.from(atob(screenshotBase64.replace(/\s/g, '')), c => c.charCodeAt(0));
    const storagePath = `${report_id ?? 'test'}/${Date.now()}.webp`;

    const { error: uploadError } = await supabase.storage
      .from('screenshots')
      .upload(storagePath, screenshotBytes, { contentType: 'image/webp', upsert: true });

    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

    const { data: { publicUrl: screenshotUrl } } = supabase.storage
      .from('screenshots')
      .getPublicUrl(storagePath);

    // ── Step 3: Build element summary for Claude ───────────────────────────
    // We don't send all 200+ raw elements to Claude — just the meaningful ones
    // in a simplified format. The stable numeric `id` is what Claude uses to
    // reference elements back to us. No text matching needed.

    const sections = detectSections(elements);

    const elementSummary = elements.slice(0, 50).map((el: any) => {
      const entry: any = {
        id:         el.id,
        tag:        el.tag,
        text:       el.text?.slice(0, 100),
        word_count: el.wordCount ?? 0,
        section:    getSectionForElement(el, sections),
        position:   `${Math.round((el.top / pageHeight) * 100)}% from top`,
      };
      if ((el.siblingCount ?? 1) > 1) entry.siblings = el.siblingCount;
      return entry;
    });

    // ── Step 4: Claude analysis ────────────────────────────────────────────

    const prompt = `You are a senior conversion rate optimization (CRO) strategist. A startup founder needs to know why their landing page isn't converting visitors into customers.

YOUR ONLY JOB: Find what is stopping visitors from signing up, starting a trial, or clicking the CTA.

DO NOT FLAG: accessibility, alt text, SEO, performance, color contrast, navigation structure. Only flag things a growth marketer cares about — copy, placement, and messaging that directly affect whether someone converts.

TONE RULE: Read the page copy carefully and identify the industry, audience, and vocabulary in use (e.g. AI SaaS, fintech, legal, e-commerce). Every suggestion and variant you write must use that same vocabulary and register. A technical AI product should get technical copy. A law firm should get formal copy. Never suggest copy that sounds out of place on this specific site.

PAGE TEXT:
${pageText}

SECTIONS: ${Object.keys(sections).join(', ') || 'none detected'}

KEY ELEMENTS (reference by numeric id only):
Each element has a word_count showing how many words are in the current copy. If siblings is present, this element is one of N repeating items in the same container (e.g. 1 of 3 feature cards).
${JSON.stringify(elementSummary, null, 2)}

DIMENSIONS — pick exactly one per comment:
- "Value Proposition" — headline/subheadline doesn't communicate a specific, differentiated outcome
- "CTA Effectiveness" — CTA is generic, buried, or unclear about what happens after clicking
- "Social Proof" — weak or missing evidence that real people trust this product
- "Friction & Clarity" — copy or structure creates confusion or hesitation
- "Urgency & Motivation" — no reason to act now instead of later
- "Pricing Psychology" — pricing creates sticker shock, confusion, or doesn't guide a decision

RULES:
- 3 to 8 comments. Only include a comment if you would bet money on the hypothesis — fewer, stronger comments beat more, weaker ones. Do not pad to fill a quota.
- ONE element per comment. Never combine two elements (e.g. h1 + subtitle) into a single comment. Each comment must reference exactly one element_id.
- Each element_id must appear at most once in the comments array. Never create two comments for the same element.
- comment and why_it_matters: short, direct sentences. No em dashes. No "which causes" chains. No padding.
- variants: exact drop-in replacement copy for that element's text. Must match the element's word_count within ±2 words. Do not write longer copy to replace short copy.
- If an element has siblings > 1, it is one of N repeating items. Variants must be the same approximate length as each other and as the original — they all need to fit the same layout slot.
- effort: "Quick win" = copy change only. "Some work" = structural change. "Big lift" = new content or redesign.
- impact: expected conversion lift. "High" = major lever, "Medium" = meaningful, "Low" = incremental.
- Skip any comment you can't write a specific hypothesis for.
- Only reference element ids from the list above.

WHAT A GOOD COMMENT LOOKS LIKE (this is the bar — for an imaginary h1 reading "We help teams work better"):
- comment: "This headline could describe a thousand products. A visitor cannot tell what it does, who it is for, or why it beats the tool they already use."
- hypothesis: "If the h1 names the specific outcome and audience, hero CTA clicks will increase because visitors decide in seconds whether a page is relevant to them."
- variants: ["Ship your changelog in 5 minutes, not 5 days", "The changelog your users will actually read"]
Specific, punchy, and the variants are real copy someone could ship today.

NEVER PRODUCE THIS (too generic):
- comment: "The headline could be more engaging and compelling to visitors."
- suggestion: "Consider making the headline more benefit-focused."
If a comment could apply to any website, delete it.`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      ANALYZE_MODEL,
        max_tokens: 16000, // adaptive thinking spends from this budget too; 16K is the non-streaming ceiling
        messages:   [{ role: 'user', content: prompt }],
        output_config: { format: { type: 'json_schema', schema: ANALYSIS_SCHEMA } },
      }),
    });

    if (!claudeRes.ok) {
      throw new Error(`Claude error ${claudeRes.status}: ${await claudeRes.text()}`);
    }

    const claudeData = await claudeRes.json();
    const stopReason = claudeData.stop_reason;
    if (stopReason === 'refusal' || stopReason === 'max_tokens') {
      throw new Error(`Claude stopped early (${stopReason}) — analysis not completed`);
    }

    // Thinking blocks may precede the text block — never assume content[0].
    const rawText = claudeData.content.find((b: any) => b.type === 'text')?.text;
    if (!rawText) throw new Error('Claude returned no text');
    console.log('Claude stop_reason:', stopReason, '| output length:', rawText.length);

    // Structured outputs guarantee this parses and matches ANALYSIS_SCHEMA.
    const analysis = JSON.parse(rawText);

    // ── Step 5: Resolve element_id → real pixel coordinates ───────────────
    // The model returns "element 12 has a weak CTA". We look up element 12 in our
    // map and convert its Chrome-measured pixel positions to percentages so
    // the overlay works at any screen size.

    const elementMap: Record<number, any> = {};
    elements.forEach((el: any) => { elementMap[el.id] = el; });

    const resolvedComments = analysis.comments
      .map((comment: any) => {
        const el = elementMap[comment.element_id];
        if (!el) return null;

        // Confidence drops slightly if the model guessed the wrong tag for the element
        const confidence = comment.element_tag === el.tag ? 1.0 : 0.7;

        return {
          ...comment,
          confidence,
          selector:       el.selector,
          original_value: el.text ?? el.alt ?? null,
          top_pct:        el.top    / pageHeight,
          left_pct:       el.left   / VIEWPORT.width,
          width_pct:      el.width  / VIEWPORT.width,
          height_pct:     el.height / pageHeight,
        };
      })
      .filter(Boolean);

    // ── Step 6: Write results to Supabase ─────────────────────────────────
    // Only runs when a real report_id was passed. During testing (no report_id)
    // we skip the DB write and just return the JSON directly.

    if (report_id) {
      await supabase
        .from('reports')
        .update({
          status:         'complete',
          screenshot_url: screenshotUrl,
          page_height:    pageHeight,
          viewport_width: VIEWPORT.width,
          overall_score:  analysis.overall_score,
          summary:        analysis.summary,
          // Full element map (selectors + bounding boxes) — the experiment
          // builder hit-tests the cursor against these boxes on the screenshot.
          elements,
        })
        .eq('id', report_id);

      if (resolvedComments.length > 0) {
        const { error: commentsError } = await supabase
          .from('comments')
          .insert(resolvedComments.map((c: any) => ({
            report_id,
            element_id:     c.element_id,
            element_tag:    c.element_tag,
            section:        c.section,
            dimension:      c.dimension,
            severity:       c.severity,
            comment:        c.comment,
            why_it_matters: c.why_it_matters ?? null,
            suggestion:     c.suggestion,
            hypothesis:     c.hypothesis     ?? null,
            variants:       c.variants       ?? [],
            test_type:      c.test_type      ?? 'copy_change',
            selector:       c.selector       ?? null,
            original_value: c.original_value ?? null,
            meta:           c.meta           ?? null,
            confidence:     c.confidence,
            top_pct:        c.top_pct,
            left_pct:       c.left_pct,
            width_pct:      c.width_pct,
            height_pct:     c.height_pct,
          })));

        if (commentsError) throw new Error(`Comments insert failed: ${commentsError.message}`);
        console.log('Inserted', resolvedComments.length, 'comments for report', report_id);
      }
    }

    return Response.json({
      report_id,
      overall_score: analysis.overall_score,
      summary:       analysis.summary,
      screenshot_url: screenshotUrl,
      page_height:   pageHeight,
      comments:      resolvedComments,
    }, { headers: corsHeaders });

  } catch (err: any) {
    if (report_id) {
      await supabase
        .from('reports')
        .update({ status: 'error', error_message: err.message })
        .eq('id', report_id);
    }
    console.error(err);
    return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
  }
});
