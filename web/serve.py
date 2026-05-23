#!/usr/bin/env python3
"""Static file server for the DockerRos web simulator.

Same behavior as the bash heredoc inside serve.sh, extracted so it can be
reused by both the macOS .command launcher and the Windows .bat launcher.

Sends `Cache-Control: no-cache` so browser edits land instantly during
development. Default port 8090; override with the PORT env var.
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main():
    port = int(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PORT", "8090"))
    # Serve from this script's directory regardless of CWD.
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f"Serving {os.getcwd()} at http://localhost:{port}")
    print("Ctrl+C to stop.")
    try:
        ThreadingHTTPServer(("", port), NoCacheHandler).serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
