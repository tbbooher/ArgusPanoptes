import { NextRequest, NextResponse } from "next/server";

const HONO_BASE = process.env.HONO_BACKEND_URL || "http://127.0.0.1:3000";

export async function GET(request: NextRequest) {
  const title = request.nextUrl.searchParams.get("title");
  if (!title) {
    return NextResponse.json(
      { error: "Missing required query parameter: title", type: "validation_error" },
      { status: 400 },
    );
  }

  const params = new URLSearchParams({ title });
  const author = request.nextUrl.searchParams.get("author");
  if (author) params.set("author", author);
  const maxIsbns = request.nextUrl.searchParams.get("maxIsbns");
  if (maxIsbns) params.set("maxIsbns", maxIsbns);

  const url = `${HONO_BASE}/search/title?${params.toString()}`;

  try {
    const resp = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(120_000),
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
