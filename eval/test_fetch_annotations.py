"""Offline tests for eval/fetch-annotations.py using a LOCAL http.server (no internet). Run: python -m unittest eval/test_fetch_annotations.py"""
import hashlib
import importlib.util
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("fetch_annotations", Path(__file__).resolve().parent / "fetch-annotations.py")
fa = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fa)

PAYLOAD = b"PARQUET-LIKE-BYTES-" * 100


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == "/start":
            self.send_response(302)
            self.send_header("Location", "/blob")
            self.send_header("X-Repo-Commit", "abc123")
            self.end_headers()
        elif self.path == "/to-evil":
            self.send_response(302)
            self.send_header("Location", "https://mirror.example.org/x")
            self.end_headers()
        elif self.path == "/blob":
            self.send_response(200)
            self.send_header("Content-Length", str(len(PAYLOAD)))
            self.end_headers()
            self.wfile.write(PAYLOAD)
        elif self.path == "/loop":
            self.send_response(302)
            self.send_header("Location", "/loop")
            self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()


class Fetch(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), H)
        cls.port = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def allow_local(self, host):
        return host == "127.0.0.1"

    def url(self, p):
        return f"http://127.0.0.1:{self.port}{p}"

    def test_follows_redirect_records_revision_and_hash(self):
        with tempfile.TemporaryDirectory() as d:
            dest = Path(d) / "f.bin"
            r = fa.fetch_one(self.url("/start"), dest, allowed=self.allow_local, require_https=False)
            self.assertEqual(r["revision"], "abc123")
            self.assertEqual(r["sha256"], hashlib.sha256(PAYLOAD).hexdigest())
            self.assertEqual(r["bytes"], len(PAYLOAD))
            self.assertEqual(dest.read_bytes(), PAYLOAD)
            self.assertFalse(Path(str(dest) + ".part").exists())

    def test_redirect_to_a_disallowed_host_stops_and_names_the_exact_host(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(fa.Stop) as cm:
                fa.fetch_one(self.url("/to-evil"), Path(d) / "f.bin", allowed=self.allow_local, require_https=False)
            self.assertIn("mirror.example.org", str(cm.exception))
            self.assertFalse((Path(d) / "f.bin").exists())

    def test_unreachable_host_names_the_host(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(fa.Stop) as cm:
                fa.fetch_one("https://huggingface.co:9/x", Path(d) / "f.bin", max_bytes=10)  # port 9 (discard) is not served
            self.assertIn("huggingface.co", str(cm.exception))

    def test_size_cap_and_redirect_loop_and_http_error(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(fa.Stop):
                fa.fetch_one(self.url("/blob"), Path(d) / "f.bin", allowed=self.allow_local, require_https=False, max_bytes=10)
            self.assertFalse((Path(d) / "f.bin").exists())
            self.assertFalse(Path(d, "f.bin.part").exists())
            with self.assertRaises(fa.Stop):
                fa.fetch_one(self.url("/loop"), Path(d) / "g.bin", allowed=self.allow_local, require_https=False)
            with self.assertRaises(fa.Stop) as cm:
                fa.fetch_one(self.url("/missing"), Path(d) / "h.bin", allowed=self.allow_local, require_https=False)
            self.assertIn("404", str(cm.exception))


class Policy(unittest.TestCase):
    def test_plain_http_is_refused_by_default(self):
        with self.assertRaises(fa.Stop):
            fa.fetch_one("http://huggingface.co/x", Path(tempfile.gettempdir()) / "never.bin")

    def test_default_host_allowlist_is_huggingface_only(self):
        for h in ["huggingface.co", "cdn-lfs.huggingface.co", "cas-bridge.xethub.hf.co", "hf.co"]:
            self.assertTrue(fa.host_allowed(h), h)
        for h in ["hf-mirror.com", "evilhuggingface.co", "huggingface.co.evil.org", "example.org", None, ""]:
            self.assertFalse(fa.host_allowed(h), str(h))

    def test_only_the_two_public_files_are_fetched(self):
        self.assertEqual(fa.FILES, ("data/train-00000-of-00001.parquet", "README.md"))


if __name__ == "__main__":
    unittest.main()
