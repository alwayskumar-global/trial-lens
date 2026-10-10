#!/usr/bin/env python3
"""Download ONLY the two public files of the TrialGPT criterion-annotation dataset into this checkout's gitignored eval/data/ (docs/eval-annotation-mapping.md
section 9):  data/train-00000-of-00001.parquet  and  README.md  from https://huggingface.co/datasets/ncbi/TrialGPT-Criterion-Annotations.

Safety: https only; redirects are followed MANUALLY and only to huggingface.co / *.huggingface.co / *.hf.co. If a redirect points anywhere else, or a host cannot be reached
(for example the cloud environment's network policy denies it), the script STOPS and prints the exact host; it never tries a mirror and never changes network settings.
No token, no credentials. Records the dataset revision (the commit the host reports) and the SHA-256 of each file in gitignored download-manifest.json. It reads no file content.

  python3 eval/fetch-annotations.py
"""
import hashlib
import importlib.util
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urljoin, urlparse

REPO = "ncbi/TrialGPT-Criterion-Annotations"
FILES = ("data/train-00000-of-00001.parquet", "README.md")
DEST_REL = "eval/data/trialgpt-criterion-annotations"
MAX_BYTES = 200_000_000
MAX_HOPS = 6


class Stop(Exception):
    """A hard stop with a message that names the exact host involved."""


def host_allowed(host):
    host = (host or "").lower()
    return host in ("huggingface.co", "hf.co") or host.endswith(".huggingface.co") or host.endswith(".hf.co")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def fetch_one(url, dest, allowed=host_allowed, opener=None, max_bytes=MAX_BYTES, require_https=True):
    """Fetch `url` to `dest` following redirects by hand. Returns {revision, sha256, bytes, hosts}."""
    opener = opener or urllib.request.build_opener(_NoRedirect)
    hosts, revision = [], None
    cur = url
    for _ in range(MAX_HOPS):
        u = urlparse(cur)
        if u.scheme != "https" and (require_https or u.scheme != "http"):
            raise Stop(f"refusing a non-https URL (host {u.hostname})")
        if not allowed(u.hostname):
            raise Stop(f"redirect or URL points to a host that is not allowed: {u.hostname}")
        hosts.append(u.hostname)
        try:
            resp = opener.open(urllib.request.Request(cur, headers={"User-Agent": "triallens-eval-fetch"}), timeout=60)
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307, 308) and e.headers.get("Location"):
                revision = revision or e.headers.get("X-Repo-Commit")
                cur = urljoin(cur, e.headers["Location"])
                continue
            raise Stop(f"HTTP {e.code} from host {u.hostname}")
        except (urllib.error.URLError, OSError) as e:
            raise Stop(f"cannot reach host {u.hostname}: {type(e).__name__}")
        with resp:
            revision = revision or resp.headers.get("X-Repo-Commit")
            tmp = Path(str(dest) + ".part")
            h, n = hashlib.sha256(), 0
            tmp.parent.mkdir(parents=True, exist_ok=True)
            with open(tmp, "wb") as f:
                for chunk in iter(lambda: resp.read(1 << 20), b""):
                    n += len(chunk)
                    if n > max_bytes:
                        tmp.unlink(missing_ok=True)
                        raise Stop(f"download from {u.hostname} exceeds the {max_bytes} byte cap")
                    h.update(chunk)
                    f.write(chunk)
            tmp.replace(dest)
        return {"revision": revision, "sha256": h.hexdigest(), "bytes": n, "hosts": hosts}
    raise Stop("too many redirects")


def _inspector():
    spec = importlib.util.spec_from_file_location("inspect_annotations", Path(__file__).resolve().parent / "inspect-annotations.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def main():
    ia = _inspector()
    root = ia.REPO_ROOT
    dest_dir = ia.resolve_inside_data(DEST_REL, root=root, must_exist=False)
    out = {}
    pinned = None
    for rel in FILES:
        dest = ia.resolve_inside_data(f"{DEST_REL}/{rel}", root=root, must_exist=False)
        rev = pinned or "main"  # after the first file, pin the second to the same revision
        url = f"https://huggingface.co/datasets/{REPO}/resolve/{rev}/{rel}"
        try:
            r = fetch_one(url, dest)
        except Stop as e:
            print(f"STOPPED: {e}", file=sys.stderr)
            sys.exit(2)
        pinned = pinned or r["revision"]
        out[rel] = r
        print(f"{rel}: {r['bytes']} bytes, sha256 {r['sha256']}, revision {r['revision'] or 'not reported by the host'}, hosts {', '.join(r['hosts'])}")
    manifest = dest_dir / "download-manifest.json"
    manifest.write_text(json.dumps({"repo": REPO, "files": out}, indent=1) + "\n")
    print(f"wrote {manifest.relative_to(root.resolve())} (gitignored)")


if __name__ == "__main__":
    main()
