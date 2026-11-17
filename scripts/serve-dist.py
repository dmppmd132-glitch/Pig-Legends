#!/usr/bin/env python3
"""Serve ./dist the way GitHub Pages will serve it.

Two differences from `vite preview` matter here:

* Pages hosts the build under the `/Pig-Legends/` project path, so the tree is
  mounted at that prefix instead of the host root — which is exactly what
  catches a wrong `base` or an un-prefixed asset URL.
* A dev server that caches makes a rebuilt bundle look unchanged. Everything is
  served with `no-store` so a reload always shows the current build.

    python3 scripts/serve-dist.py [port]
"""

import functools
import http.server
import pathlib
import socketserver
import sys
import urllib.parse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4174
BASE = "/Pig-Legends/"
DIST = pathlib.Path(__file__).resolve().parent.parent / "dist"


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def do_GET(self):  # noqa: N802 - stdlib naming
        # The Pages root belongs to the account, not to this project.
        if urllib.parse.urlsplit(self.path).path in ("/", ""):
            self.send_response(302)
            self.send_header("Location", BASE)
            self.end_headers()
            return
        return super().do_GET()

    def translate_path(self, path: str) -> str:
        """Map the project prefix onto the dist root, then delegate.

        Everything resolves against `directory` (dist), never the project root:
        an accidental fallthrough would serve the *source* index.html, which
        references `/src/main.tsx` and silently renders a blank page.
        """
        parsed = urllib.parse.urlsplit(path)
        rest = urllib.parse.unquote(parsed.path)
        if rest in (BASE, BASE.rstrip("/"), "/"):
            rest = "/index.html"
        elif rest.startswith(BASE):
            rest = "/" + rest[len(BASE) :]
        else:
            # Anything outside the project path is not ours to serve.
            rest = "/__not_found__"
        return super().translate_path(rest)


def main() -> None:
    if not (DIST / "index.html").is_file():
        raise SystemExit("dist/index.html is missing — run `npm run build` first")
    socketserver.TCPServer.allow_reuse_address = True
    handler = functools.partial(Handler, directory=str(DIST))
    with socketserver.TCPServer(("0.0.0.0", PORT), handler) as httpd:
        print(f"serving {DIST} at http://0.0.0.0:{PORT}{BASE}", flush=True)
        httpd.serve_forever()


if __name__ == "__main__":
    main()
