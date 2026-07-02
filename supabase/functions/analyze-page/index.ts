import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const BROWSERLESS_URL = "https://chrome.browserless.io";
const VIEWPORT = { width: 1440, height: 900 };

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

        if (rect.width < 50 || rect.height < 20) return;
        if (!text && !alt) return;
        if (style.position === 'fixed' || style.position === 'sticky') return;

        const top  = Math.round(rect.top  + window.scrollY);
        const left = Math.round(rect.left + window.scrollX);
        const key  = top + '-' + left;
        if (seen.has(key)) return;
        seen.add(key);

        // Best-effort CSS selector: id → tag.class → tag
        const tag = el.tagName.toLowerCase();
        const cls = (el.className || '').toString().trim().split(/\s+/).filter(Boolean).slice(0, 2);
        const selector = el.id
          ? '#' + CSS.escape(el.id)
          : cls.length
            ? tag + '.' + cls.map(c => CSS.escape(c)).join('.')
            : tag;

        results.push({
          id:        nextId++,
          tag,
          text:      text ? text.slice(0, 120) : null,
          alt:       alt  || null,
          className: (el.className || '').toString().slice(0, 80),
          elId:      el.id || '',
          selector,
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

Deno.serve(async (req) => {
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

    const elementSummary = elements.slice(0, 50).map((el: any) => ({
      id:       el.id,
      tag:      el.tag,
      text:     el.text?.slice(0, 100),
      section:  getSectionForElement(el, sections),
      position: `${Math.round((el.top / pageHeight) * 100)}% from top`,
    }));

    // ── Step 4: Claude analysis ────────────────────────────────────────────

    const prompt = `You are a senior conversion rate optimization (CRO) strategist. A startup founder needs to know why their landing page isn't converting visitors into customers.

YOUR ONLY JOB: Find what is stopping visitors from signing up, starting a trial, or clicking the CTA.

DO NOT FLAG: accessibility, alt text, SEO, performance, color contrast, navigation structure. Only flag things a growth marketer cares about — copy, placement, and messaging that directly affect whether someone converts.

PAGE TEXT:
${pageText}

SECTIONS: ${Object.keys(sections).join(', ') || 'none detected'}

KEY ELEMENTS (reference by numeric id only):
${JSON.stringify(elementSummary, null, 2)}

DIMENSIONS — pick exactly one per comment:
- "Value Proposition" — headline/subheadline doesn't communicate a specific, differentiated outcome
- "CTA Effectiveness" — CTA is generic, buried, or unclear about what happens after clicking
- "Social Proof" — weak or missing evidence that real people trust this product
- "Friction & Clarity" — copy or structure creates confusion or hesitation
- "Urgency & Motivation" — no reason to act now instead of later
- "Pricing Psychology" — pricing creates sticker shock, confusion, or doesn't guide a decision

Return ONLY valid JSON, no markdown:
{
  "overall_score": <1-10>,
  "summary": "<2 short sentences: biggest conversion killer and one thing working>",
  "comments": [
    {
      "element_id": <number matching an id above>,
      "element_tag": "<tag>",
      "section": "<section>",
      "dimension": "<dimension>",
      "severity": "<critical|warning|suggestion>",
      "comment": "<the problem in 1-2 short sentences. Direct, no em dashes, no filler. State what is wrong and why a visitor bounces.>",
      "why_it_matters": "<1-2 sentences on the conversion impact. What does this cost the founder in lost signups or clicks?>",
      "suggestion": "<one sentence: the specific change to make>",
      "hypothesis": "<If [specific element] is changed to [specific thing], [signups/trials/clicks] will increase because [psychological reason]>",
      "variants": ["<variant 1: exact ready-to-use copy>", "<variant 2: exact ready-to-use copy>"],
      "test_type": "<copy_change|visibility|reorder>",
      "meta": { "effort": "<Quick win|Some work|Big lift>", "impact": "<High|Medium|Low>" }
    }
  ]
}

RULES:
- 8 to 10 comments.
- comment and why_it_matters: short, direct sentences. No em dashes. No "which causes" chains. No padding.
- variants: specific, drop-in ready. Actual copy — not descriptions. For layout changes, describe the exact move.
- effort: "Quick win" = copy change only. "Some work" = structural change. "Big lift" = new content or redesign.
- impact: expected conversion lift. "High" = major lever, "Medium" = meaningful, "Low" = incremental.
- Skip any comment you can't write a specific hypothesis for.
- Only reference element ids from the list above.`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 8000,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      throw new Error(`Claude error ${claudeRes.status}: ${await claudeRes.text()}`);
    }

    const claudeData = await claudeRes.json();
    let rawText = claudeData.content[0].text.trim();
    const stopReason = claudeData.stop_reason;
    console.log('Claude stop_reason:', stopReason, '| output length:', rawText.length);

    if (stopReason === 'max_tokens') {
      throw new Error(`Claude output was truncated (max_tokens hit at ${rawText.length} chars) — increase max_tokens or reduce comment count`);
    }

    if (rawText.startsWith('```')) {
      rawText = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    }
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
