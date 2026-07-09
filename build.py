"""
build.py - Build the Chrome extension into a zip for distribution.

Usage: python build.py
Output: dy-reply-extension.zip
"""

import os
import sys
import zipfile
from pathlib import Path

EXT_DIR = Path(__file__).resolve().parent
OUTPUT_ZIP = EXT_DIR / "dy-reply-extension.zip"

FILES_TO_INCLUDE = [
    "manifest.json",
    "content.js",
    "popup.html",
    "popup.js",
    "icons",  # directory
]


def main():
    print(f"Building {OUTPUT_ZIP.name} ...")

    if OUTPUT_ZIP.exists():
        OUTPUT_ZIP.unlink()

    included = []
    missing = []
    for f in FILES_TO_INCLUDE:
        p = EXT_DIR / f
        if p.exists():
            included.append(f)
        else:
            missing.append(f)

    if missing:
        print(f"  WARNING: missing files/dirs: {missing}")

    with zipfile.ZipFile(OUTPUT_ZIP, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in included:
            p = EXT_DIR / f
            if p.is_dir():
                # Add all files under directory
                for sub in p.rglob("*"):
                    if sub.is_file():
                        arcname = sub.relative_to(EXT_DIR).as_posix()
                        zf.write(sub, arcname)
                        print(f"  + {arcname}")
            else:
                zf.write(p, f)
                print(f"  + {f}")

    size = OUTPUT_ZIP.stat().st_size
    print(f"\nBuilt {OUTPUT_ZIP.name} ({size:,} bytes)")
    print(f"Distribution path: {OUTPUT_ZIP}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"FAIL: {e}", file=sys.stderr)
        sys.exit(1)