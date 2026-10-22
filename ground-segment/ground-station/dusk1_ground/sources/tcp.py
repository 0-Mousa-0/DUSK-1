import socket
import time

from ..config import RETRY_S
from .base import LineSource


class TcpSource(LineSource):
    """The Ground OBC over Wi-Fi: join DUSK1-GROUND, it streams on TCP port 5760."""

    def __init__(self, host: str, port: int, sink, events):
        super().__init__(f"Ground OBC at {host}:{port} (Wi-Fi)", sink, events)
        self.addr = (host, port)
        self._sock = None

    def run(self):
        warned = False
        while not self.stop_flag:
            try:
                s = socket.create_connection(self.addr, timeout=5)
                s.settimeout(30)
                self._sock = s
                self._set_connected(True)
                warned = False

                def read():
                    try:
                        d = s.recv(4096)
                    except socket.timeout:
                        return b""
                    return d if d else None
                self._pump(read)
                self._set_connected(False, "connection closed")
            except OSError as e:
                if self.connected:
                    self._set_connected(False, str(e))
                elif not warned:
                    self._events.warning("RF", f"Cannot reach {self.label} - is the laptop on the DUSK1-GROUND "
                                               f"Wi-Fi? Retrying every {RETRY_S} s")
                    warned = True
            finally:
                if self._sock:
                    try:
                        self._sock.close()
                    except OSError:
                        pass
                    self._sock = None
            time.sleep(RETRY_S)

    def write(self, data):
        with self._write_lock:
            if not self._sock:
                return False
            try:
                self._sock.sendall(data)
                return True
            except OSError:
                return False
