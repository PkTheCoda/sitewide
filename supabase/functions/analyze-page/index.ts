import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const BROWSERLESS_URL = "https://chrome.browserless.io";
const VIEWPORT = { width: 1440, height: 900 };

// This string is sent to Browserless and executed inside a real Chrome instance.
// It runs in Node.js (Puppeteer), NOT in Deno — that's why it's a string, not
// regular code. Chrome knows exactly where every element is because it just rendered them.
const BROWSER_SCRIPT = `
export default async function({ page, context }) {
  const { url } = context;

  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

  // Scroll through the full page to trigger lazy-loaded images/content,
  // then return to top so our screenshot starts from the beginning.
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

  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);

  // encoding: 'base64' returns a plain string instead of a Buffer,
  // which is safe to embed in our JSON response.
  const screenshot = await page.screenshot({
    fullPage: true,
    type: 'webp',
    encoding: 'base64',
  });

  const elements = await page.evaluate(() => {
    const selectors = [
      'h1','h2','h3','header','nav','footer','section','main',
      'button','form','img[alt]',
      '[class*="hero"]','[class*="cta"]','[class*="feature"]',
      '[class*="pricing"]','[class*="testimonial"]','[class*="trust"]',
    ];

    const seen = new Set();
    const results = [];
    let nextId = 0;

    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const text = el.innerText?.trim();
        const alt = el.alt?.trim();

        // Skip tiny, empty, and floating elements
        if (rect.width < 50 || rect.height < 20) return;
        if (!text && !alt) return;
        if (style.position === 'fixed' || style.position === 'sticky') return;

        // Absolute position on the full page (not just the viewport)
        const top  = Math.round(rect.top  + window.scrollY);
        const left = Math.round(rect.left + window.scrollX);

        // Deduplicate elements that matched multiple selectors
        const key = top + '-' + left;
        if (seen.has(key)) return;
        seen.add(key);

        results.push({
          id:        nextId++,
          tag:       el.tagName.toLowerCase(),
          text:      text  ? text.slice(0, 120)                   : null,
          alt:       alt   || null,
          className: (el.className || '').toString().slice(0, 80),
          elId:      el.id || '',
          top, left,
          width:  Math.round(rect.width),
          height: Math.round(rect.height),
        });
      });
    });

    return results;
  });

  const pageText = await page.evaluate(() => document.body.innerText?.slice(0, 3000) || '');

  return {
    data: { screenshot, elements, pageHeight, pageText },
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

Deno.serve(async (req) => {
  const { url, report_id } = await req.json();

  const browserlessKey = Deno.env.get('BROWSERLESS_API_KEY')!;
  const anthropicKey   = Deno.env.get('ANTHROPIC_API_KEY')!;
  const supabaseUrl    = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    if (report_id) {
      await supabase.from('reports').update({ status: 'processing' }).eq('id', report_id);
    }

    // ── Step 1: Run the browser script on Browserless ──────────────────────
    // We send our BROWSER_SCRIPT string to chrome.browserless.io/function.
    // Browserless spins up a real Chrome instance, runs our code inside it,
    // and returns whatever our function returns — in this case, screenshot +
    // element positions + page text.

    const browserRes = await fetch(
      `${BROWSERLESS_URL}/function?token=${browserlessKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: BROWSER_SCRIPT, context: { url } }),
      }
    );

    if (!browserRes.ok) {
      throw new Error(`Browserless error ${browserRes.status}: ${await browserRes.text()}`);
    }

    const { screenshot, elements, pageHeight, pageText } = await browserRes.json();

    // ── Step 2: Upload screenshot to Supabase Storage ──────────────────────
    // Convert the base64 string back to raw bytes for upload.
    const screenshotBytes = Uint8Array.from(atob(screenshot), c => c.charCodeAt(0));
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

    const elementSummary = elements.slice(0, 50).map((el: any) => ({
      id:       el.id,
      tag:      el.tag,
      text:     el.text?.slice(0, 100),
      section:  getSectionForElement(el, sections),
      position: `${Math.round((el.top / pageHeight) * 100)}% from top`,
    }));

    // ── Step 4: Claude analysis ────────────────────────────────────────────
    // Claude gets the readable page text + the element map with positions.
    // It returns structured JSON with comments referencing elements by id.
    // We use Haiku because it's cheap and plenty capable for structured output.

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `You are a CRO expert analyzing a landing page for conversion effectiveness.

PAGE TEXT:
${pageText}

SECTIONS DETECTED: ${Object.keys(sections).join(', ') || 'none detected'}

KEY ELEMENTS (reference ONLY by numeric id field):
${JSON.stringify(elementSummary, null, 2)}

Return ONLY valid JSON, no markdown wrapping:
{
  "overall_score": <1-10>,
  "summary": "<2 sentence overall assessment>",
  "comments": [
    {
      "element_id": <number — must match an id above>,
      "element_tag": "<tag>",
      "section": "<section name>",
      "dimension": "<Value Proposition|CTA Clarity|Social Proof|Trust Signals|Visual Hierarchy|Messaging>",
      "severity": "<critical|warning|suggestion|positive>",
      "comment": "<what is wrong and why it hurts conversion>",
      "suggestion": "<specific actionable fix>",
      "rewrite": "<improved copy if text element, otherwise null>"
    }
  ]
}

Rules: max 8 comments, at least 1 positive, reference elements by id only.`,
        }],
      }),
    });

    if (!claudeRes.ok) {
      throw new Error(`Claude error ${claudeRes.status}: ${await claudeRes.text()}`);
    }

    const claudeData  = await claudeRes.json();
    const analysis    = JSON.parse(claudeData.content[0].text);

    // ── Step 5: Resolve element_id → real pixel coordinates ───────────────
    // Claude said "element 12 has a weak CTA". We look up element 12 in our
    // map and convert its Chrome-measured pixel positions to percentages so
    // the overlay works at any screen size.

    const elementMap: Record<number, any> = {};
    elements.forEach((el: any) => { elementMap[el.id] = el; });

    const resolvedComments = analysis.comments
      .map((comment: any) => {
        const el = elementMap[comment.element_id];
        if (!el) return null;

        // Confidence drops slightly if Claude guessed the wrong tag for the element
        const confidence = comment.element_tag === el.tag ? 1.0 : 0.7;

        return {
          ...comment,
          confidence,
          top_pct:    el.top    / pageHeight,
          left_pct:   el.left   / VIEWPORT.width,
          width_pct:  el.width  / VIEWPORT.width,
          height_pct: el.height / pageHeight,
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
        })
        .eq('id', report_id);

      if (resolvedComments.length > 0) {
        await supabase
          .from('comments')
          .insert(resolvedComments.map((c: any) => ({ ...c, report_id })));
      }
    }

    return Response.json({
      overall_score: analysis.overall_score,
      summary:       analysis.summary,
      screenshot_url: screenshotUrl,
      page_height:   pageHeight,
      comments:      resolvedComments,
    });

  } catch (err: any) {
    if (report_id) {
      await supabase
        .from('reports')
        .update({ status: 'error', error_message: err.message })
        .eq('id', report_id);
    }
    console.error(err);
    return Response.json({ error: err.message }, { status: 500 });
  }
});
