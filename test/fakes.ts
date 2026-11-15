import type { Fetcher } from "../src/google";

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** A stand-in for Google that records every request and answers from a script. */
export function fakeGoogle(answers: Array<{ status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const fetcher: Fetcher = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    const next = answers.shift();
    if (!next) throw new Error(`Unexpected request to ${url}`);
    return new Response(JSON.stringify(next.json), { status: next.status ?? 200 });
  };
  return { calls, fetcher };
}

/** An unsigned ID token shaped like Google's, for tests only. */
export function fakeIdToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${part({ alg: "none" })}.${part(claims)}.sig`;
}
