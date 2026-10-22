#!/usr/bin/env python3
"""Read or set a SiK telemetry radio's settings over its micro-USB port (AT commands).

    python sik_radio_config.py COM7                  read the version, every setting and the link report
    python sik_radio_config.py COM7 --netid 123      set the network ID, save it, reboot the radio
    python sik_radio_config.py COM7 --set S4=20      set any register (here: TX power 20 dBm = 100 mW)

Both DUSK-1 radios must have the SAME settings (NETID, AIR_SPEED, MIN/MAX_FREQ,
NUM_CHANNELS, ECC, MAVLINK ...). The factory NETID 25 is shared by every other team's
radio, so we use a private one. Windows needs the FTDI driver for the radio's USB chip
(FT230X): Device Manager -> FT230X Basic UART -> Update driver -> Search automatically.
Needs pyserial:  pip install pyserial
"""
import argparse
import sys
import time

import serial


def read_all(s, wait: float) -> str:
    end, out = time.time() + wait, b""
    while time.time() < end:
        chunk = s.read(4096)
        if chunk:
            out += chunk
            end = max(end, time.time() + 0.3)
    return out.decode("ascii", "replace")


def command(s, text: str, wait: float = 0.8) -> str:
    """Sends one AT command; returns the reply without the echo."""
    s.reset_input_buffer()
    s.write((text + "\r").encode())
    reply = read_all(s, wait).replace("\r", "").strip()
    return reply[len(text):].strip() if reply.startswith(text) else reply


def enter_command_mode(s) -> bool:
    """'+++' with one second of silence before and after puts the radio in AT mode."""
    for _ in range(3):
        s.reset_input_buffer()
        time.sleep(1.2)
        s.write(b"+++")
        if "OK" in read_all(s, 1.6):
            return True
        if "OK" in command(s, "AT"):            # already in AT mode
            return True
    return False


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("port", help="the radio's COM port, e.g. COM7")
    ap.add_argument("--netid", type=int, help="new network ID (0-499), the same on both radios")
    ap.add_argument("--set", action="append", default=[], metavar="Sn=value", help="set a register, e.g. S4=20")
    ap.add_argument("--baud", type=int, default=57600, help="the radio's serial speed (factory 57600)")
    a = ap.parse_args()

    changes = list(a.set) + ([f"S3={a.netid}"] if a.netid is not None else [])
    with serial.Serial(a.port, a.baud, timeout=0.2) as s:
        time.sleep(0.5)
        if not enter_command_mode(s):
            sys.exit(f"No answer from {a.port} at {a.baud} baud. Is it a SiK radio? A solid red LED means "
                     "bootloader mode: power it off and on with nothing touching its CTS pin.")
        print("Firmware  :", command(s, "ATI"))
        print("Board     :", command(s, "ATI2"), "| band", command(s, "ATI3"))
        print(command(s, "ATI5", 1.5))
        print("Link      :", command(s, "ATI7", 1.5) or "(no report)")
        if not changes:
            command(s, "ATO")                    # back to data mode, nothing changed
            print("\nNothing changed.")
            return
        for change in changes:
            print(f"AT{change:<10}->", command(s, "AT" + change))
        print("Save      ->", command(s, "AT&W"))
        print("\nNow:")
        print(command(s, "ATI5", 1.5))
        s.write(b"ATZ\r")                        # reboot with the new settings
        print("\nSaved. The radio is rebooting with the new settings.")


if __name__ == "__main__":
    main()
