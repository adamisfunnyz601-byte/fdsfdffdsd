#!/usr/bin/env python3
"""Generate original, bundled NEXUS visual and audio assets for the native app."""
from pathlib import Path
import math, random, wave, struct
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

ROOT = Path(__file__).resolve().parents[1] / "Resources"
ROOT.mkdir(parents=True, exist_ok=True)
W = H = 4096
rng = np.random.default_rng(2606)

themes = [
    ("NexusWallpaperViolet", (13, 10, 30), (86, 42, 150), (188, 105, 255)),
    ("NexusWallpaperMidnight", (5, 12, 28), (18, 55, 92), (74, 175, 210)),
    ("NexusWallpaperAmethyst", (20, 7, 26), (100, 30, 105), (235, 105, 190)),
    ("NexusWallpaperAurora", (4, 18, 25), (20, 95, 100), (100, 220, 190)),
    ("NexusWallpaperEmber", (24, 9, 12), (105, 35, 62), (240, 130, 90)),
]
for name, c0, c1, c2 in themes:
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    nx, ny = x / W, y / H
    glow1 = np.exp(-(((nx-.72)/.48)**2 + ((ny-.28)/.55)**2)*2.0)
    glow2 = np.exp(-(((nx-.16)/.42)**2 + ((ny-.88)/.42)**2)*2.4)
    base = np.zeros((H,W,3), dtype=np.float32)
    for ch in range(3):
        base[:,:,ch] = c0[ch] + (c1[ch]-c0[ch])*(.22 + .55*ny) + (c2[ch]-c0[ch])*(.42*glow1 + .20*glow2)
    # Fine photographic grain, etched circuit traces, and soft luminous nodes.
    noise = rng.normal(0, 8.0, (H,W,1)).astype(np.float32)
    base += noise
    img = Image.fromarray(np.uint8(np.clip(base,0,255)), "RGB")
    draw = ImageDraw.Draw(img, "RGBA")
    for i in range(34):
        yy = int((i/34)*H + rng.integers(-30,30))
        xx = int(rng.integers(-500, W))
        length = int(rng.integers(250, 1500))
        col = (*c2, int(rng.integers(12,34)))
        draw.line((xx,yy,xx+length,yy), fill=col, width=int(rng.integers(1,4)))
        draw.line((xx+length,yy,xx+length,yy+int(rng.integers(30,180))), fill=col, width=2)
    for i in range(95):
        px, py = int(rng.integers(0,W)), int(rng.integers(0,H))
        r = int(rng.integers(2,9))
        draw.ellipse((px-r,py-r,px+r,py+r), fill=(*c2,int(rng.integers(18,75))))
    # Dark vignette keeps interface text legible over the wallpaper.
    yy, xx = np.mgrid[0:H,0:W].astype(np.float32)
    vignette = np.clip(1 - .30*((xx-W/2)**2+(yy-H/2)**2)/(W*W*.55), .58, 1.0)
    arr = np.asarray(img).astype(np.float32) * vignette[:,:,None]
    img = Image.fromarray(np.uint8(np.clip(arr,0,255)), "RGB")
    img.save(ROOT / f"{name}.jpg", "JPEG", quality=96, optimize=True, progressive=True, subsampling=0)

# Original, short synthesized soundboard cues. No third-party recordings.
sample_rate = 44100
sounds = [
    ("NeuralPing", [880, 1320], .48, "sine"),
    ("GlitchPulse", [110, 740, 180], .62, "square"),
    ("DataExtract", [440, 660, 880, 1100], .72, "sine"),
    ("SystemAlarm", [660, 880], .9, "triangle"),
    ("StaticBurst", [0], .42, "noise"),
    ("VoidBeep", [220], .7, "sine"),
    ("ProtocolInit", [330, 495, 660, 990], .95, "sine"),
    ("Terminate", [990, 660, 330], .8, "triangle"),
]
for name, freqs, duration, kind in sounds:
    count = int(sample_rate * duration)
    rng2 = random.Random(name)
    frames = bytearray()
    for i in range(count):
        t = i / sample_rate
        fade = min(1, t/.025, (duration-t)/.12)
        if kind == "noise":
            v = rng2.uniform(-1,1)
        else:
            freq = freqs[min(len(freqs)-1, int(t/duration*len(freqs)))]
            phase = 2*math.pi*freq*t
            v = math.sin(phase)
            if kind == "square": v = 1 if v >= 0 else -1
            if kind == "triangle": v = 2/math.pi*math.asin(v)
        value = int(max(-1,min(1,v*fade*.34))*32767)
        frames.extend(struct.pack("<h", value))
    with wave.open(str(ROOT / f"{name}.wav"), "wb") as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(sample_rate); out.writeframes(frames)

# Xcode asset catalog for selectable bundled wallpapers.
assets = ROOT / "Assets.xcassets"
assets.mkdir(exist_ok=True)
for name, *_ in themes:
    folder = assets / f"{name}.imageset"
    folder.mkdir(exist_ok=True)
    (folder / "Contents.json").write_text(
        '{"images":[{"filename":"' + name + '.jpg","idiom":"universal"}],"info":{"author":"xcode","version":1}}',
        encoding="utf-8"
    )
    (folder / f"{name}.jpg").write_bytes((ROOT / f"{name}.jpg").read_bytes())
    (ROOT / f"{name}.jpg").unlink()
print("Generated 5 original 4K wallpapers and 8 original soundboard cues.")
