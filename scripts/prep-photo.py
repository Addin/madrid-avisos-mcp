#!/usr/bin/env python3
"""Reduce una foto para que el modelo la procese, conservando el EXIF (GPS).

Uso: prep-photo.py ENTRADA [SALIDA] [--max 2048] [--quality 82]
Imprime un JSON con el informe a stdout. Códigos de salida: 0 ok, 1 uso, 2 fallo.

- Si la imagen ya está dentro de límites se copia tal cual (resized=false).
- El GPS se conserva pasando los bytes EXIF originales al guardar (solo JPEG).
- Requiere Pillow: pip install pillow
"""
import json
import shutil
import sys

DEFAULT_MAX = 2048
DEFAULT_QUALITY = 82


def fail(msg, code=2):
    print(json.dumps({"ok": False, "error": msg}))
    sys.exit(code)


def exif_gps(img):
    """Extrae (lat, lng) del EXIF o devuelve None. Sin dependencias extra."""
    try:
        exif = img.getexif()
    except Exception:
        return None
    if 34853 not in exif:
        return None
    try:
        from PIL.ExifTags import GPSTAGS

        gps = exif.get_ifd(34853)
        raw = {GPSTAGS.get(k, k): v for k, v in gps.items()}

        def dec(val, ref, neg):
            if isinstance(val, (int, float)):
                return float(val)
            vals = list(val)
            d = float(vals[0]) + float(vals[1]) / 60.0 + float(vals[2]) / 3600.0
            if str(ref).upper() == neg:
                d = -d
            return d

        lat = dec(raw["GPSLatitude"], raw.get("GPSLatitudeRef", "N"), "S")
        lng = dec(raw["GPSLongitude"], raw.get("GPSLongitudeRef", "E"), "W")
        if abs(lat) <= 90 and abs(lng) <= 180:
            return {"lat": lat, "lng": lng}
    except Exception:
        pass
    return None


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
    try:
        max_side = int(opts.get("max", DEFAULT_MAX))
        quality = int(opts.get("quality", DEFAULT_QUALITY))
    except ValueError:
        fail("--max y --quality deben ser enteros")

    try:
        from PIL import Image
    except ImportError:
        fail("falta Pillow: pip install pillow")

    try:
        img = Image.open(src)
        img.load()
    except Exception as e:
        fail(f"no se pudo abrir {src}: {e}")

    import os

    w, h = img.size
    size_in = os.path.getsize(src)
    gps = exif_gps(img)
    dst = args[1] if len(args) == 2 else None
    if dst is None:
        base, ext = os.path.splitext(src)
        dst = f"{base}-hermes{ext or '.jpg'}"

    needs_resize = max(w, h) > max_side
    try:
        if needs_resize:
            exif_bytes = img.info.get("exif")
            img.thumbnail((max_side, max_side))
            save_kw = {"quality": quality}
            if exif_bytes:
                save_kw["exif"] = exif_bytes
            img.save(dst, "JPEG", **save_kw)
        else:
            shutil.copyfile(src, dst)
        out_img = Image.open(dst)
        out_img.load()
        ow, oh = out_img.size
        gps_out = exif_gps(out_img)
    except Exception as e:
        fail(f"falló el procesado: {e}")

    print(
        json.dumps(
            {
                "ok": True,
                "input": src,
                "output": dst,
                "orig": {"width": w, "height": h, "bytes": size_in},
                "out": {"width": ow, "height": oh, "bytes": os.path.getsize(dst)},
                "resized": needs_resize,
                "gps": gps,
                "gps_preserved": (gps is None and gps_out is None) or gps == gps_out,
            }
        )
    )


if __name__ == "__main__":
    main(sys.argv[1:])
