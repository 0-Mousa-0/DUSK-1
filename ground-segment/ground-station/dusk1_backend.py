#!/usr/bin/env python3
"""DUSK-1 ground station backend. Same options as before the refactor:

    python dusk1_backend.py --serial COM5
    python dusk1_backend.py --replay sample_data/bench_2026-10-21_raw.log --loop

The code lives in the dusk1_ground package next to this file; this is the launcher."""
from dusk1_ground.cli import main

if __name__ == "__main__":
    main()
