import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';

/**
 * Platform vision proxy — final fallback for image/frame understanding used by
 * the Express AI gateway (image.service.js / video.service.js). Runs the
 * platform vision model server-side via z-ai-web-dev-sdk.
 *
 * SECURITY: internal-only (see /api/ai/llm). Images are only sent when the
 * user explicitly triggers an analysis in the UI.
 */

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/bmp']);
const MAX_TOTAL_BASE64 = 30_000_000; // ~22MB decoded across all frames

export async function POST(req: NextRequest) {
  // Only the local backend knows the shared secret (both apps load root .env).
  const expected = process.env.INTERNAL_AI_PROXY_TOKEN;
  if (!expected || req.headers.get('x-internal-token') !== expected) {
    return NextResponse.json(
      { success: false, error: { message: 'This endpoint is internal-only.' } },
      { status: 403 }
    );
  }

  try {
    const body = await req.json().catch(() => null);
    const user: string | undefined = body?.user;
    const system: string | undefined = body?.system;
    const images: Array<{ mimeType?: string; base64?: string }> = Array.isArray(body?.images) ? body.images : [];

    if (!user || typeof user !== 'string' || images.length === 0) {
      return NextResponse.json(
        { success: false, error: { message: 'user prompt and at least one image are required' } },
        { status: 400 }
      );
    }

    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    > = [{ type: 'text', text: user }];
    let total = 0;
    for (const img of images.slice(0, 8)) {
      const mime = (img?.mimeType || 'image/jpeg').toLowerCase();
      const b64 = img?.base64 || '';
      if (!ALLOWED_MIME.has(mime) || !b64) continue;
      total += b64.length;
      content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } });
    }
    if (content.length < 2) {
      return NextResponse.json(
        { success: false, error: { message: 'No usable images (unsupported mime type?)' } },
        { status: 400 }
      );
    }
    if (total > MAX_TOTAL_BASE64) {
      return NextResponse.json(
        { success: false, error: { message: 'Images too large for platform provider' } },
        { status: 413 }
      );
    }

    const zai = await ZAI.create();
    const response = await zai.chat.completions.createVision({
      messages: [
        ...(system ? [{ role: 'assistant' as const, content: system }] : []),
        { role: 'user' as const, content },
      ],
      thinking: { type: 'disabled' },
    });

    const text = response?.choices?.[0]?.message?.content || '';
    if (!text.trim()) {
      return NextResponse.json(
        { success: false, error: { message: 'Platform vision model returned an empty response' } },
        { status: 502 }
      );
    }
    return NextResponse.json({ success: true, text, provider: 'platform' });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { message: String(err instanceof Error ? err.message : err).slice(0, 300) } },
      { status: 502 }
    );
  }
}
