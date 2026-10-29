// Todo тізімі: қосу, белгілеу, өшіру, сүзгі. Деректер localStorage-қа сақталады.
const KEY = 'todos';

const form = document.getElementById('form');
const input = document.getElementById('text');
const list = document.getElementById('list');
const empty = document.getElementById('empty');
const count = document.getElementById('count');
const clearBtn = document.getElementById('clear');
const filterButtons = document.querySelectorAll('[data-filter]');

let todos = load();
let filter = 'all';

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(todos));
  } catch {
    // Жеке режимде сақтау мүмкін болмауы мүмкін — тізім бәрібір жұмыс істейді
  }
}

function visible() {
  if (filter === 'active') return todos.filter((t) => !t.done);
  if (filter === 'done') return todos.filter((t) => t.done);
  return todos;
}

function render() {
  list.replaceChildren(...visible().map((todo) => {
    const li = document.createElement('li');
    li.className = `item${todo.done ? ' done' : ''}`;
    li.dataset.id = todo.id;

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = todo.done;
    box.className = 'toggle';

    const text = document.createElement('span');
    text.textContent = todo.text;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'delete';
    del.title = 'Өшіру';
    del.textContent = '×';

    li.append(box, text, del);
    return li;
  }));

  const left = todos.filter((t) => !t.done).length;
  count.textContent = `${left} тапсырма қалды`;
  empty.hidden = visible().length > 0;
  clearBtn.hidden = !todos.some((t) => t.done);
  filterButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.filter === filter));
}

function update(next) {
  todos = next;
  save();
  render();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  const id = todos.reduce((max, t) => Math.max(max, t.id), 0) + 1;
  update([...todos, { id, text, done: false }]);
  input.value = '';
  input.focus();
});

list.addEventListener('click', (e) => {
  const item = e.target.closest('.item');
  if (!item) return;
  const id = Number(item.dataset.id);
  if (e.target.classList.contains('toggle')) {
    update(todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  } else if (e.target.classList.contains('delete')) {
    update(todos.filter((t) => t.id !== id));
  }
});

filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    filter = button.dataset.filter;
    render();
  });
});

clearBtn.addEventListener('click', () => update(todos.filter((t) => !t.done)));

render();
