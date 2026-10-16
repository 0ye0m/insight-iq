import { NextRequest, NextResponse } from 'next/server';

/**
 * Gateway bridge: forwards /api/* requests (except /api/ai/asr, which has its
 * own route) to the InsightIQ Express mini-service on port 3030. This makes the
 * app work both through the Caddy gateway (XTransformPort) and when the preview
 * panel hits the Next.js server directly.
 */

const BACKEND = 'http://127.0.0.1:3030';

async function proxy(req: NextRequest, path: string) {
  const incoming = new URL(req.url);
  const target = new URL(`${BACKEND}/api/${path}`);
  // copy query params (including XTransformPort, which the backend ignores)
  incoming.searchParams.forEach((v, k) => target.searchParams.set(k, v));

  const headers = new Headers();
  const ct = req.headers.get('content-type');
  if (ct) headers.set('Content-Type', ct);

  const init: RequestInit = {
    method: req.method,
    headers,
    signal: AbortSignal.timeout(240_000),
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.arrayBuffer();
  }

  try {
    const res = await fetch(target.toString(), init);
    const buf = await res.arrayBuffer();
    const out = new NextResponse(buf, { status: res.status });
    const outCt = res.headers.get('content-type');
    if (outCt) out.headers.set('Content-Type', outCt);
    const cd = res.headers.get('content-disposition');
    if (cd) out.headers.set('Content-Disposition', cd);
    return out;
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'BACKEND_UNREACHABLE',
          message: `InsightIQ backend is not reachable (${String(err instanceof Error ? err.message : err).slice(0, 120)}). Is the Express service running on port 3030?`,
        },
      },
      { status: 503 }
    );
  }
}

export async function GET(req: NextRequest) {
  const path = req.nextUrl.pathname.replace(/^\/api\//, '');
  return proxy(req, path);
}

export async function POST(req: NextRequest) {
  const path = req.nextUrl.pathname.replace(/^\/api\//, '');
  return proxy(req, path);
}

export async function DELETE(req: NextRequest) {
  const path = req.nextUrl.pathname.replace(/^\/api\//, '');
  return proxy(req, path);
}

export async function OPTIONS(req: NextRequest) {
  const path = req.nextUrl.pathname.replace(/^\/api\//, '');
  return proxy(req, path);
}
