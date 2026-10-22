import time

from ..config import RETRY_S
from .base import LineSource


class SerialSource(LineSource):
    """A USB serial port: the UNO R4 WiFi (115200) or the ground radio itself (57600).
    Needs pyserial:  pip install pyserial"""

    def __init__(self, port: str, baud: int, sink, events):
        super().__init__(f"{port} at {baud} baud (USB)", sink, events)
        self.port, self.baud = port, baud
        self._ser = None

    def run(self):
        try:
            import serial
        except ImportError:
            self._events.error("SYSTEM", "USB mode needs pyserial: run  pip install pyserial")
            return
        warned = False
        while not self.stop_flag:
            try:
                self._ser = serial.Serial(self.port, self.baud, timeout=0.5)
                self._set_connected(True)
                warned = False

                def read():
                    try:
                        return self._ser.read(self._ser.in_waiting or 1)
                    except serial.SerialException:
                        return None
                self._pump(read)
                self._set_connected(False, "USB unplugged?")
            except serial.SerialException as e:
                if self.connected:
                    self._set_connected(False, str(e))
                elif not warned:
                    self._events.warning("RF", f"Cannot open {self.port}: {e}. Close the Arduino Serial Monitor "
                                               f"on that port. Retrying every {RETRY_S} s")
                    warned = True
            finally:
                if self._ser:
                    try:
                        self._ser.close()
                    except Exception:
                        pass
                    self._ser = None
            time.sleep(RETRY_S)

    def write(self, data):
        with self._write_lock:
            if not self._ser:
                return False
            try:
                self._ser.write(data)
                return True
            except Exception:
                return False
