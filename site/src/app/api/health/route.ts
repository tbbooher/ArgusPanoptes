import { NextResponse } from "next/server";

const HONO_BASE = process.env.HONO_BACKEND_URL || "http://127.0.0.1:3000";

export async function GET() {
  const url = `${HONO_BASE}/health`;

  try {
    const resp = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `Backend unavailable: ${msg}`, type: "proxy_error" },
      { status: 502 },
    );
  }
}
