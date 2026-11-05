"""A stand-in herdr API socket that reads like herdr 0.9.5 on macOS (src/api/server.rs
read_initial_request_line_with_limits): a thread per connection sets it non-blocking, reads the
request line one byte at a time, and sleeps 100 ms whenever the byte is not there yet. Then it
answers one line and closes. Methods: ping -> pong; hang -> never answers (until the client goes).
Usage: python3 sleepyherdr.py <socket path>; prints "ready" once listening."""
import json, os, socket, sys, threading, time

path = sys.argv[1]
try:
    os.unlink(path)
except FileNotFoundError:
    pass
srv = socket.socket(socket.AF_UNIX)
srv.bind(path)
srv.listen(128)


def serve(c):
    c.setblocking(False)
    line = b""
    while not line.endswith(b"\n"):
        try:
            b = c.recv(1)
        except BlockingIOError:
            time.sleep(0.1)
            continue
        if not b:
            c.close()
            return
        line += b
    req = json.loads(line)
    c.setblocking(True)
    if req["method"] == "hang":
        c.recv(1)  # until the client closes
    else:
        c.sendall((json.dumps({"id": req["id"], "result": {"type": "pong"}}) + "\n").encode())
    c.close()


print("ready", flush=True)
while True:
    c, _ = srv.accept()
    threading.Thread(target=serve, args=(c,), daemon=True).start()
