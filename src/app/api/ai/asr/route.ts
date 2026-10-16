import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';

/**
 * ASR proxy — used by the Express media pipeline (video transcription, best effort).
 * Accepts { audioBase64, mimeType } and returns { success, text } | { success:false, error }.
 * The z-ai SDK must only run server-side, which is why this lives as a Next route.
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const audioBase64: string | undefined = body?.audioBase64;
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      return NextResponse.json({ success: false, error: { message: 'audioBase64 is required' } }, { status: 400 });
    }
    // ~25MB decoded cap
    if (audioBase64.length > 34_000_000) {
      return NextResponse.json({ success: false, error: { message: 'Audio too large for transcription (limit ~25MB)' } }, { status: 413 });
    }

    const zai = await ZAI.create();
    const response = await zai.audio.asr.create({ file_base64: audioBase64 });
    const text = response?.text || '';

    return NextResponse.json({ success: true, text });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: { message: String(err instanceof Error ? err.message : err).slice(0, 300) } },
      { status: 502 }
    );
  }
}
