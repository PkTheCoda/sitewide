import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "@supabase/supabase-js";

const BROWSERLESS_URL = "https://chrome.browserless.io";
const VIEWPORT = { width: 1440, height: 900 };

// Runs inside Browserless's Chrome via the /function endpoint.
// Does element extraction only — screenshot is handled separately via /screenshot
// so we never have to deal with binary encoding in a sandboxed environment.
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

        results.push({
          id:        nextId++,
          tag:       el.tagName.toLowerCase(),
          text:      text ? text.slice(0, 120) : null,
          alt:       alt  || null,
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
    data: { elements, pageHeight, pageText },
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

    // ── Step 1: Screenshot + element extraction in parallel ───────────────
    // Two separate Browserless calls, each in its own Chrome instance.
    // Running them in parallel saves ~15-30 seconds vs sequential.
    //
    // /screenshot returns raw image bytes — no encoding issues.
    // /function runs our EXTRACT_SCRIPT — returns plain JSON.
    // scrollPage: true on /screenshot mirrors our manual autoScroll in the
    // extract script, so lazy-loaded content appears in both.

    const [screenshotRes, extractRes] = await Promise.all([
      fetch(`${BROWSERLESS_URL}/screenshot?token=${browserlessKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          options: { fullPage: true, type: 'webp' },
          viewport: VIEWPORT,
          scrollPage: true,
        }),
      }),
      fetch(`${BROWSERLESS_URL}/function?token=${browserlessKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: EXTRACT_SCRIPT, context: { url } }),
      }),
    ]);

    if (!screenshotRes.ok) {
      throw new Error(`Browserless screenshot error ${screenshotRes.status}: ${await screenshotRes.text()}`);
    }
    if (!extractRes.ok) {
      throw new Error(`Browserless extract error ${extractRes.status}: ${await extractRes.text()}`);
    }

    const extractRaw = await extractRes.json();
    console.log('Extract raw response:', JSON.stringify(extractRaw).slice(0, 300));

    // Browserless may return { data: { elements, ... } } or { elements, ... } directly
    const extractData = extractRaw.elements ? extractRaw : (extractRaw.data ?? extractRaw);
    const { elements, pageHeight, pageText } = extractData;
    console.log('Elements extracted:', elements?.length, '| pageHeight:', pageHeight);

    // ── Step 2: Upload screenshot to Supabase Storage ──────────────────────
    // screenshotRes.arrayBuffer() gives us raw bytes — no base64 dance needed.
    const screenshotBytes = new Uint8Array(await screenshotRes.arrayBuffer());
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

    // ── Step 4: Gemini analysis ────────────────────────────────────────────
    // Gemini gets the readable page text + the element map with positions.
    // responseMimeType: 'application/json' tells Gemini to return pure JSON —
    // no markdown code fences to strip, no parsing surprises.

    const prompt = `You are a CRO expert analyzing a landing page for conversion effectiveness.

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

Rules: max 15 comments, at least 1 positive, reference elements by id only.`;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      throw new Error(`Claude error ${claudeRes.status}: ${await claudeRes.text()}`);
    }

    const claudeData = await claudeRes.json();
    let rawText = claudeData.content[0].text.trim();
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
        const { error: commentsError } = await supabase
          .from('comments')
          .insert(resolvedComments.map((c: any) => ({
            report_id,
            element_id:  c.element_id,
            element_tag: c.element_tag,
            section:     c.section,
            dimension:   c.dimension,
            severity:    c.severity,
            comment:     c.comment,
            suggestion:  c.suggestion,
            rewrite:     c.rewrite ?? null,
            confidence:  c.confidence,
            top_pct:     c.top_pct,
            left_pct:    c.left_pct,
            width_pct:   c.width_pct,
            height_pct:  c.height_pct,
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
