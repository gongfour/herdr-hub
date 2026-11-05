"""herdr API calls for lib/herdr.js, with the request written in the same breath as connect.

herdr (0.9.3-0.9.5 on macOS) reads each API connection's request line non-blocking, one byte at a
time, and sleeps 100 ms whenever the byte is not there yet (src/api/server.rs,
read_initial_request_line_with_limits). Node's net.connect writes one event-loop turn after the
socket connects, which is often too late: about one call in five then costs ~105 ms, and nearly
every call sent alongside another. Here connect() and send() are two system calls back to back on
one thread (measured: 0 held of 300, 30 at a time). Threads would not do: a thread that has just
connected can wait for the GIL long enough to be late (134 of 300 held).

Protocol, newline-delimited JSON on stdin/stdout:
  in:  {"n": 1, "sock": "/path/herdr.sock", "req": "<the request line, no newline>", "t": 10000}
  out: {"ready": 1, "pid": 123}  once, at start
       {"n": 1, "line": "<herdr's reply line>"}
       {"n": 1, "err": "unreachable|timeout|empty_response|helper", "msg": "..."}
One thread, one selector: every call has its own deadline (t ms), after which its socket is
closed. stdin closing (the node exited, even by SIGKILL) ends the process.
"""
import json
import os
import selectors
import socket
import sys
import time

sel = selectors.DefaultSelector()
out = sys.stdout.buffer


def reply(obj):
    try:
        out.write((json.dumps(obj, separators=(",", ":")) + "\n").encode("utf-8"))
        out.flush()
    except (BrokenPipeError, OSError):
        os._exit(0)


class Call:
    __slots__ = ("n", "sock", "path", "out", "buf", "deadline", "t")

    def __init__(self, n, path, req, t):
        self.n, self.path, self.out, self.buf, self.t = n, path, req, b"", t
        self.deadline = time.monotonic() + max(t, 1) / 1000.0
        self.sock = None

    def start(self):
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock = s
        s.setblocking(False)
        try:
            s.connect(self.path)
        except (BlockingIOError, InterruptedError):
            # The listen queue is full (EAGAIN on a unix socket): send once it is writable.
            sel.register(s, selectors.EVENT_WRITE, self)
            return
        self.send()

    def send(self):
        try:
            k = self.sock.send(self.out)
        except (BlockingIOError, InterruptedError):
            k = 0
        except OSError as e:
            # herdr closed this connection (EPIPE, ECONNRESET): this call fails, not the helper.
            return self.fail("unreachable", "herdr socket %s: %s" % (self.path, e.strerror or e))
        self.out = self.out[k:]
        events = selectors.EVENT_WRITE if self.out else selectors.EVENT_READ
        try:
            sel.modify(self.sock, events, self)
        except KeyError:
            sel.register(self.sock, events, self)

    def ready(self, events):
        if events & selectors.EVENT_WRITE:
            e = self.sock.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR)
            if e:
                return self.fail("unreachable", "herdr socket %s: %s" % (self.path, os.strerror(e)))
            return self.send()
        try:
            chunk = self.sock.recv(65536)
        except (BlockingIOError, InterruptedError):
            return
        except OSError as e:
            if self.buf.strip():
                return self.done({"n": self.n, "line": self.buf.decode("utf-8", "replace")})
            return self.fail("empty_response", "herdr socket %s: %s" % (self.path, e.strerror or e))
        if not chunk:
            if self.buf.strip():
                return self.done({"n": self.n, "line": self.buf.decode("utf-8", "replace")})
            return self.fail("empty_response", "server closed without a reply")
        self.buf += chunk
        nl = chunk.find(b"\n")
        if nl >= 0:
            line = self.buf[: len(self.buf) - len(chunk) + nl]
            self.done({"n": self.n, "line": line.decode("utf-8", "replace")})

    def fail(self, code, msg):
        self.done({"n": self.n, "err": code, "msg": msg})

    def done(self, msg):
        self.close()
        reply(msg)

    def close(self):
        calls.pop(self.n, None)
        if self.sock is not None:
            try:
                sel.unregister(self.sock)
            except (KeyError, ValueError):
                pass
            self.sock.close()
            self.sock = None


calls = {}  # n -> Call


def take(line):
    msg = None
    try:
        msg = json.loads(line)
        c = Call(msg["n"], msg["sock"], (msg["req"] + "\n").encode("utf-8"), int(msg.get("t") or 10000))
        calls[c.n] = c
        c.start()
    except OSError as e:
        c.fail("unreachable", "herdr socket %s: %s" % (msg.get("sock"), e.strerror or e))
    except Exception as e:
        reply({"n": msg.get("n") if isinstance(msg, dict) else None, "err": "helper", "msg": repr(e)})


def main():
    os.set_blocking(0, False)
    sel.register(0, selectors.EVENT_READ, None)
    reply({"ready": 1, "pid": os.getpid()})
    pending = b""
    while True:
        now = time.monotonic()
        wait = min((c.deadline for c in calls.values()), default=now + 60) - now
        for key, events in sel.select(max(wait, 0)):
            if key.data is None:
                try:
                    data = os.read(0, 65536)
                except (BlockingIOError, InterruptedError):
                    continue
                if not data:
                    os._exit(0)  # the node is gone
                pending += data
                *lines, pending = pending.split(b"\n")
                for line in lines:
                    if line.strip():
                        take(line)
            else:
                c = key.data
                try:
                    c.ready(events)
                except Exception as e:  # one call's trouble ends that call, never the others
                    if c.sock is not None:
                        c.fail("helper", repr(e))
        now = time.monotonic()
        for c in [c for c in calls.values() if c.deadline <= now]:
            c.fail("timeout", "timed out after %d ms" % c.t)


if __name__ == "__main__":
    main()
