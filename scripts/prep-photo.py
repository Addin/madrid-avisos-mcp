#!/usr/bin/env python3
"""Reduce una foto para que el modelo la procese, conservando el EXIF (GPS).

Uso: prep-photo.py ENTRADA [SALIDA] [--max 2048] [--quality 82]
Imprime un JSON con el informe a stdout. Códigos de salida: 0 ok, 1 uso, 2 fallo.

Solo stdlib. Para redimensionar usa, por orden, lo primero disponible:
  1. sips (macOS, nativo)  2. ImageMagick (magick/convert)  3. Pillow
El GPS se lee y se verifica con un mini-parser EXIF propio (sin dependencias).
Si la imagen ya está dentro de límites se copia tal cual (resized=false).
"""
import json
import os
import shutil
import struct
import subprocess
import sys

DEFAULT_MAX = 2048
DEFAULT_QUALITY = 82


def fail(msg, code=2):
    print(json.dumps({"ok": False, "error": msg}))
    sys.exit(code)


# ---------------------------------------------------------------------------
# Mini-parser EXIF (GPS) con stdlib. Lee JPEG APP1 -> TIFF -> IFD GPS.
# ---------------------------------------------------------------------------
def _read_ifd(data, off, endian, base):
    """Devuelve dict {tag: (type, count, value_offset_or_inline)}."""
    if off + 2 > len(data):
        return {}
    (n,) = struct.unpack(endian + "H", data[off : off + 2])
    entries = {}
    for i in range(n):
        p = off + 2 + i * 12
        if p + 12 > len(data):
            break
        tag, typ, cnt = struct.unpack(endian + "HHI", data[p : p + 8])
        entries[tag] = (typ, cnt, p + 8)
    return entries


def _get_value(data, entry, endian, tiff_start):
    typ, cnt, p = entry
    sizes = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8}
    if typ not in sizes:
        return None
    total = sizes[typ] * cnt
    raw = data[p : p + total] if total <= 4 else None
    if raw is None:
        (ptr,) = struct.unpack(endian + "I", data[p : p + 4])
        raw = data[tiff_start + ptr : tiff_start + ptr + total]
    if len(raw) < total:
        return None
    if typ == 2:  # ascii
        return raw.split(b"\x00")[0].decode("ascii", "replace")
    if typ == 5:  # rational
        vals = []
        for i in range(cnt):
            num, den = struct.unpack(endian + "II", raw[i * 8 : i * 8 + 8])
            vals.append(num / den if den else 0.0)
        return vals
    return None


def exif_gps(path):
    """(lat, lng) dict o None. Nunca lanza."""
    try:
        with open(path, "rb") as f:
            data = f.read(1 << 20)  # el EXIF vive al principio
        if data[0:2] != b"\xff\xd8":
            return None
        pos = 2
        tiff = None
        while pos + 4 < len(data):
            if data[pos] != 0xFF:
                break
            marker = data[pos + 1]
            if marker in (0xD8, 0xD9):
                pos += 2
                continue
            (seg_len,) = struct.unpack(">H", data[pos + 2 : pos + 4])
            if marker == 0xE1 and data[pos + 4 : pos + 10] == b"Exif\x00\x00":
                tiff = pos + 10
                break
            pos += 2 + seg_len
        if tiff is None:
            return None
        endian = "<" if data[tiff : tiff + 2] == b"II" else ">"
        (ifd0_off,) = struct.unpack(endian + "I", data[tiff + 4 : tiff + 8])
        ifd0 = _read_ifd(data, tiff + ifd0_off, endian, tiff)
        if 0x8825 not in ifd0:
            return None
        (gps_ptr,) = struct.unpack(endian + "I", data[ifd0[0x8825][2] : ifd0[0x8825][2] + 4])
        gps = _read_ifd(data, tiff + gps_ptr, endian, tiff)

        def dec(val, ref, neg):
            if isinstance(val, (int, float)):
                return float(val)
            d = float(val[0]) + float(val[1]) / 60.0 + float(val[2]) / 3600.0
            return -d if str(ref).upper() == neg else d

        lat = dec(_get_value(data, gps[0x02], endian, tiff), _get_value(data, gps[0x01], endian, tiff), "S")
        lng = dec(_get_value(data, gps[0x04], endian, tiff), _get_value(data, gps[0x03], endian, tiff), "W")
        if abs(lat) <= 90 and abs(lng) <= 180:
            return {"lat": lat, "lng": lng}
    except Exception:
        pass
    return None


def jpeg_size(path):
    """Dimensiones (w, h) leyendo cabeceras SOF. None si no es JPEG legible."""
    try:
        with open(path, "rb") as f:
            data = f.read(1 << 20)
        if data[0:2] != b"\xff\xd8":
            return None
        pos = 2
        while pos + 4 < len(data):
            if data[pos] != 0xFF:
                break
            marker = data[pos + 1]
            if marker in (0xD8, 0xD9) or (0xD0 <= marker <= 0xD7) or marker == 0x01:
                pos += 2
                continue
            (seg_len,) = struct.unpack(">H", data[pos + 2 : pos + 4])
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                h, w = struct.unpack(">HH", data[pos + 5 : pos + 9])
                return (w, h)
            pos += 2 + seg_len
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Backends de resize (solo se usa el primero disponible).
# ---------------------------------------------------------------------------
def run(cmd):
    r = subprocess.run(cmd, capture_output=True, timeout=300)
    if r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout or b"error")[:200].decode("utf8", "replace"))
    return r


def resize_sips(src, dst, max_side, quality):
    run(["sips", "-Z", str(max_side), "-s", "formatOptions", str(quality), "-o", dst, src])
    return "sips"


def resize_magick(src, dst, max_side, quality):
    exe = shutil.which("magick") or shutil.which("convert")
    if not exe:
        raise RuntimeError("no magick")
    run([exe, src, "-resize", f"{max_side}x{max_side}>", "-quality", str(quality), dst])
    return "magick"


def resize_pillow(src, dst, max_side, quality):
    from PIL import Image

    img = Image.open(src)
    img.load()
    exif_bytes = img.info.get("exif")
    img.thumbnail((max_side, max_side))
    kw = {"quality": quality}
    if exif_bytes:
        kw["exif"] = exif_bytes
    img.save(dst, "JPEG", **kw)
    return "pillow"


def dims_of(path):
    """Dimensiones sin dependencias: JPEG por cabecera, resto vía Pillow si está."""
    js = jpeg_size(path)
    if js:
        return js
    try:
        from PIL import Image

        with Image.open(path) as im:
            return im.size
    except Exception:
        return (0, 0)


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    opts = {}
    for i, a in enumerate(argv):
        if a.startswith("--") and "=" in a:
            k, v = a[2:].split("=", 1)
            opts[k] = v
        elif a.startswith("--") and i + 1 < len(argv) and not argv[i + 1].startswith("--"):
            opts[a[2:]] = argv[i + 1]
    if not args or "--help" in argv or "-h" in argv:
        print(__doc__)
        sys.exit(0 if args else 1)
    if len(args) > 2:
        fail("demasiados argumentos posicionales")

    src = args[0]
    if not os.path.isfile(src):
        fail(f"no existe: {src}")
    try:
        max_side = int(opts.get("max", DEFAULT_MAX))
        quality = int(opts.get("quality", DEFAULT_QUALITY))
    except ValueError:
        fail("--max y --quality deben ser enteros")

    base, ext = os.path.splitext(src)
    dst = args[1] if len(args) == 2 else f"{base}-hermes{ext or '.jpg'}"
    w, h = dims_of(src)
    if not w or not h:
        fail("no se pudieron leer las dimensiones (¿JPEG válido?)")
    size_in = os.path.getsize(src)
    gps = exif_gps(src)

    backend = None
    try:
        if max(w, h) > max_side:
            if shutil.which("sips"):
                backend = resize_sips(src, dst, max_side, quality)
            elif shutil.which("magick") or shutil.which("convert"):
                backend = resize_magick(src, dst, max_side, quality)
            else:
                backend = resize_pillow(src, dst, max_side, quality)
        else:
            shutil.copyfile(src, dst)
            backend = "copy"
        ow, oh = dims_of(dst)
        gps_out = exif_gps(dst)
    except ImportError:
        fail("sin backend disponible: instala Pillow (pip install pillow) o ImageMagick")
    except Exception as e:
        fail(f"falló el procesado ({e})")

    print(
        json.dumps(
            {
                "ok": True,
                "input": src,
                "output": dst,
                "backend": backend,
                "orig": {"width": w, "height": h, "bytes": size_in},
                "out": {"width": ow, "height": oh, "bytes": os.path.getsize(dst)},
                "resized": max(w, h) > max_side,
                "gps": gps,
                "gps_preserved": (gps is None and gps_out is None) or gps == gps_out,
            }
        )
    )


if __name__ == "__main__":
    main(sys.argv[1:])
