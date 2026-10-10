// Completes the protected-preview sign-in: follows the share link's redirects manually (max 8 hops, only to the preview host or *.vercel.com,
// https only), keeping a per-run cookie jar. Returns the Cookie header for the preview host; "" when no share link is set.
// Never logs URLs, cookie names/values or response bodies; failures are reported as fixed codes.

export async function cookieFromShare(BASE: string): Promise<string> {
  const share = process.env.PREVIEW_SHARE_URL;
  if (!share) return "";
  const previewHost = new URL(BASE).host;
  const jar = new Map<string, Map<string, string>>(); // host -> name -> value
  let url = share;
  for (let hop = 0; hop < 8; hop++) {
    const u = new URL(url);
    if (u.protocol !== "https:" || !(u.host === previewHost || u.host === "vercel.com" || u.host.endsWith(".vercel.com"))) throw new Error("share_redirect_host_refused");
    const cookie = [...(jar.get(u.host) ?? [])].map(([k, v]) => `${k}=${v}`).join("; ");
    const r = await fetch(url, { redirect: "manual", headers: cookie ? { cookie } : {} });
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";"); const i = pair!.indexOf("=");
      if (i > 0) { const m = jar.get(u.host) ?? new Map(); m.set(pair!.slice(0, i).trim(), pair!.slice(i + 1)); jar.set(u.host, m); }
    }
    const loc = r.headers.get("location");
    await r.arrayBuffer().catch(() => undefined);
    if (r.status >= 300 && r.status < 400 && loc) { url = new URL(loc, url).toString(); continue; }
    if (r.status === 410 || r.status === 404) throw new Error("share_link_expired_or_invalid");
    break;
  }
  // A valid share link ends with the preview host's _vercel_jwt cookie. A chain that lands on the vercel.com login instead means the link
  // was not accepted (expired or revoked): stop, never fall back to public access.
  const mine = jar.get(previewHost);
  if (!mine?.has("_vercel_jwt")) throw new Error("share_link_not_accepted_expired_or_revoked");
  return [...mine].map(([k, v]) => `${k}=${v}`).join("; ");
}

