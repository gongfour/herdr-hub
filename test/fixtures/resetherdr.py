"""A herdr API socket that drops every connection at once, unread, with a reset (SO_LINGER 0): the
client's send or read fails with EPIPE / ECONNRESET, as when herdr exits or refuses a request.
Usage: python3 resetherdr.py <socket path>; prints "ready" once listening."""
import os, socket, struct, sys

path = sys.argv[1]
try:
    os.unlink(path)
except FileNotFoundError:
    pass
srv = socket.socket(socket.AF_UNIX)
srv.bind(path)
srv.listen(128)
print("ready", flush=True)
while True:
    c, _ = srv.accept()
    c.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
    c.close()
