import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';

/**
 * Platform LLM proxy — final fallback provider for the Express AI gateway
 * (mini-services/insightai-backend). Gemini/Groq keys are tried first; when
 * every key is unavailable (e.g. region-blocked), the gateway routes here.
 *
 * SECURITY: z-ai-web-dev-sdk runs server-side only. This route rejects any
 * request that passed through the public gateway (x-forwarded-for present),
 * so only the local backend (direct 127.0.0.1 call) can use it. No user keys
 * are involved and none are ever exposed to the browser.
 */

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
    const jsonMode: boolean = Boolean(body?.jsonMode);

    if (!user || typeof user !== 'string') {
      return NextResponse.json(
        { success: false, error: { message: 'user prompt is required' } },
        { status: 400 }
      );
    }
    // ~80k chars guard (roughly 20k tokens)
    if (user.length > 80_000) {
      return NextResponse.json(
        { success: false, error: { message: 'Prompt too large for platform provider (limit ~80k chars)' } },
        { status: 413 }
      );
    }

    const zai = await ZAI.create();
    const messages: Array<{ role: 'assistant' | 'user'; content: string }> = [];
    if (system) {
      messages.push({
        role: 'assistant',
        content: jsonMode ? `${system}\nRespond with ONLY a valid JSON object. No prose, no markdown fences.` : system,
      });
    } else if (jsonMode) {
      messages.push({ role: 'assistant', content: 'Respond with ONLY a valid JSON object. No prose, no markdown fences.' });
    }
    messages.push({ role: 'user', content: user });

    const completion = await zai.chat.completions.create({
      messages,
      thinking: { type: 'disabled' },
    });

    const text = completion?.choices?.[0]?.message?.content || '';
    if (!text.trim()) {
      return NextResponse.json(
        { success: false, error: { message: 'Platform model returned an empty response' } },
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
