"""Synthesise the 47s soundtrack (starts when the skit ends) with sound effects
locked to the animation's timing.json. Pure stdlib, no numpy.
Usage: python3 -I scripts/music.py src/timing.json public/music.wav
"""
import json, math, random, sys, wave, array

T = json.load(open(sys.argv[1]))
OUT = sys.argv[2]
SR = 44100
FPS = T["fps"]
T0 = T["scenes"]["reveal"][0] / FPS  # music starts here
DUR = (T["total"] - T["scenes"]["reveal"][0]) / FPS + 0.5
N = int(DUR * SR)
buf = array.array("d", [0.0]) * N
rnd = random.Random(7)


def at(abs_frame):  # absolute frame → seconds relative to music start
    return abs_frame / FPS - T0


def scene(name, f=0):
    return at(T["scenes"][name][0] + f)


def add(t, samples, gain=1.0):
    i0 = int(t * SR)
    for k, s in enumerate(samples):
        i = i0 + k
        if 0 <= i < N:
            buf[i] += s * gain


def env(n, a=0.002, d=0.2):
    na = max(1, int(a * SR))
    return [min(1.0, k / na) * math.exp(-k / (d * SR)) for k in range(n)]


def kick(big=False):
    n = int((0.55 if big else 0.32) * SR)
    ph, out = 0.0, []
    for k in range(n):
        t = k / SR
        f = 45 + (160 if big else 120) * math.exp(-t * 28)
        ph += 2 * math.pi * f / SR
        out.append(math.sin(ph) * math.exp(-t * (5 if big else 9)))
    return out


def noise(n, decay, hp=True):
    out, prev = [], 0.0
    for k in range(n):
        x = rnd.uniform(-1, 1)
        y = x - prev if hp else x
        prev = x
        out.append(y * math.exp(-k / (decay * SR)))
    return out


def tone(freq, length, kind="saw", decay=0.25, a=0.004):
    n = int(length * SR)
    e = env(n, a, decay)
    out = []
    for k in range(n):
        p = (freq * k / SR) % 1.0
        if kind == "saw":
            v = 2 * p - 1
        elif kind == "sq":
            v = 1 if p < 0.5 else -1
        else:
            v = math.sin(2 * math.pi * p)
        out.append(v * e[k])
    return out


def lowpass(x, a=0.15):
    y, s = [], 0.0
    for v in x:
        s += a * (v - s)
        y.append(s)
    return y


def boom(t, g=1.0):
    add(t, kick(True), 0.9 * g)
    add(t, noise(int(1.2 * SR), 0.35), 0.35 * g)
    add(t, tone(55, 1.2, "sin", 0.5), 0.5 * g)


def whoosh(t, length=0.45):
    n = int(length * SR)
    raw = [rnd.uniform(-1, 1) for _ in range(n)]
    out, s = [], 0.0
    for k, v in enumerate(raw):
        a = 0.02 + 0.5 * math.sin(math.pi * k / n) ** 2
        s += a * (v - s)
        out.append(s * math.sin(math.pi * k / n))
    add(t - length * 0.5, out, 0.55)


def click(t):
    add(t, tone(2200, 0.03, "sin", 0.008), 0.35)
    add(t, noise(int(0.02 * SR), 0.004), 0.25)


def punch(t, big=False):
    add(t, kick(big), 0.8)
    add(t, lowpass(noise(int(0.25 * SR), 0.06, hp=False), 0.3), 0.7)
    add(t, noise(int(0.12 * SR), 0.03), 0.3)


def blip(t, f, length=0.18):
    add(t, tone(f, length, "sq", 0.08), 0.18)


# ---------------- music ----------------
BPM = 120
B = 60 / BPM
ROOTS = [55.0, 43.65, 65.41, 49.0]  # A1 F1 C2 G1


def groove(t_start, t_end, heavy=False):
    t = t_start
    i = 0
    while t < t_end - 1e-6:
        bar_beat = i % 4
        root = ROOTS[(i // 4) % 4]
        add(t, kick(), 0.85)
        add(t + B / 2, noise(int(0.05 * SR), 0.012), 0.22)  # offbeat hat
        if heavy:
            add(t + B / 4, noise(int(0.03 * SR), 0.008), 0.12)
            add(t + 3 * B / 4, noise(int(0.03 * SR), 0.008), 0.12)
        if bar_beat in (1, 3):
            add(t, noise(int(0.2 * SR), 0.07), 0.38)  # clap/snare
            add(t, tone(190, 0.12, "sin", 0.05), 0.2)
        for e in (0, 1):  # 8th-note octave bass
            f = root * (2 if e else 1)
            add(t + e * B / 2, lowpass(tone(f, B / 2 * 0.95, "saw", 0.18), 0.12 if not heavy else 0.2), 0.55)
        if bar_beat == 0:  # chord stab
            for m in (2, 2 * 1.189, 2 * 1.498):
                add(t + B / 2, lowpass(tone(root * 4 * m / 2, 0.22, "sq", 0.09), 0.25), 0.06)
        t += B
        i += 1


def riser(t, length):
    n = int(length * SR)
    ph, out = 0.0, []
    for k in range(n):
        p = k / n
        ph += 2 * math.pi * (200 + 900 * p * p) / SR
        out.append((math.sin(ph) * 0.4 + rnd.uniform(-1, 1) * 0.3 * p) * p)
    add(t, out, 0.45)


# reveal: riser into logo slam
slam = scene("reveal", 38)
riser(0.0, slam)
boom(slam, 1.1)
groove(2.0, scene("fight"))
# whooshes on wipes
for k in ("submit", "agents", "devices", "judges", "bet"):
    whoosh(scene(k))
click(scene("submit", 32))
blip(scene("submit", 56), 880)
# agents: little blips as lanes finish, then dossier thump
AG = T["agents"]
whoosh(scene("agents", 20), 0.8)
for i in range(6):  # one blip per gate pass, pitched by lane
    for g, gz in enumerate(AG["gates"]):
        t = (gz - AG["zStart"]) / (AG["zEnd"] - AG["zStart"])
        f = AG["raceStart"] + (AG["finish"][i] - AG["raceStart"]) * math.sqrt(t)
        blip(scene("agents", f), 523 * (1.12 ** (i + g * 2)), 0.08)
riser(scene("agents", AG["raceStart"]), (max(AG["finish"]) - AG["raceStart"]) / FPS)
whoosh(scene("agents", 114), 0.5)
punch(scene("agents", AG["dossier"]), big=True)
# devices: taps + bug buzz
for f in (50, 58, 64, 70, 92, 95, 98, 100, 120, 130, 136, 140):
    click(scene("devices", f))
add(scene("devices", 100), lowpass(tone(110, 0.35, "sq", 0.2), 0.3), 0.3)
# judges
click(scene("judges", 58))
click(scene("judges", 124))
add(scene("judges", 128), [v * 0.5 for v in tone(440, 0.6, "sin", 0.3)], 0.3)
riser(scene("judges", 128), 0.5)

# fight
F = T["fight"]
whoosh(scene("fight", F["vs"] + 2), 0.9)
boom(scene("fight", F["vs"]), 1.0)
whoosh(scene("fight", 136), 0.5)
riser(scene("fight", F["superCharge"]), (F["hits"][-1]["at"] - F["superCharge"]) / FPS)
for c in F["countdown"]:
    blip(scene("fight", c), 523, 0.22)
boom(scene("fight", F["go"]), 1.2)
blip(scene("fight", F["go"]), 1046, 0.35)
groove(scene("fight", F["go"]) + B / 2, scene("fight", F["ko"]), heavy=True)
for h in F["hits"]:
    punch(scene("fight", h["at"]), big=h is F["hits"][-1])
boom(scene("fight", F["ko"]), 1.3)
add(scene("fight", F["ko"]), noise(int(2.0 * SR), 0.8), 0.15)
add(scene("fight", F["ko"]), lowpass(noise(int(2.6 * SR), 1.2, hp=False), 0.08), 0.5)  # crowd roar
for i in range(8):
    add(scene("fight", F["ko"] + 6 + i * 4), noise(int(0.04 * SR), 0.01), 0.2)  # camera flashes

# bet
groove(scene("bet"), scene("close"))
click(scene("bet", 24))
click(scene("bet", 46))
for i, f in enumerate((1318, 1568, 2093)):
    blip(scene("bet", 92 + i * 4), f, 0.25)
for i in range(10):
    blip(scene("bet", 98 + i * 2), 2600, 0.05)

# close
groove(scene("close"), scene("close", 60))
for i in range(3):
    punch(scene("close", 30 + i * 8))
boom(scene("close", 62), 1.3)
add(scene("close", 62), tone(110, 2.5, "saw", 1.0), 0.12)
add(scene("close", 62), tone(165, 2.5, "saw", 1.0), 0.08)

# ---------------- master ----------------
peak = max(abs(v) for v in buf) or 1.0
g = 1.6 / peak
out = array.array("h", [0]) * (N * 2)
for i, v in enumerate(buf):
    fade = min(1.0, (N - i) / (0.4 * SR))
    s = int(math.tanh(v * g) * 0.89 * 32767 * fade)
    out[2 * i] = s
    out[2 * i + 1] = s
with wave.open(OUT, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(out.tobytes())
print("wrote", OUT, round(DUR, 2), "s")
