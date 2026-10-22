"""Publish / subscribe between the backend and everything that listens to it.

Two kinds of subscribers (Observer pattern):
  * dashboards: each gets its own queue of JSON strings (one per open browser tab)
  * listeners:  in-process callables that get the message dict (the replay exporter)
"""
import json
import queue
import threading
from typing import Callable, List, Protocol

from .config import SUBSCRIBER_QUEUE


class Publisher(Protocol):
    def publish(self, msg: dict) -> None: ...


class MessageBus:
    def __init__(self, queue_size: int = SUBSCRIBER_QUEUE):
        self._lock = threading.Lock()
        self._queues: List[queue.Queue] = []
        self._listeners: List[Callable[[dict], None]] = []
        self._queue_size = queue_size

    def subscribe(self) -> queue.Queue:
        q = queue.Queue(maxsize=self._queue_size)
        with self._lock:
            self._queues.append(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            if q in self._queues:
                self._queues.remove(q)

    def add_listener(self, listener: Callable[[dict], None]) -> None:
        with self._lock:
            self._listeners.append(listener)

    @property
    def subscriber_count(self) -> int:
        with self._lock:
            return len(self._queues)

    def publish(self, msg: dict) -> None:
        data = json.dumps(msg, ensure_ascii=False)
        with self._lock:
            queues, listeners = list(self._queues), list(self._listeners)
        for q in queues:
            try:
                q.put_nowait(data)
            except queue.Full:                  # a frozen browser tab must not stop the backend
                pass
        for listener in listeners:
            listener(msg)


class MessageLog:
    """The last messages, numbered, for viewers that poll instead of streaming.
    (Cloudflare quick tunnels buffer Server-Sent Events, so public viewers poll /api/poll.)"""

    def __init__(self, size: int = 3000):
        self._lock = threading.Lock()
        self._size = size
        self._items = []                    # [(seq, msg)]
        self.seq = 0

    def append(self, msg: dict) -> None:
        with self._lock:
            self.seq += 1
            self._items.append((self.seq, msg))
            del self._items[:-self._size]

    def since(self, after: int):
        """(messages after `after`, newest seq) or (None, newest seq) when `after` is too old."""
        with self._lock:
            oldest = self._items[0][0] if self._items else self.seq + 1
            if after < oldest - 1 or after > self.seq:
                return None, self.seq
            return [m for s, m in self._items if s > after], self.seq
