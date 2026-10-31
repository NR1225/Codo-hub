"""seed_test_codes.py-ға арналған 50 шағын тест жобасы — әр категориядан бірнешеуі.

Әр жазба: (атауы, категория, сипаттама, {файл жолы: мазмұны}). Категориялар —
frontend/src/utils/codeCategories.ts ішіндегі мәндер. Бәрі шынымен жұмыс істейтін, қысқа кодтар.
"""

SNIPPETS = [
    # ---------- AI ----------
    ("Сызықтық регрессия", "machine-learning", "Ең кіші квадраттар әдісі — numpy-сыз, таза Python", {
        "regression.py": '''def fit(xs, ys):
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    k = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    return k, my - k * mx


if __name__ == "__main__":
    area = [30, 45, 60, 75, 90]
    price = [12, 17, 23, 28, 34]
    k, b = fit(area, price)
    print(f"баға = {k:.2f} * аудан + {b:.2f}")
    print("100 м² пәтер бағасы:", round(k * 100 + b, 1))
''',
    }),
    ("K-means кластерлеу", "machine-learning", "Нүктелерді k топқа бөлу, кездейсоқ бастау нүктелерімен", {
        "kmeans.py": '''import random


def dist(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b))


def kmeans(points, k, steps=20):
    # Бастапқы орталықтар бір-бірінен алыс таңдалады (k-means++ сияқты)
    centers = [random.choice(points)]
    while len(centers) < k:
        centers.append(max(points, key=lambda p: min(dist(p, c) for c in centers)))
    for _ in range(steps):
        groups = [[] for _ in range(k)]
        for p in points:
            groups[min(range(k), key=lambda i: dist(p, centers[i]))].append(p)
        centers = [tuple(sum(c) / len(g) for c in zip(*g)) if g else centers[i] for i, g in enumerate(groups)]
    return centers, groups


if __name__ == "__main__":
    random.seed(1)
    pts = [(random.gauss(cx, 1), random.gauss(cy, 1)) for cx, cy in [(0, 0), (8, 8), (0, 8)] for _ in range(30)]
    centers, groups = kmeans(pts, 3)
    for c, g in zip(centers, groups):
        print(f"орталық ({c[0]:.1f}, {c[1]:.1f}) — {len(g)} нүкте")
''',
    }),
    ("Сөз жиілігі", "natural-language-processing", "Мәтіндегі ең жиі сөздер, тоқтау сөздерінсіз", {
        "word_freq.py": '''import re
from collections import Counter

STOP = {"және", "мен", "бен", "пен", "да", "де", "бұл", "ол", "бір", "үшін"}

text = """Код жазу — бұл ойлау. Жақсы код оқуға жеңіл, ал оқуға жеңіл код
өзгертуге де жеңіл. Код бір рет жазылады, бірақ көп рет оқылады."""

words = [w for w in re.findall(r"\\w+", text.lower()) if w not in STOP]
for word, n in Counter(words).most_common(5):
    print(f"{word:<10} {'█' * n} {n}")
''',
    }),
    ("Көңіл-күй анализаторы", "natural-language-processing", "Сөздік бойынша пікірдің жағымды/жағымсыз екенін анықтау", {
        "sentiment.js": '''const POSITIVE = ['керемет', 'жақсы', 'ұнады', 'тамаша', 'рақмет', 'great', 'love'];
const NEGATIVE = ['нашар', 'ұнамады', 'қате', 'баяу', 'жаман', 'bad', 'hate'];

function sentiment(text) {
  const words = text.toLowerCase().split(/[^\\p{L}]+/u);
  const score = words.reduce((s, w) => s + POSITIVE.includes(w) - NEGATIVE.includes(w), 0);
  return score > 0 ? '😊 жағымды' : score < 0 ? '😞 жағымсыз' : '😐 бейтарап';
}

['Керемет қосымша, ұнады!', 'Өте баяу және қате көп', 'Бүгін сейсенбі'].forEach((t) =>
  console.log(`${sentiment(t).padEnd(12)} ← ${t}`)
);
''',
    }),
    ("Кескін фильтрлері", "computer-vision", "Canvas-та сұр түс, негатив, жиек табу (Sobel)", {
        "index.html": '''<!DOCTYPE html>
<html lang="kk">
<head><meta charset="UTF-8"><title>Кескін фильтрлері</title>
<style>body{font-family:sans-serif;text-align:center;background:#111;color:#eee}canvas{border-radius:8px;margin:12px}button{margin:4px;padding:8px 14px}</style>
</head>
<body>
<h2>Кескін фильтрлері</h2>
<canvas id="c" width="320" height="220"></canvas><br>
<button onclick="draw()">Түпнұсқа</button>
<button onclick="apply(gray)">Сұр</button>
<button onclick="apply(invert)">Негатив</button>
<button onclick="edges()">Жиектер</button>
<script>
const c = document.getElementById('c'), ctx = c.getContext('2d');
function draw() {
  const g = ctx.createLinearGradient(0, 0, 320, 220);
  g.addColorStop(0, '#ff7a59'); g.addColorStop(1, '#3a7bd5');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 320, 220);
  ctx.fillStyle = '#ffe066'; ctx.beginPath(); ctx.arc(90, 80, 40, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2b9348'; ctx.fillRect(170, 110, 110, 80);
}
const gray = (r, g, b) => { const v = 0.3 * r + 0.59 * g + 0.11 * b; return [v, v, v]; };
const invert = (r, g, b) => [255 - r, 255 - g, 255 - b];
function apply(fn) {
  const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) [d[i], d[i + 1], d[i + 2]] = fn(d[i], d[i + 1], d[i + 2]);
  ctx.putImageData(img, 0, 0);
}
function edges() {
  apply(gray);
  const src = ctx.getImageData(0, 0, c.width, c.height), out = ctx.createImageData(c.width, c.height);
  const px = (x, y) => src.data[(y * c.width + x) * 4];
  for (let y = 1; y < c.height - 1; y++) for (let x = 1; x < c.width - 1; x++) {
    const gx = px(x + 1, y) - px(x - 1, y), gy = px(x, y + 1) - px(x, y - 1);
    const v = Math.min(255, Math.hypot(gx, gy) * 2), i = (y * c.width + x) * 4;
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v; out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
}
draw();
</script>
</body>
</html>
''',
    }),
    ("Чат-бот көмекші", "ai-applications", "Кілт сөздерге жауап беретін қарапайым консоль бот", {
        "bot.py": '''RULES = {
    ("сәлем", "салем", "hello"): "Сәлем! Қалай көмектесе аламын?",
    ("python",): "Python — бастауға ең ыңғайлы тіл. print('Сәлем') деп көріңіз!",
    ("қате", "error"): "Қате мәтінін толық оқыңыз — соңғы жолы ең маңыздысы.",
    ("рақмет", "рахмет"): "Оқасы жоқ! 🙂",
}


def reply(message: str) -> str:
    text = message.lower()
    for keys, answer in RULES.items():
        if any(k in text for k in keys):
            return answer
    return "Түсінбедім. Басқаша сұрап көріңізші."


if __name__ == "__main__":
    print("Бот: шығу үшін 'exit' жазыңыз")
    while (msg := input("Сіз: ")).strip().lower() != "exit":
        print("Бот:", reply(msg))
''',
    }),

    # ---------- Mobile ----------
    ("Қадам санағыш (Swift)", "ios-app", "SwiftUI экраны: күндік мақсат пен прогресс сақинасы", {
        "StepsView.swift": '''import SwiftUI

struct StepsView: View {
    @State private var steps = 6_240
    private let goal = 10_000

    var progress: Double { min(Double(steps) / Double(goal), 1) }

    var body: some View {
        VStack(spacing: 24) {
            ZStack {
                Circle().stroke(Color.gray.opacity(0.2), lineWidth: 18)
                Circle().trim(from: 0, to: progress)
                    .stroke(Color.green, style: StrokeStyle(lineWidth: 18, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.easeOut, value: progress)
                VStack {
                    Text("\\(steps)").font(.largeTitle.bold())
                    Text("/ \\(goal) қадам").foregroundStyle(.secondary)
                }
            }
            .frame(width: 220, height: 220)
            Button("+500 қадам") { steps += 500 }
                .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}
''',
    }),
    ("Тізім экраны (Kotlin)", "android-app", "Jetpack Compose: сатып алынатын заттар тізімі", {
        "ShoppingScreen.kt": '''package hub.codo.shopping

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun ShoppingScreen() {
    var input by remember { mutableStateOf("") }
    val items = remember { mutableStateListOf("Нан", "Сүт") }

    Column(Modifier.padding(16.dp)) {
        Row {
            OutlinedTextField(input, { input = it }, Modifier.weight(1f), label = { Text("Зат") })
            Button(onClick = { if (input.isNotBlank()) items += input.trim(); input = "" },
                   Modifier.padding(start = 8.dp)) { Text("Қосу") }
        }
        LazyColumn {
            items(items) { item ->
                ListItem(headlineContent = { Text(item) },
                         trailingContent = { TextButton({ items.remove(item) }) { Text("✕") } })
            }
        }
    }
}
''',
    }),
    ("Ауа райы карточкасы (Flutter)", "cross-platform-app", "Dart/Flutter виджеті: қала, температура, белгіше", {
        "weather_card.dart": '''import 'package:flutter/material.dart';

void main() => runApp(const MaterialApp(home: Scaffold(body: Center(child: WeatherCard()))));

class WeatherCard extends StatelessWidget {
  const WeatherCard({super.key});

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 6,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: const Padding(
        padding: EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Text('Алматы', style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
          SizedBox(height: 8),
          Icon(Icons.wb_sunny, size: 64, color: Colors.orange),
          Text('+24°C', style: TextStyle(fontSize: 40)),
          Text('Ашық аспан, жел 3 м/с'),
        ]),
      ),
    );
  }
}
''',
    }),
    ("Кіру формасы (React Native)", "cross-platform-app", "Email/құпиясөз тексерісі бар кіру экраны", {
        "LoginScreen.js": '''import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = () => {
    if (!/^\\S+@\\S+\\.\\S+$/.test(email)) return setError('Email дұрыс емес');
    if (password.length < 8) return setError('Құпиясөз кемінде 8 таңба');
    setError('');
    alert(`Қош келдіңіз, ${email}!`);
  };

  return (
    <View style={s.box}>
      <Text style={s.title}>Кіру</Text>
      <TextInput style={s.input} placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" />
      <TextInput style={s.input} placeholder="Құпиясөз" value={password} onChangeText={setPassword} secureTextEntry />
      {!!error && <Text style={s.error}>{error}</Text>}
      <Pressable style={s.btn} onPress={submit}><Text style={s.btnText}>Кіру</Text></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  box: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 16 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, padding: 12, marginBottom: 10 },
  error: { color: '#d33', marginBottom: 8 },
  btn: { backgroundColor: '#4f46e5', padding: 14, borderRadius: 10, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '600' },
});
''',
    }),
    ("Тап-тап (мобильді ойын)", "mobile-game", "Сенсорлы экранға арналған реакция ойыны — 20 секундта неше рет басасыз", {
        "index.html": '''<!DOCTYPE html>
<html lang="kk">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>Тап-тап</title>
<style>
body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif;background:#0f172a;color:#fff;touch-action:manipulation}
#dot{width:70px;height:70px;border-radius:50%;background:#f43f5e;position:absolute;display:none}
#info{font-size:22px}button{padding:14px 28px;font-size:18px;border:0;border-radius:12px;margin-top:16px}
</style></head>
<body>
<div id="info">Ұпай: 0 · Уақыт: 20</div>
<button id="start">Бастау</button>
<div id="dot"></div>
<script>
const dot = document.getElementById('dot'), info = document.getElementById('info'), start = document.getElementById('start');
let score = 0, time = 20, timer;
function move() {
  dot.style.left = Math.random() * (innerWidth - 70) + 'px';
  dot.style.top = 60 + Math.random() * (innerHeight - 130) + 'px';
}
function render() { info.textContent = `Ұпай: ${score} · Уақыт: ${time}`; }
dot.addEventListener('pointerdown', () => { score++; render(); move(); });
start.onclick = () => {
  score = 0; time = 20; render(); start.style.display = 'none'; dot.style.display = 'block'; move();
  timer = setInterval(() => {
    if (--time <= 0) { clearInterval(timer); dot.style.display = 'none'; start.style.display = ''; start.textContent = 'Қайта'; }
    render();
  }, 1000);
};
</script>
</body>
</html>
''',
    }),

    # ---------- Web ----------
    ("Портфолио беті", "web-app", "Бір беттік портфолио: тақырып, жобалар торы, байланыс", {
        "index.html": '''<!DOCTYPE html>
<html lang="kk">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Айгерім — әзірлеуші</title>
<style>
:root{--accent:#6366f1}
body{margin:0;font-family:system-ui,sans-serif;color:#1f2937}
header{padding:80px 24px;text-align:center;background:linear-gradient(135deg,#eef2ff,#fdf2f8)}
h1{font-size:44px;margin:0}header p{color:#6b7280}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;padding:40px 24px;max-width:960px;margin:auto}
.card{border:1px solid #e5e7eb;border-radius:14px;padding:20px;transition:.2s}
.card:hover{transform:translateY(-4px);box-shadow:0 10px 24px #0001}
a.btn{display:inline-block;background:var(--accent);color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none}
footer{text-align:center;padding:32px;color:#9ca3af}
</style></head>
<body>
<header><h1>Сәлем, мен Айгерім 👋</h1><p>Frontend әзірлеуші · React · TypeScript</p><a class="btn" href="#contact">Хабарласу</a></header>
<section class="grid">
  <div class="card"><h3>Ауа райы</h3><p>API-мен жұмыс, анимациялы белгішелер.</p></div>
  <div class="card"><h3>Kanban тақта</h3><p>Drag & drop, localStorage.</p></div>
  <div class="card"><h3>Чат</h3><p>WebSocket, нақты уақыт хабарламалары.</p></div>
</section>
<footer id="contact">aigerim@example.com · © 2026</footer>
</body>
</html>
''',
    }),
    ("Kanban тақта", "web-app", "Тапсырмаларды бағандар арасында сүйреп апару (drag & drop)", {
        "index.html": '''<!DOCTYPE html>
<html lang="kk">
<head><meta charset="UTF-8"><title>Kanban</title>
<style>
body{font-family:sans-serif;background:#f1f5f9;margin:0;padding:24px}
.board{display:flex;gap:16px}
.col{flex:1;background:#e2e8f0;border-radius:12px;padding:12px;min-height:300px}
.col h3{margin:4px 0 12px}
.task{background:#fff;padding:10px;border-radius:8px;margin-bottom:8px;cursor:grab;box-shadow:0 1px 2px #0002}
.col.over{outline:2px dashed #6366f1}
</style></head>
<body>
<div class="board">
  <div class="col" data-col="todo"><h3>Істеу керек</h3></div>
  <div class="col" data-col="doing"><h3>Орындалуда</h3></div>
  <div class="col" data-col="done"><h3>Дайын</h3></div>
</div>
<script>
const tasks = JSON.parse(localStorage.getItem('kanban') || 'null') ||
  [{ id: 1, text: 'Дизайн жасау', col: 'todo' }, { id: 2, text: 'API жазу', col: 'doing' }, { id: 3, text: 'README', col: 'done' }];
function render() {
  document.querySelectorAll('.task').forEach((t) => t.remove());
  tasks.forEach((t) => {
    const el = Object.assign(document.createElement('div'), { className: 'task', textContent: t.text, draggable: true });
    el.ondragstart = (e) => e.dataTransfer.setData('id', t.id);
    document.querySelector(`[data-col="${t.col}"]`).append(el);
  });
  localStorage.setItem('kanban', JSON.stringify(tasks));
}
document.querySelectorAll('.col').forEach((col) => {
  col.ondragover = (e) => { e.preventDefault(); col.classList.add('over'); };
  col.ondragleave = () => col.classList.remove('over');
  col.ondrop = (e) => {
    col.classList.remove('over');
    tasks.find((t) => t.id == e.dataTransfer.getData('id')).col = col.dataset.col;
    render();
  };
});
render();
</script>
</body>
</html>
''',
    }),
    ("Валюта айырбастау", "web-app", "Теңге, доллар, евро, рубль — бекітілген бағаммен есептеу", {
        "index.html": '''<!DOCTYPE html>
<html lang="kk">
<head><meta charset="UTF-8"><title>Валюта</title>
<style>body{font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#ecfeff}
.box{background:#fff;padding:28px;border-radius:16px;box-shadow:0 8px 30px #0001;width:300px}
input,select{width:100%;padding:10px;margin:6px 0;box-sizing:border-box;border-radius:8px;border:1px solid #cbd5e1}
#out{font-size:28px;font-weight:700;margin-top:12px}</style></head>
<body>
<div class="box">
  <h2>Валюта айырбастау</h2>
  <input id="amount" type="number" value="1000">
  <select id="from"></select><select id="to"></select>
  <div id="out"></div>
</div>
<script>
const RATES = { KZT: 1, USD: 480, EUR: 520, RUB: 5.2 }; // 1 бірлік = ? теңге (мысал үшін)
const [amount, from, to, out] = ['amount', 'from', 'to', 'out'].map((id) => document.getElementById(id));
for (const sel of [from, to]) for (const c in RATES) sel.add(new Option(c, c));
to.value = 'USD';
function calc() {
  const v = (amount.value * RATES[from.value]) / RATES[to.value];
  out.textContent = `${v.toLocaleString('kk-KZ', { maximumFractionDigits: 2 })} ${to.value}`;
}
[amount, from, to].forEach((el) => el.addEventListener('input', calc));
calc();
</script>
</body>
</html>
''',
    }),
    ("Markdown редакторы", "web-app", "Сол жақта жазасыз — оң жақта дайын көрініс (өз парсері)", {
        "index.html": '''<!DOCTYPE html>
<html lang="kk">
<head><meta charset="UTF-8"><title>Markdown</title>
<style>body{margin:0;display:flex;height:100vh;font-family:sans-serif}
textarea,#view{flex:1;padding:20px;box-sizing:border-box}
textarea{border:0;border-right:1px solid #ddd;font:15px/1.6 monospace;resize:none;outline:none}
#view{overflow:auto}code{background:#f3f4f6;padding:2px 5px;border-radius:4px}</style></head>
<body>
<textarea id="src"># Сәлем!

Бұл **Markdown** редакторы.

- *курсив* мәтін
- `код` үзіндісі
- [сілтеме](https://example.com)

## Тақырып 2</textarea>
<div id="view"></div>
<script>
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function md(text) {
  return esc(text).split(/\\n{2,}/).map((block) => {
    if (/^#{1,3} /.test(block)) { const n = block.match(/^#+/)[0].length; return `<h${n}>${block.slice(n + 1)}</h${n}>`; }
    if (/^- /m.test(block)) return '<ul>' + block.split('\\n').map((l) => `<li>${l.slice(2)}</li>`).join('') + '</ul>';
    return `<p>${block}</p>`;
  }).join('')
    .replace(/\\*\\*(.+?)\\*\\*/g, '<b>$1</b>').replace(/\\*(.+?)\\*/g, '<i>$1</i>')
    .replace(/`(.+?)`/g, '<code>$1</code>').replace(/\\[(.+?)\\]\\((.+?)\\)/g, '<a href="$2">$1</a>');
}
const src = document.getElementById('src'), view = document.getElementById('view');
const update = () => (view.innerHTML = md(src.value));
src.addEventListener('input', update);
update();
</script>
</body>
</html>
''',
    }),
    ("Pomodoro таймері", "web-app", "25/5 минуттық жұмыс-демалыс циклі, дыбыс сигналымен", {
        "index.html": '''<!DOCTYPE html>
<html lang="kk">
<head><meta charset="UTF-8"><title>Pomodoro</title>
<style>body{font-family:sans-serif;text-align:center;padding-top:80px;transition:background .5s}
body.work{background:#fee2e2}body.rest{background:#dcfce7}
#time{font-size:96px;font-weight:700;font-variant-numeric:tabular-nums}
button{font-size:18px;padding:10px 22px;margin:6px;border-radius:10px;border:0;background:#111;color:#fff}</style></head>
<body class="work">
<h2 id="mode">Жұмыс</h2><div id="time">25:00</div>
<button id="toggle">Бастау</button><button id="reset">Қайта</button>
<script>
const MODES = { work: ['Жұмыс', 25 * 60], rest: ['Демалыс', 5 * 60] };
let mode = 'work', left = MODES.work[1], timer = null;
const $ = (id) => document.getElementById(id);
function beep() {
  const a = new AudioContext(), o = a.createOscillator();
  o.connect(a.destination); o.start(); o.stop(a.currentTime + 0.4);
}
function render() {
  $('time').textContent = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  $('mode').textContent = MODES[mode][0]; document.body.className = mode;
}
function tick() {
  if (--left < 0) { beep(); mode = mode === 'work' ? 'rest' : 'work'; left = MODES[mode][1]; }
  render();
}
$('toggle').onclick = () => {
  if (timer) { clearInterval(timer); timer = null; $('toggle').textContent = 'Жалғастыру'; }
  else { timer = setInterval(tick, 1000); $('toggle').textContent = 'Тоқтату'; }
};
$('reset').onclick = () => { clearInterval(timer); timer = null; mode = 'work'; left = MODES.work[1]; $('toggle').textContent = 'Бастау'; render(); };
render();
</script>
</body>
</html>
''',
    }),
    ("Құпиясөз генераторы", "web-app", "Ұзындығы мен таңба түрлерін таңдап, крипто-кездейсоқ құпиясөз жасау", {
        "index.html": '''<!DOCTYPE html>
<html lang="kk">
<head><meta charset="UTF-8"><title>Құпиясөз генераторы</title>
<style>body{font-family:sans-serif;max-width:420px;margin:60px auto;padding:0 16px}
#pw{font:20px monospace;padding:14px;background:#f1f5f9;border-radius:10px;word-break:break-all;min-height:28px}
label{display:block;margin:8px 0}button{padding:10px 18px;border-radius:8px;border:0;background:#0ea5e9;color:#fff;font-size:16px}</style></head>
<body>
<h2>Құпиясөз генераторы</h2>
<div id="pw"></div>
<label>Ұзындығы: <input id="len" type="range" min="8" max="40" value="16"> <span id="lenv">16</span></label>
<label><input type="checkbox" id="up" checked> Бас әріптер</label>
<label><input type="checkbox" id="num" checked> Сандар</label>
<label><input type="checkbox" id="sym"> Белгілер</label>
<button id="gen">Жасау</button> <button id="copy">Көшіру</button>
<script>
const $ = (id) => document.getElementById(id);
function generate() {
  let chars = 'abcdefghijkmnopqrstuvwxyz';
  if ($('up').checked) chars += 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  if ($('num').checked) chars += '23456789';
  if ($('sym').checked) chars += '!@#$%^&*-_+=?';
  const rnd = crypto.getRandomValues(new Uint32Array(+$('len').value));
  $('pw').textContent = Array.from(rnd, (n) => chars[n % chars.length]).join('');
  $('lenv').textContent = $('len').value;
}
['len', 'up', 'num', 'sym'].forEach((id) => $(id).addEventListener('input', generate));
$('gen').onclick = generate;
$('copy').onclick = () => navigator.clipboard.writeText($('pw').textContent);
generate();
</script>
</body>
</html>
''',
    }),
    ("Аккордеон FAQ", "web-app", "Жиі қойылатын сұрақтар — тек HTML <details> және CSS", {
        "index.html": '''<!DOCTYPE html>
<html lang="kk">
<head><meta charset="UTF-8"><title>FAQ</title><link rel="stylesheet" href="style.css"></head>
<body>
<main>
  <h1>Жиі қойылатын сұрақтар</h1>
  <details open><summary>Codo Hub деген не?</summary><p>Кодтарыңызбен бөлісіп, басқалардың жобаларынан үйренетін орын.</p></details>
  <details><summary>Тегін бе?</summary><p>Иә, барлық негізгі мүмкіндіктер тегін.</p></details>
  <details><summary>Қандай тілдер қолдау табады?</summary><p>Python, JavaScript, TypeScript, Go, Rust және тағы басқалары.</p></details>
  <details><summary>Жобаны қалай жүктеймін?</summary><p>«Жүктеу» батырмасын басып, папканы немесе ZIP файлды таңдаңыз.</p></details>
</main>
</body>
</html>
''',
        "style.css": '''body { font-family: system-ui, sans-serif; background: #fafaf9; margin: 0; }
main { max-width: 640px; margin: 60px auto; padding: 0 16px; }
details { background: #fff; border: 1px solid #e7e5e4; border-radius: 12px; margin-bottom: 10px; padding: 0 18px; }
summary { cursor: pointer; padding: 16px 0; font-weight: 600; list-style: none; display: flex; justify-content: space-between; }
summary::after { content: "+"; font-size: 20px; transition: transform .2s; }
details[open] summary::after { transform: rotate(45deg); }
details p { margin: 0 0 16px; color: #57534e; }
''',
    }),

    # ---------- Desktop ----------
    ("Tkinter блокнот", "desktop-app", "Ашу, сақтау, жаңа файл — Tkinter-дегі қарапайым мәтін редакторы", {
        "notepad.py": '''import tkinter as tk
from tkinter import filedialog, messagebox

root = tk.Tk()
root.title("Блокнот")
root.geometry("640x420")
text = tk.Text(root, wrap="word", undo=True, font=("Consolas", 12))
text.pack(fill="both", expand=True)


def new():
    text.delete("1.0", "end")


def open_file():
    path = filedialog.askopenfilename(filetypes=[("Мәтін", "*.txt"), ("Барлығы", "*.*")])
    if path:
        with open(path, encoding="utf-8") as f:
            new()
            text.insert("1.0", f.read())


def save():
    path = filedialog.asksaveasfilename(defaultextension=".txt")
    if path:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text.get("1.0", "end-1c"))
        messagebox.showinfo("Сақталды", path)


menu = tk.Menu(root)
file_menu = tk.Menu(menu, tearoff=False)
file_menu.add_command(label="Жаңа", command=new, accelerator="Ctrl+N")
file_menu.add_command(label="Ашу", command=open_file, accelerator="Ctrl+O")
file_menu.add_command(label="Сақтау", command=save, accelerator="Ctrl+S")
menu.add_cascade(label="Файл", menu=file_menu)
root.config(menu=menu)
root.bind("<Control-n>", lambda e: new())
root.bind("<Control-o>", lambda e: open_file())
root.bind("<Control-s>", lambda e: save())
root.mainloop()
''',
    }),
    ("Tkinter сағат", "desktop-app", "Үстел бетіндегі сандық сағат — әрқашан үстінде", {
        "clock.py": '''import tkinter as tk
from time import strftime

root = tk.Tk()
root.title("Сағат")
root.attributes("-topmost", True)
root.resizable(False, False)
label = tk.Label(root, font=("Segoe UI", 48, "bold"), bg="#111827", fg="#34d399", padx=24, pady=12)
label.pack()
date = tk.Label(root, font=("Segoe UI", 14), bg="#111827", fg="#9ca3af", pady=6)
date.pack(fill="x")


def tick():
    label.config(text=strftime("%H:%M:%S"))
    date.config(text=strftime("%d.%m.%Y"))
    root.after(1000, tick)


tick()
root.mainloop()
''',
    }),
    ("Файлдарды сұрыптаушы", "desktop-app", "Жүктеулер папкасын кеңейтімдер бойынша папкаларға бөледі", {
        "organizer.py": '''import shutil
import sys
from pathlib import Path

GROUPS = {
    "Суреттер": {".jpg", ".jpeg", ".png", ".gif", ".webp"},
    "Құжаттар": {".pdf", ".docx", ".txt", ".xlsx", ".pptx"},
    "Архивтер": {".zip", ".rar", ".7z"},
    "Видео": {".mp4", ".mkv", ".mov"},
    "Код": {".py", ".js", ".html", ".css", ".json"},
}


def organize(folder: Path, dry_run: bool) -> None:
    for file in folder.iterdir():
        if not file.is_file():
            continue
        group = next((g for g, exts in GROUPS.items() if file.suffix.lower() in exts), "Басқа")
        target = folder / group / file.name
        print(f"{file.name} → {group}/")
        if not dry_run:
            target.parent.mkdir(exist_ok=True)
            shutil.move(str(file), target)


if __name__ == "__main__":
    path = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    organize(path, dry_run="--dry" in sys.argv)
''',
    }),
    ("Электрон калькулятор", "desktop-app", "Electron қосымшасының ең кіші қаңқасы: терезе + интерфейс", {
        "main.js": '''const { app, BrowserWindow } = require('electron');

function createWindow() {
  const win = new BrowserWindow({ width: 320, height: 460, resizable: false, autoHideMenuBar: true });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
''',
        "index.html": '''<!DOCTYPE html>
<html lang="kk">
<head><meta charset="UTF-8"><title>Калькулятор</title>
<style>body{margin:0;background:#1e1e1e;font-family:sans-serif}
#d{color:#fff;font-size:40px;text-align:right;padding:24px 16px;min-height:48px;overflow:hidden}
.k{display:grid;grid-template-columns:repeat(4,1fr);gap:1px}
button{font-size:22px;padding:20px 0;border:0;background:#333;color:#fff}button.op{background:#ff9500}</style></head>
<body>
<div id="d">0</div>
<div class="k" id="k"></div>
<script>
const d = document.getElementById('d');
let expr = '';
'C ( ) / 7 8 9 * 4 5 6 - 1 2 3 + 0 . ⌫ ='.split(' ').forEach((key) => {
  const b = Object.assign(document.createElement('button'), { textContent: key });
  if ('/*-+='.includes(key)) b.className = 'op';
  b.onclick = () => {
    if (key === 'C') expr = '';
    else if (key === '⌫') expr = expr.slice(0, -1);
    else if (key === '=') { try { expr = String(Function(`return (${expr})`)()); } catch { expr = ''; d.textContent = 'Қате'; return; } }
    else expr += key;
    d.textContent = expr || '0';
  };
  document.getElementById('k').append(b);
});
</script>
</body>
</html>
''',
        "package.json": '''{
  "name": "electron-calculator",
  "version": "1.0.0",
  "main": "main.js",
  "scripts": { "start": "electron ." },
  "devDependencies": { "electron": "^31.0.0" }
}
''',
    }),
    ("Жүйе мониторы (C#)", "desktop-app", "WinForms: процессор мен жад жүктемесін секунд сайын көрсетеді", {
        "Program.cs": '''using System;
using System.Diagnostics;
using System.Windows.Forms;

static class Program
{
    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        var form = new Form { Text = "Жүйе мониторы", Width = 320, Height = 160 };
        var label = new Label { Dock = DockStyle.Fill, Font = new System.Drawing.Font("Segoe UI", 14) };
        form.Controls.Add(label);

        var cpu = new PerformanceCounter("Processor", "% Processor Time", "_Total");
        var timer = new Timer { Interval = 1000 };
        timer.Tick += (_, _) =>
        {
            var mem = Process.GetCurrentProcess().WorkingSet64 / 1024 / 1024;
            label.Text = $"Процессор: {cpu.NextValue():F0}%\\nОсы қосымша: {mem} МБ";
        };
        timer.Start();
        Application.Run(form);
    }
}
''',
    }),

    # ---------- Game ----------
    ("Сан табу ойыны", "game", "Компьютер 1–100 аралығында сан ойлайды, сіз табасыз", {
        "guess.py": '''import random

secret = random.randint(1, 100)
tries = 0
print("Мен 1-ден 100-ге дейін сан ойладым. Табыңыз!")
while True:
    try:
        guess = int(input("Сіздің болжам: "))
    except ValueError:
        print("Тек сан жазыңыз")
        continue
    tries += 1
    if guess < secret:
        print("Үлкенірек ⬆")
    elif guess > secret:
        print("Кішірек ⬇")
    else:
        print(f"Таптыңыз! 🎉 {tries} талпыныс")
        break
''',
    }),
    ("Крестики-нолики", "game", "Екі ойыншыға арналған X/O — жеңісті тексерумен", {
        "index.html": '''<!DOCTYPE html>
<html lang="kk">
<head><meta charset="UTF-8"><title>X / O</title>
<style>body{font-family:sans-serif;text-align:center;background:#f8fafc}
#b{display:inline-grid;grid-template-columns:repeat(3,90px);gap:6px;margin:20px}
#b button{height:90px;font-size:44px;border:0;border-radius:12px;background:#e2e8f0;cursor:pointer}
#s{font-size:22px}</style></head>
<body>
<h1>X / O</h1><div id="s">X жүреді</div><div id="b"></div><br><button onclick="reset()">Қайта бастау</button>
<script>
const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
let cells, turn, over;
const board = document.getElementById('b'), status = document.getElementById('s');
function winner() {
  for (const [a, b, c] of LINES) if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) return cells[a];
  return cells.every(Boolean) ? 'draw' : null;
}
function reset() {
  cells = Array(9).fill(''); turn = 'X'; over = false; board.innerHTML = ''; status.textContent = 'X жүреді';
  cells.forEach((_, i) => {
    const btn = document.createElement('button');
    btn.onclick = () => {
      if (over || cells[i]) return;
      cells[i] = btn.textContent = turn;
      const w = winner();
      if (w) { over = true; status.textContent = w === 'draw' ? 'Тең ойын 🤝' : `${w} жеңді! 🎉`; return; }
      turn = turn === 'X' ? 'O' : 'X'; status.textContent = `${turn} жүреді`;
    };
    board.append(btn);
  });
}
reset();
</script>
</body>
</html>
''',
    }),
    ("Жад ойыны", "game", "Жұп карталарды табу — эмодзилермен, жүріс санағышымен", {
        "index.html": '''<!DOCTYPE html>
<html lang="kk">
<head><meta charset="UTF-8"><title>Жад ойыны</title>
<style>body{font-family:sans-serif;text-align:center;background:#312e81;color:#fff}
#g{display:inline-grid;grid-template-columns:repeat(4,80px);gap:10px;margin:20px}
.c{height:80px;border-radius:12px;background:#6366f1;font-size:38px;display:grid;place-items:center;cursor:pointer;user-select:none}
.c.open,.c.done{background:#fff}.c.done{opacity:.5}</style></head>
<body>
<h1>Жад ойыны</h1><div id="info">Жүріс: 0</div><div id="g"></div>
<script>
const EMOJI = ['🍎', '🚀', '🐱', '🎸', '⚽', '🌙', '🍕', '🦄'];
const deck = [...EMOJI, ...EMOJI].sort(() => Math.random() - 0.5);
let open = [], moves = 0, found = 0;
deck.forEach((e) => {
  const c = Object.assign(document.createElement('div'), { className: 'c' });
  c.onclick = () => {
    if (open.length === 2 || c.classList.contains('open') || c.classList.contains('done')) return;
    c.classList.add('open'); c.textContent = e; open.push(c);
    if (open.length < 2) return;
    document.getElementById('info').textContent = `Жүріс: ${++moves}`;
    const [a, b] = open;
    setTimeout(() => {
      if (a.textContent === b.textContent) { a.className = b.className = 'c done'; found++; }
      else { a.className = b.className = 'c'; a.textContent = b.textContent = ''; }
      open = [];
      if (found === EMOJI.length) document.getElementById('info').textContent = `Жеңіс! ${moves} жүріс 🎉`;
    }, 700);
  };
  document.getElementById('g').append(c);
});
</script>
</body>
</html>
''',
    }),
    ("Понг", "game", "Canvas-та компьютерге қарсы понг: W/S немесе тінтуір", {
        "index.html": '''<!DOCTYPE html>
<html lang="kk">
<head><meta charset="UTF-8"><title>Понг</title>
<style>body{margin:0;background:#000;display:grid;place-items:center;height:100vh}canvas{background:#111;border:2px solid #333}</style></head>
<body>
<canvas id="c" width="640" height="400"></canvas>
<script>
const c = document.getElementById('c'), ctx = c.getContext('2d');
const P = { w: 10, h: 70 };
let me = 165, ai = 165, ball = { x: 320, y: 200, dx: 4, dy: 3 }, score = [0, 0], keys = {};
addEventListener('keydown', (e) => (keys[e.key] = true));
addEventListener('keyup', (e) => (keys[e.key] = false));
c.addEventListener('mousemove', (e) => (me = e.offsetY - P.h / 2));
function reset(dir) { ball = { x: 320, y: 200, dx: 4 * dir, dy: (Math.random() - 0.5) * 6 }; }
function step() {
  if (keys.w || keys.W) me -= 6;
  if (keys.s || keys.S) me += 6;
  ai += Math.sign(ball.y - (ai + P.h / 2)) * 3.5;
  me = Math.max(0, Math.min(c.height - P.h, me)); ai = Math.max(0, Math.min(c.height - P.h, ai));
  ball.x += ball.dx; ball.y += ball.dy;
  if (ball.y < 0 || ball.y > c.height) ball.dy *= -1;
  const hit = (py, px) => ball.y > py && ball.y < py + P.h && Math.abs(ball.x - px) < 8;
  if (hit(me, 20) || hit(ai, c.width - 20)) { ball.dx *= -1.05; ball.dy += (Math.random() - 0.5) * 2; }
  if (ball.x < 0) { score[1]++; reset(1); }
  if (ball.x > c.width) { score[0]++; reset(-1); }
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(15, me, P.w, P.h); ctx.fillRect(c.width - 25, ai, P.w, P.h);
  ctx.beginPath(); ctx.arc(ball.x, ball.y, 7, 0, Math.PI * 2); ctx.fill();
  ctx.font = '32px monospace'; ctx.fillText(`${score[0]}   ${score[1]}`, 270, 40);
  requestAnimationFrame(step);
}
step();
</script>
</body>
</html>
''',
    }),
    ("Тас-қайшы-қағаз", "game", "Компьютерге қарсы консоль ойын, есеппен", {
        "rps.py": '''import random

CHOICES = {"т": "тас", "қ": "қайшы", "ж": "қағаз"}
BEATS = {"тас": "қайшы", "қайшы": "қағаз", "қағаз": "тас"}
score = {"сіз": 0, "компьютер": 0}

while True:
    key = input("т — тас, қ — қайшы, ж — қағаз, q — шығу: ").strip().lower()
    if key == "q":
        break
    if key not in CHOICES:
        continue
    me, pc = CHOICES[key], random.choice(list(BEATS))
    if me == pc:
        result = "тең"
    elif BEATS[me] == pc:
        result = "сіз ұттыңыз"
        score["сіз"] += 1
    else:
        result = "компьютер ұтты"
        score["компьютер"] += 1
    print(f"Сіз: {me} · Компьютер: {pc} → {result}. Есеп {score['сіз']}:{score['компьютер']}")
''',
    }),
    ("Тетрис-блоктар (Pygame)", "game", "Pygame-де құлайтын блоктар — жолдар толса өшеді", {
        "blocks.py": '''import random
import pygame

W, H, S = 10, 20, 28
SHAPES = [[(0, 0), (1, 0), (0, 1), (1, 1)], [(0, 0), (1, 0), (2, 0), (3, 0)],
          [(0, 0), (1, 0), (2, 0), (1, 1)], [(0, 0), (0, 1), (1, 1), (2, 1)]]
COLORS = [(250, 204, 21), (56, 189, 248), (168, 85, 247), (34, 197, 94)]


def new_piece():
    i = random.randrange(len(SHAPES))
    return {"cells": SHAPES[i], "x": 4, "y": 0, "color": COLORS[i]}


def fits(grid, cells, x, y):
    return all(0 <= x + cx < W and y + cy < H and not grid[y + cy][x + cx] for cx, cy in cells)


pygame.init()
screen = pygame.display.set_mode((W * S, H * S))
clock = pygame.time.Clock()
grid = [[None] * W for _ in range(H)]
piece, fall, running = new_piece(), 0, True
while running:
    for e in pygame.event.get():
        if e.type == pygame.QUIT:
            running = False
        elif e.type == pygame.KEYDOWN:
            dx = {pygame.K_LEFT: -1, pygame.K_RIGHT: 1}.get(e.key, 0)
            if fits(grid, piece["cells"], piece["x"] + dx, piece["y"]):
                piece["x"] += dx
            if e.key == pygame.K_UP:
                rotated = [(-cy, cx) for cx, cy in piece["cells"]]
                if fits(grid, rotated, piece["x"], piece["y"]):
                    piece["cells"] = rotated
    fall += clock.tick(60)
    if fall > 400:
        fall = 0
        if fits(grid, piece["cells"], piece["x"], piece["y"] + 1):
            piece["y"] += 1
        else:
            for cx, cy in piece["cells"]:
                grid[piece["y"] + cy][piece["x"] + cx] = piece["color"]
            grid = [row for row in grid if not all(row)]
            grid = [[None] * W for _ in range(H - len(grid))] + grid
            piece = new_piece()
            if not fits(grid, piece["cells"], piece["x"], piece["y"]):
                running = False
    screen.fill((15, 23, 42))
    for y, row in enumerate(grid):
        for x, color in enumerate(row):
            if color:
                pygame.draw.rect(screen, color, (x * S, y * S, S - 1, S - 1))
    for cx, cy in piece["cells"]:
        pygame.draw.rect(screen, piece["color"], ((piece["x"] + cx) * S, (piece["y"] + cy) * S, S - 1, S - 1))
    pygame.display.flip()
pygame.quit()
''',
    }),

    # ---------- API ----------
    ("FastAPI тапсырмалар API", "api", "CRUD: GET/POST/PATCH/DELETE /todos, Pydantic модельдерімен", {
        "main.py": '''from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Todo API")


class TodoIn(BaseModel):
    title: str
    done: bool = False


class Todo(TodoIn):
    id: int


todos: dict[int, Todo] = {}
next_id = 1


@app.get("/todos")
def list_todos(done: bool | None = None) -> list[Todo]:
    return [t for t in todos.values() if done is None or t.done == done]


@app.post("/todos", status_code=201)
def create(todo: TodoIn) -> Todo:
    global next_id
    todos[next_id] = Todo(id=next_id, **todo.model_dump())
    next_id += 1
    return todos[next_id - 1]


@app.patch("/todos/{todo_id}")
def update(todo_id: int, todo: TodoIn) -> Todo:
    if todo_id not in todos:
        raise HTTPException(404, "Табылмады")
    todos[todo_id] = Todo(id=todo_id, **todo.model_dump())
    return todos[todo_id]


@app.delete("/todos/{todo_id}", status_code=204)
def delete(todo_id: int) -> None:
    if todos.pop(todo_id, None) is None:
        raise HTTPException(404, "Табылмады")
''',
        "requirements.txt": "fastapi\nuvicorn\n",
    }),
    ("Express REST сервер", "api", "Node.js/Express: кітаптар тізімі, валидация және қате өңдеу", {
        "server.js": '''const express = require('express');
const app = express();
app.use(express.json());

const books = [{ id: 1, title: 'Абай жолы', author: 'Мұхтар Әуезов' }];

app.get('/books', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  res.json(books.filter((b) => b.title.toLowerCase().includes(q)));
});

app.get('/books/:id', (req, res) => {
  const book = books.find((b) => b.id === Number(req.params.id));
  book ? res.json(book) : res.status(404).json({ error: 'Кітап табылмады' });
});

app.post('/books', (req, res) => {
  const { title, author } = req.body;
  if (!title || !author) return res.status(400).json({ error: 'title және author міндетті' });
  const book = { id: books.length + 1, title, author };
  books.push(book);
  res.status(201).json(book);
});

app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
app.listen(3000, () => console.log('http://localhost:3000/books'));
''',
        "package.json": '''{
  "name": "books-api",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": { "express": "^4.19.2" }
}
''',
    }),
    ("Go HTTP сервер", "api", "Стандарт кітапханамен JSON API: /health және /time", {
        "main.go": '''package main

import (
	"encoding/json"
	"log"
	"net/http"
	"time"
)

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /time", func(w http.ResponseWriter, r *http.Request) {
		loc, err := time.LoadLocation(r.URL.Query().Get("tz"))
		if err != nil {
			http.Error(w, "белгісіз уақыт белдеуі", http.StatusBadRequest)
			return
		}
		writeJSON(w, map[string]string{"time": time.Now().In(loc).Format(time.RFC3339)})
	})
	log.Println("http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", mux))
}
''',
    }),
    ("Flask URL қысқартқыш", "api", "Ұзын сілтемені қысқа кодқа айналдыру және редирект", {
        "app.py": '''import secrets

from flask import Flask, abort, jsonify, redirect, request

app = Flask(__name__)
links: dict[str, str] = {}


@app.post("/shorten")
def shorten():
    url = (request.get_json(silent=True) or {}).get("url", "")
    if not url.startswith(("http://", "https://")):
        return jsonify(error="Дұрыс URL жіберіңіз"), 400
    code = secrets.token_urlsafe(4)
    links[code] = url
    return jsonify(short=request.host_url + code), 201


@app.get("/<code>")
def follow(code):
    if code not in links:
        abort(404)
    return redirect(links[code])


if __name__ == "__main__":
    app.run(debug=True)
''',
    }),
    ("Ауа райы API клиенті", "api", "Open-Meteo-дан қаланың температурасын алу (кілтсіз API)", {
        "weather.py": '''import json
import sys
import urllib.request

CITIES = {"алматы": (43.24, 76.89), "астана": (51.17, 71.45), "шымкент": (42.32, 69.59)}


def current(lat: float, lon: float) -> dict:
    url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current_weather=true"
    with urllib.request.urlopen(url, timeout=10) as r:
        return json.load(r)["current_weather"]


if __name__ == "__main__":
    city = (sys.argv[1] if len(sys.argv) > 1 else "алматы").lower()
    if city not in CITIES:
        sys.exit(f"Белгілі қалалар: {', '.join(CITIES)}")
    w = current(*CITIES[city])
    print(f"{city.title()}: {w['temperature']}°C, жел {w['windspeed']} км/сағ")
''',
    }),
    ("GraphQL схемасы", "api", "Пайдаланушылар мен посттарға арналған GraphQL типтері мен сұраулары", {
        "schema.graphql": '''type User {
  id: ID!
  username: String!
  posts(first: Int = 10): [Post!]!
}

type Post {
  id: ID!
  title: String!
  body: String!
  author: User!
  likes: Int!
  createdAt: String!
}

type Query {
  me: User
  user(username: String!): User
  feed(first: Int = 20, after: ID): [Post!]!
}

type Mutation {
  createPost(title: String!, body: String!): Post!
  likePost(id: ID!): Post!
}
''',
        "example-query.graphql": '''query Feed {
  feed(first: 5) {
    title
    likes
    author { username }
  }
}
''',
    }),

    # ---------- Database ----------
    ("SQLite кітапхана", "database", "Python + sqlite3: кестелер, JOIN, параметрлі сұраулар", {
        "library.py": '''import sqlite3

db = sqlite3.connect(":memory:")
db.executescript("""
create table authors (id integer primary key, name text not null);
create table books (
    id integer primary key, title text not null, year integer,
    author_id integer references authors(id)
);
insert into authors (name) values ('Абай Құнанбайұлы'), ('Мұхтар Әуезов');
insert into books (title, year, author_id) values
    ('Қара сөздер', 1890, 1), ('Абай жолы', 1942, 2), ('Көксерек', 1929, 2);
""")

rows = db.execute("""
    select a.name, count(b.id), min(b.year)
    from authors a left join books b on b.author_id = a.id
    group by a.id order by count(b.id) desc
""").fetchall()
for name, count, first in rows:
    print(f"{name}: {count} кітап, алғашқысы {first} ж.")

year = 1900
print("1900-ден кейін:", [t for (t,) in db.execute("select title from books where year > ?", (year,))])
''',
    }),
    ("Интернет-дүкен схемасы", "database", "PostgreSQL: тауарлар, тапсырыстар, индекстер және есеп сұраулары", {
        "schema.sql": '''create table customers (
    id          serial primary key,
    email       text unique not null,
    full_name   text not null,
    created_at  timestamptz default now()
);

create table products (
    id     serial primary key,
    name   text not null,
    price  numeric(10, 2) not null check (price >= 0),
    stock  int not null default 0
);

create table orders (
    id           serial primary key,
    customer_id  int not null references customers(id),
    status       text not null default 'new' check (status in ('new', 'paid', 'shipped', 'cancelled')),
    created_at   timestamptz default now()
);

create table order_items (
    order_id    int references orders(id) on delete cascade,
    product_id  int references products(id),
    quantity    int not null check (quantity > 0),
    price       numeric(10, 2) not null,
    primary key (order_id, product_id)
);

create index on orders (customer_id, created_at desc);
''',
        "reports.sql": '''-- Ең көп сатылған 5 тауар
select p.name, sum(oi.quantity) as sold
from order_items oi join products p on p.id = oi.product_id
group by p.name order by sold desc limit 5;

-- Айлық түсім
select date_trunc('month', o.created_at) as month, sum(oi.quantity * oi.price) as revenue
from orders o join order_items oi on oi.order_id = o.id
where o.status in ('paid', 'shipped')
group by month order by month;
''',
    }),
    ("MongoDB агрегация", "database", "Node.js: санат бойынша орташа баға және top-3", {
        "aggregate.js": '''const { MongoClient } = require('mongodb');

async function main() {
  const client = await MongoClient.connect(process.env.MONGO_URL || 'mongodb://localhost:27017');
  const products = client.db('shop').collection('products');

  await products.deleteMany({});
  await products.insertMany([
    { name: 'Ноутбук', category: 'техника', price: 450000 },
    { name: 'Тінтуір', category: 'техника', price: 9000 },
    { name: 'Кітап', category: 'кітап', price: 4500 },
    { name: 'Дәптер', category: 'кеңсе', price: 600 },
  ]);

  const stats = await products.aggregate([
    { $group: { _id: '$category', avg: { $avg: '$price' }, count: { $sum: 1 } } },
    { $sort: { avg: -1 } },
    { $limit: 3 },
  ]).toArray();
  console.table(stats);
  await client.close();
}

main().catch(console.error);
''',
    }),
    ("Redis кэш декораторы", "database", "Функция нәтижесін Redis-те TTL-мен сақтайтын Python декораторы", {
        "cache.py": '''import functools
import json
import time

import redis

r = redis.Redis(decode_responses=True)


def cached(ttl: int = 60):
    def wrap(fn):
        @functools.wraps(fn)
        def inner(*args):
            key = f"cache:{fn.__name__}:{json.dumps(args)}"
            if (hit := r.get(key)) is not None:
                return json.loads(hit)
            value = fn(*args)
            r.setex(key, ttl, json.dumps(value))
            return value
        return inner
    return wrap


@cached(ttl=30)
def slow_square(n: int) -> int:
    time.sleep(2)
    return n * n


if __name__ == "__main__":
    for _ in range(2):
        start = time.perf_counter()
        print(slow_square(12), f"{time.perf_counter() - start:.2f}s")
''',
    }),
    ("SQL жаттығулары", "database", "Терезе функциялары, CTE және рекурсия мысалдары", {
        "exercises.sql": '''-- 1. Әр бөлімдегі ең көп жалақы алатын қызметкер
select name, department, salary
from (
    select *, rank() over (partition by department order by salary desc) as r
    from employees
) t
where r = 1;

-- 2. Жинақталған сатылым (running total)
select day, amount, sum(amount) over (order by day) as total
from sales;

-- 3. Басшылар иерархиясы (рекурсивті CTE)
with recursive chain as (
    select id, name, manager_id, 0 as depth from employees where manager_id is null
    union all
    select e.id, e.name, e.manager_id, c.depth + 1
    from employees e join chain c on e.manager_id = c.id
)
select repeat('  ', depth) || name as tree from chain order by depth;
''',
    }),

    # ---------- DevOps ----------
    ("Python Dockerfile", "devops", "Көп кезеңді Docker құрастыру: кішкентай, root-сыз образ", {
        "Dockerfile": '''FROM python:3.12-slim AS build
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.12-slim
WORKDIR /app
COPY --from=build /install /usr/local
COPY . .
RUN useradd --create-home app
USER app
EXPOSE 8000
HEALTHCHECK CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
''',
        ".dockerignore": "__pycache__/\n*.pyc\n.venv/\n.env\n.git/\n",
    }),
    ("Docker Compose стегі", "devops", "Backend + PostgreSQL + Redis бір командамен", {
        "docker-compose.yml": '''services:
  api:
    build: .
    ports: ["8000:8000"]
    environment:
      DATABASE_URL: postgresql://app:secret@db:5432/app
      REDIS_URL: redis://cache:6379
    depends_on:
      db: { condition: service_healthy }
      cache: { condition: service_started }

  db:
    image: postgres:16
    environment: { POSTGRES_USER: app, POSTGRES_PASSWORD: secret, POSTGRES_DB: app }
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s

  cache:
    image: redis:7-alpine

volumes:
  pgdata:
''',
    }),
    ("GitHub Actions CI", "devops", "Әр push-та тесттер мен линтер: Python матрицасы", {
        ".github/workflows/ci.yml": '''name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python: ["3.11", "3.12", "3.13"]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python }}
          cache: pip
      - run: pip install -r requirements.txt ruff pytest
      - run: ruff check .
      - run: pytest -q
''',
    }),
    ("Сервер бэкап скрипті", "devops", "Bash: папканы архивтеп, 7 күннен ескі бэкаптарды өшіру", {
        "backup.sh": '''#!/usr/bin/env bash
set -euo pipefail

SOURCE="${1:-/var/www}"
DEST="${2:-/backups}"
KEEP_DAYS=7
STAMP="$(date +%Y-%m-%d_%H-%M)"
ARCHIVE="$DEST/backup_$STAMP.tar.gz"

mkdir -p "$DEST"
echo "→ $SOURCE архивтелуде…"
tar -czf "$ARCHIVE" -C "$(dirname "$SOURCE")" "$(basename "$SOURCE")"
echo "✓ $(du -h "$ARCHIVE" | cut -f1) — $ARCHIVE"

deleted=$(find "$DEST" -name 'backup_*.tar.gz' -mtime +"$KEEP_DAYS" -print -delete | wc -l)
echo "✓ ескі бэкаптар өшірілді: $deleted"
''',
    }),
    ("Kubernetes деплой", "devops", "Deployment + Service + HPA: 2–10 под, CPU бойынша масштабтау", {
        "k8s.yaml": '''apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 2
  selector:
    matchLabels: { app: web }
  template:
    metadata:
      labels: { app: web }
    spec:
      containers:
        - name: web
          image: ghcr.io/example/web:1.0.0
          ports: [{ containerPort: 8000 }]
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits: { cpu: 500m, memory: 256Mi }
          readinessProbe:
            httpGet: { path: /health, port: 8000 }
---
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector: { app: web }
  ports: [{ port: 80, targetPort: 8000 }]
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: web
spec:
  scaleTargetRef: { apiVersion: apps/v1, kind: Deployment, name: web }
  minReplicas: 2
  maxReplicas: 10
  metrics:
    - type: Resource
      resource: { name: cpu, target: { type: Utilization, averageUtilization: 70 } }
''',
    }),

    # ---------- Other ----------
    ("Алгоритмдер жинағы", "other", "Бинарлы іздеу, жылдам сұрыптау, БЭК — тесттерімен", {
        "algorithms.py": '''def binary_search(items, target):
    lo, hi = 0, len(items) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if items[mid] == target:
            return mid
        if items[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1


def quicksort(items):
    if len(items) <= 1:
        return items
    pivot, *rest = items
    return quicksort([x for x in rest if x < pivot]) + [pivot] + quicksort([x for x in rest if x >= pivot])


def gcd(a, b):
    while b:
        a, b = b, a % b
    return a
''',
        "test_algorithms.py": '''import unittest

from algorithms import binary_search, gcd, quicksort


class Test(unittest.TestCase):
    def test_binary_search(self):
        self.assertEqual(binary_search([1, 3, 5, 7, 9], 7), 3)
        self.assertEqual(binary_search([1, 3, 5], 4), -1)

    def test_quicksort(self):
        self.assertEqual(quicksort([5, 2, 9, 1, 5, 6]), [1, 2, 5, 5, 6, 9])

    def test_gcd(self):
        self.assertEqual(gcd(48, 18), 6)


if __name__ == "__main__":
    unittest.main()
''',
    }),
    ("Қазақша латын конвертері", "other", "Кирилл мәтінін 2021 жылғы латын әліпбиіне аудару", {
        "latin.py": '''TABLE = {
    "а": "a", "ә": "ä", "б": "b", "в": "v", "г": "g", "ғ": "ğ", "д": "d", "е": "e", "ё": "io",
    "ж": "j", "з": "z", "и": "i", "й": "i", "к": "k", "қ": "q", "л": "l", "м": "m", "н": "n",
    "ң": "ñ", "о": "o", "ө": "ö", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ұ": "ū",
    "ү": "ü", "ф": "f", "х": "h", "һ": "h", "ц": "ts", "ч": "ch", "ш": "ş", "щ": "şş", "ъ": "",
    "ы": "y", "і": "ı", "ь": "", "э": "e", "ю": "iu", "я": "ia",
}


def to_latin(text: str) -> str:
    out = []
    for ch in text:
        lat = TABLE.get(ch.lower(), ch)
        out.append(lat.capitalize() if ch.isupper() else lat)
    return "".join(out)


if __name__ == "__main__":
    print(to_latin("Қазақстан Республикасы — тәуелсіз мемлекет."))
    print(to_latin("Сәлем, әлем!"))
''',
    }),
    ("Rust: сөз санағыш", "other", "stdin-нен оқып, жол/сөз/таңба санын шығаратын wc аналогы", {
        "main.rs": '''use std::io::{self, Read};

fn main() {
    let mut text = String::new();
    io::stdin().read_to_string(&mut text).expect("stdin оқылмады");

    let lines = text.lines().count();
    let words = text.split_whitespace().count();
    let chars = text.chars().count();

    println!("жол: {lines}, сөз: {words}, таңба: {chars}");
}
''',
        "Cargo.toml": '''[package]
name = "wc-kz"
version = "0.1.0"
edition = "2021"
''',
    }),
    ("Java: банк шоты", "other", "ООП мысалы: инкапсуляция, ерекше жағдайлар, тарих", {
        "BankAccount.java": '''import java.util.ArrayList;
import java.util.List;

public class BankAccount {
    private final String owner;
    private long balance;
    private final List<String> history = new ArrayList<>();

    public BankAccount(String owner) { this.owner = owner; }

    public void deposit(long amount) {
        if (amount <= 0) throw new IllegalArgumentException("Сома оң болуы керек");
        balance += amount;
        history.add("+" + amount);
    }

    public void withdraw(long amount) {
        if (amount > balance) throw new IllegalStateException("Қаражат жеткіліксіз");
        balance -= amount;
        history.add("-" + amount);
    }

    public static void main(String[] args) {
        var acc = new BankAccount("Айдос");
        acc.deposit(50_000);
        acc.withdraw(12_500);
        try {
            acc.withdraw(1_000_000);
        } catch (IllegalStateException e) {
            System.out.println("Қате: " + e.getMessage());
        }
        System.out.println(acc.owner + ": " + acc.balance + " ₸, тарих " + acc.history);
    }
}
''',
    }),
    ("C++: матрицаны көбейту", "other", "Шаблонды Matrix класы және операторды қайта анықтау", {
        "matrix.cpp": '''#include <iostream>
#include <vector>

template <typename T>
struct Matrix {
    size_t n, m;
    std::vector<T> a;
    Matrix(size_t n, size_t m) : n(n), m(m), a(n * m) {}
    T& operator()(size_t i, size_t j) { return a[i * m + j]; }
    T operator()(size_t i, size_t j) const { return a[i * m + j]; }

    Matrix operator*(const Matrix& o) const {
        Matrix r(n, o.m);
        for (size_t i = 0; i < n; ++i)
            for (size_t k = 0; k < m; ++k)
                for (size_t j = 0; j < o.m; ++j) r(i, j) += (*this)(i, k) * o(k, j);
        return r;
    }
};

int main() {
    Matrix<int> a(2, 3), b(3, 2);
    int v = 1;
    for (auto& x : a.a) x = v++;
    for (auto& x : b.a) x = v++;
    auto c = a * b;
    for (size_t i = 0; i < c.n; ++i) {
        for (size_t j = 0; j < c.m; ++j) std::cout << c(i, j) << '\\t';
        std::cout << '\\n';
    }
}
''',
    }),
]
