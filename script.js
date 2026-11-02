'use strict';

const STORAGE_KEY = 'calc_history';
const THEME_KEY = 'calc_theme';
const SOUND_KEY = 'calc_sound';
const ANGLE_KEY = 'calc_angle';

const state = {
  expr: '',
  result: '0',
  justCalculated: false,
  error: false,
};

let angleMode = localStorage.getItem(ANGLE_KEY) || 'DEG'; // DEG or RAD
let memory = 0;
let soundEnabled = localStorage.getItem(SOUND_KEY) !== 'false';

const $ = (id) => document.getElementById(id);
const exprEl = $('expr');
const resultEl = $('result');
const historyList = $('historyList');
const historyEmpty = $('historyEmpty');
const toastEl = $('toast');

let audioCtx = null;
function beep() {
  if (!soundEnabled) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 660;
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.08);
    osc.stop(audioCtx.currentTime + 0.09);
  } catch (e) {}
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

function formatNumber(n) {
  if (!isFinite(n)) return 'Error';
  let s = Number(n.toFixed(12)).toString();
  if (s === '-0') s = '0';
  return s;
}

function toRad(x) { return angleMode === 'DEG' ? x * Math.PI / 180 : x; }
function fromRad(x) { return angleMode === 'DEG' ? x * 180 / Math.PI : x; }

function factorial(n) {
  if (n < 0 || !Number.isInteger(n)) throw new Error('Invalid factorial');
  if (n > 170) throw new Error('Too large');
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

const FUNCS = {
  sin: (x) => Math.sin(toRad(x)),
  cos: (x) => Math.cos(toRad(x)),
  tan: (x) => Math.tan(toRad(x)),
  asin: (x) => fromRad(Math.asin(x)),
  acos: (x) => fromRad(Math.acos(x)),
  atan: (x) => fromRad(Math.atan(x)),
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  log: (x) => { if (x <= 0) throw new Error('Invalid log'); return Math.log10(x); },
  ln: (x) => { if (x <= 0) throw new Error('Invalid ln'); return Math.log(x); },
  sqrt: (x) => { if (x < 0) throw new Error('Invalid sqrt'); return Math.sqrt(x); },
  cbrt: Math.cbrt,
  abs: Math.abs,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
};

// ---- Tokenizer ----
function tokenize(s) {
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let num = '';
      while (i < s.length && /[0-9.]/.test(s[i])) { num += s[i]; i++; }
      tokens.push({ type: 'num', value: num });
      continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let id = '';
      while (i < s.length && /[a-zA-Z]/.test(s[i])) { id += s[i]; i++; }
      const low = id.toLowerCase();
      if (low === 'pi') tokens.push({ type: 'const', value: 'pi' });
      else if (low === 'e') tokens.push({ type: 'const', value: 'e' });
      else tokens.push({ type: 'func', value: low });
      continue;
    }
    if ('+-*/%^!'.includes(c)) {
      tokens.push({ type: 'op', value: c });
      i++;
      continue;
    }
    if (c === '(' || c === ')') {
      tokens.push({ type: 'paren', value: c });
      i++;
      continue;
    }
    throw new Error('Invalid character');
  }
  return tokens;
}

class Parser {
  constructor(tokens) { this.tokens = tokens; this.pos = 0; }
  peek() { return this.tokens[this.pos]; }
  next() { return this.tokens[this.pos++]; }
  parse() {
    const val = this.expr();
    if (this.pos !== this.tokens.length) throw new Error('Unexpected token');
    return val;
  }
  expr() {
    let val = this.term();
    while (this.peek() && this.peek().type === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.next().value;
      const rhs = this.term();
      val = op === '+' ? val + rhs : val - rhs;
    }
    return val;
  }
  term() {
    let val = this.pow();
    while (this.peek() && this.peek().type === 'op' && (this.peek().value === '*' || this.peek().value === '/')) {
      const op = this.next().value;
      const rhs = this.pow();
      if (op === '*') val = val * rhs;
      else {
        if (rhs === 0) throw new Error('Division by zero');
        val = val / rhs;
      }
    }
    return val;
  }
  pow() {
    const base = this.unary();
    if (this.peek() && this.peek().type === 'op' && this.peek().value === '^') {
      this.next();
      const exp = this.pow(); // right assoc
      return Math.pow(base, exp);
    }
    return base;
  }
  unary() {
    if (this.peek() && this.peek().type === 'op' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.next().value;
      const v = this.unary();
      return op === '-' ? -v : v;
    }
    return this.postfix();
  }
  postfix() {
    let val = this.primary();
    // postfix operators: ! and %
    let loop = true;
    while (loop) {
      const t = this.peek();
      if (t && t.type === 'op' && t.value === '!') {
        this.next();
        val = factorial(val);
      } else if (t && t.type === 'op' && t.value === '%') {
        this.next();
        val = val / 100;
      } else {
        loop = false;
      }
    }
    return val;
  }
  primary() {
    const t = this.peek();
    if (!t) throw new Error('Unexpected end');
    if (t.type === 'num') {
      this.next();
      if (t.value.split('.').length > 2) throw new Error('Invalid number');
      const v = parseFloat(t.value);
      if (isNaN(v)) throw new Error('Invalid number');
      return v;
    }
    if (t.type === 'const') {
      this.next();
      return t.value === 'pi' ? Math.PI : Math.E;
    }
    if (t.type === 'func') {
      const name = t.value;
      if (!FUNCS[name]) throw new Error('Unknown function');
      this.next();
      if (!this.peek() || this.peek().type !== 'paren' || this.peek().value !== '(') throw new Error('Expected (');
      this.next();
      const arg = this.expr();
      if (!this.peek() || this.peek().type !== 'paren' || this.peek().value !== ')') throw new Error('Missing )');
      this.next();
      return FUNCS[name](arg);
    }
    if (t.type === 'paren' && t.value === '(') {
      this.next();
      const v = this.expr();
      if (!this.peek() || this.peek().type !== 'paren' || this.peek().value !== ')') throw new Error('Missing )');
      this.next();
      return v;
    }
    throw new Error('Expected number');
  }
}

function safeEval(expr) {
  if (!expr || !expr.trim()) return null;
  const tokens = tokenize(expr);
  const p = new Parser(tokens);
  const result = p.parse();
  if (!isFinite(result)) throw new Error('Invalid result');
  return result;
}

function render() {
  exprEl.textContent = state.expr.replace(/\*/g, '×').replace(/\//g, '÷');
  resultEl.textContent = state.error ? 'Error' : state.result;
  resultEl.classList.remove('pop');
  void resultEl.offsetWidth;
  resultEl.classList.add('pop');
}

function pushHistory(expr, result) {
  const list = loadHistory();
  list.unshift({ expr: expr.replace(/\*/g, '×').replace(/\//g, '÷'), result });
  if (list.length > 50) list.pop();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  renderHistory();
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

function renderHistory() {
  const list = loadHistory();
  historyList.innerHTML = '';
  historyEmpty.style.display = list.length ? 'none' : 'block';
  list.forEach((h) => {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.innerHTML = `<div class="h-expr">${escapeHtml(h.expr)}</div><div class="h-res">${escapeHtml(h.result)}</div>`;
    li.addEventListener('click', () => {
      state.expr = h.result;
      state.result = h.result;
      state.justCalculated = true;
      state.error = false;
      render();
      beep();
    });
    historyList.appendChild(li);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function currentNumberSegment() {
  let idx = -1;
  for (let i = state.expr.length - 1; i >= 0; i--) {
    if ('+-*/%^('.includes(state.expr[i])) { idx = i; break; }
  }
  return state.expr.slice(idx + 1);
}

function appendValue(v) {
  if (state.error) { state.expr = ''; state.error = false; }
  if (state.justCalculated) {
    if (/^[0-9.]/.test(v) || v === 'pi' || v === 'e' || /^[a-z]/i.test(v)) { state.expr = ''; }
    state.justCalculated = false;
  }
  if (v === '.') {
    const seg = currentNumberSegment();
    if (seg.includes('.')) return;
    if (seg === '' || seg === '-' || seg === '+') state.expr += '0';
  }
  state.expr += v;
  livePreview();
  render();
  beep();
}

function appendOperator(op) {
  if (state.error) { state.expr = ''; state.error = false; }
  if (state.expr === '' && op === '-') {
    state.expr = '-';
    render(); beep(); return;
  }
  if (state.expr === '') return;
  if (state.justCalculated) state.justCalculated = false;
  const last = state.expr[state.expr.length - 1];
  if ('+-*/%^'.includes(last) && !(op === '-' && last !== '-')) {
    state.expr = state.expr.slice(0, -1) + op;
  } else {
    state.expr += op;
  }
  render();
  beep();
}

function livePreview() {
  const last = state.expr[state.expr.length - 1];
  if ('+-*/%^('.includes(last)) return;
  try {
    const r = safeEval(state.expr);
    if (r !== null) state.result = formatNumber(r);
  } catch (e) {}
}

function doEquals() {
  if (state.expr === '') return;
  try {
    const r = safeEval(state.expr);
    if (r === null) return;
    const formatted = formatNumber(r);
    if (formatted === 'Error') throw new Error('Invalid');
    pushHistory(state.expr, formatted);
    state.result = formatted;
    state.expr = formatted;
    state.justCalculated = true;
    state.error = false;
    render();
    beep();
  } catch (e) {
    state.error = true;
    state.result = e.message === 'Division by zero' ? 'Cannot ÷ by 0' : 'Error';
    render();
    toast(state.result);
  }
}

function clearAll() {
  state.expr = '';
  state.result = '0';
  state.justCalculated = false;
  state.error = false;
  render();
  beep();
}

function deleteLast() {
  if (state.error) { clearAll(); return; }
  if (state.justCalculated) { clearAll(); return; }
  state.expr = state.expr.slice(0, -1);
  livePreview();
  if (state.expr === '') state.result = '0';
  render();
  beep();
}

function toggleSign() {
  if (state.error) return;
  const seg = currentNumberSegment();
  if (seg === '') return;
  const idx = state.expr.length - seg.length;
  let prefix = state.expr.slice(0, idx);
  let num = seg;
  if (num.startsWith('-')) num = num.slice(1);
  else num = '-' + num;
  state.expr = prefix + num;
  livePreview();
  render();
  beep();
}

// Keyboard
document.addEventListener('keydown', (e) => {
  const k = e.key;
  if (/^[0-9]$/.test(k)) { appendValue(k); e.preventDefault(); return; }
  if (k === '.') { appendValue('.'); e.preventDefault(); return; }
  if (k === '+') { appendOperator('+'); e.preventDefault(); return; }
  if (k === '-') { appendOperator('-'); e.preventDefault(); return; }
  if (k === '*') { appendOperator('*'); e.preventDefault(); return; }
  if (k === '/') { appendOperator('/'); e.preventDefault(); return; }
  if (k === '%') { appendOperator('%'); e.preventDefault(); return; }
  if (k === '^') { appendOperator('^'); e.preventDefault(); return; }
  if (k === '!') { appendOperator('!'); e.preventDefault(); return; }
  if (k === '(') { appendValue('('); e.preventDefault(); return; }
  if (k === ')') { appendValue(')'); e.preventDefault(); return; }
  if (k === 'Enter' || k === '=') { doEquals(); e.preventDefault(); return; }
  if (k === 'Backspace') { deleteLast(); e.preventDefault(); return; }
  if (k === 'Escape') { clearAll(); e.preventDefault(); return; }
});

// Button clicks (delegated)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button.btn');
  if (!btn) return;
  const v = btn.dataset.value;
  const action = btn.dataset.action;
  if (v !== undefined) {
    if ('+-*/%^!'.includes(v)) appendOperator(v);
    else appendValue(v);
  } else if (action) {
    if (action === 'ac') clearAll();
    else if (action === 'del') deleteLast();
    else if (action === 'sign') toggleSign();
    else if (action === 'equals') doEquals();
    else if (action === 'func') appendValue(btn.dataset.value);
    else if (action === 'const') appendValue(btn.dataset.value);
    else if (action === 'factorial') appendOperator('!');
  }
});

// Theme
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  $('themeToggle').textContent = t === 'dark' ? '🌙' : '☀️';
  localStorage.setItem(THEME_KEY, t);
}
applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
$('themeToggle').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  applyTheme(cur === 'dark' ? 'light' : 'dark');
  beep();
});

// Sound
function applySound() {
  $('soundToggle').textContent = soundEnabled ? '🔊' : '🔇';
  localStorage.setItem(SOUND_KEY, String(soundEnabled));
}
applySound();
$('soundToggle').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  applySound();
  beep();
});

// Angle mode
function applyAngle() {
  $('degToggle').textContent = angleMode;
  localStorage.setItem(ANGLE_KEY, angleMode);
}
applyAngle();
$('degToggle').addEventListener('click', () => {
  angleMode = angleMode === 'DEG' ? 'RAD' : 'DEG';
  applyAngle();
  beep();
});

// Copy
$('copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(state.result); toast('Copied'); }
  catch { toast('Copy failed'); }
  beep();
});

$('clearExprBtn').addEventListener('click', () => clearAll());

// Memory
$('mcBtn').addEventListener('click', () => { memory = 0; toast('MC'); beep(); });
$('mrBtn').addEventListener('click', () => { appendValue(formatNumber(memory)); beep(); });
$('mplusBtn').addEventListener('click', () => {
  try { memory += safeEval(state.result === 'Error' ? '0' : state.result) || 0; toast('M+'); }
  catch { toast('M+ failed'); }
  beep();
});
$('mminusBtn').addEventListener('click', () => {
  try { memory -= safeEval(state.result === 'Error' ? '0' : state.result) || 0; toast('M−'); }
  catch { toast('M− failed'); }
  beep();
});

$('clearHistoryBtn').addEventListener('click', () => {
  localStorage.removeItem(STORAGE_KEY);
  renderHistory();
  toast('History cleared');
  beep();
});

render();
renderHistory();