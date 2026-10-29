// Жылан ойыны: тамақ жеген сайын ұзарады, қабырғаға не өзіне соғылса — ойын бітеді.
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');

const CELLS = 20;
const SIZE = canvas.width / CELLS;
const DIRS = {
  ArrowUp: { x: 0, y: -1 }, KeyW: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 }, KeyS: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 }, KeyA: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 }, KeyD: { x: 1, y: 0 },
};

let snake, dir, queue, food, score, state, timer;
let best = readBest();
bestEl.textContent = best;

function readBest() {
  try {
    return Number(localStorage.getItem('snake-best')) || 0;
  } catch {
    return 0;
  }
}

function saveBest() {
  try {
    localStorage.setItem('snake-best', String(best));
  } catch {
    // сақтау мүмкін емес — рекорд тек осы ойында көрінеді
  }
}

function reset() {
  snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
  dir = { x: 1, y: 0 };
  queue = [];
  score = 0;
  scoreEl.textContent = score;
  food = placeFood();
  state = 'ready';
  setSpeed();
  draw();
}

function placeFood() {
  const free = [];
  for (let x = 0; x < CELLS; x++) {
    for (let y = 0; y < CELLS; y++) {
      if (!snake.some((p) => p.x === x && p.y === y)) free.push({ x, y });
    }
  }
  return free[Math.floor(Math.random() * free.length)] || null;
}

// Әр 5 тамақ сайын сәл жылдамдайды
function setSpeed() {
  clearInterval(timer);
  timer = setInterval(tick, Math.max(60, 150 - Math.floor(score / 5) * 10));
}

function tick() {
  if (state !== 'playing') return;
  // Бір кадрда бірнеше перне басылса — кезекпен орындаймыз (артқа бұрылуға болмайды)
  while (queue.length) {
    const next = queue.shift();
    if (next.x !== -dir.x || next.y !== -dir.y) {
      dir = next;
      break;
    }
  }

  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
  const ate = food && head.x === food.x && head.y === food.y;
  const body = ate ? snake : snake.slice(0, -1);
  const hitWall = head.x < 0 || head.y < 0 || head.x >= CELLS || head.y >= CELLS;
  if (hitWall || body.some((p) => p.x === head.x && p.y === head.y)) {
    gameOver();
    return;
  }

  snake = [head, ...body];
  if (ate) {
    score++;
    scoreEl.textContent = score;
    food = placeFood();
    if (!food) {
      gameOver(true);
      return;
    }
    if (score % 5 === 0) setSpeed();
  }
  draw();
}

function gameOver(won = false) {
  state = 'over';
  if (score > best) {
    best = score;
    bestEl.textContent = best;
    saveBest();
  }
  draw();
  overlay(won ? 'Жеңіс! 🎉' : 'Ойын бітті', `Ұпай: ${score}. Қайта бастау — Бос орын`);
}

function draw() {
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (food) {
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.arc((food.x + 0.5) * SIZE, (food.y + 0.5) * SIZE, SIZE / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
  }

  snake.forEach((p, i) => {
    ctx.fillStyle = i === 0 ? '#8ce99a' : '#51cf66';
    ctx.fillRect(p.x * SIZE + 1, p.y * SIZE + 1, SIZE - 2, SIZE - 2);
  });

  if (state === 'ready') overlay('Жылан', 'Бастау үшін көрсеткіні не Бос орынды басыңыз');
  if (state === 'paused') overlay('Пауза', 'Жалғастыру — Бос орын');
}

function overlay(title, text) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.fillText(title, canvas.width / 2, canvas.height / 2 - 10);
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 20);
}

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (state === 'over') reset();
    else if (state === 'playing') state = 'paused';
    else state = 'playing';
    draw();
    return;
  }
  const next = DIRS[e.code];
  if (!next) return;
  e.preventDefault();
  if (state === 'over') return;
  if (state !== 'playing') state = 'playing';
  if (queue.length < 3) queue.push(next);
});

reset();
