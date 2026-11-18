'use strict';

const root = document.getElementById('app');
const statusLabel = document.getElementById('connection');
const toastElement = document.getElementById('toast');
const landingMarkup = root.innerHTML;
const LETTERS = ['A', 'B', 'C', 'D'];
let currentSession = null;
let state = null;
let events = null;
let timerHandle = null;
let toastTimeout = null;

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function notify(message) {
  toastElement.textContent = message;
  toastElement.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toastElement.classList.remove('show'), 3700);
}
async function post(route, body) {
  const res = await fetch('/api/' + route, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  let data = {};
  try { data = await res.json(); } catch { throw new Error('The server is unavailable.'); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function roomLink() { return `${location.origin}/join?room=${encodeURIComponent(currentSession.code)}`; }
function remember(session) {
  currentSession = session;
  localStorage.setItem('hit-quiz-session-v1', JSON.stringify(session));
  history.replaceState({}, '', location.pathname === '/join' ? '/join' : '/');
  subscribe();
}
function disconnect() {
  if (events) events.close();
  events = null;
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
}
function goHome(clear = true) {
  disconnect();
  currentSession = null; state = null;
  if (clear) localStorage.removeItem('hit-quiz-session-v1');
  root.innerHTML = landingMarkup;
  statusLabel.textContent = 'READY TO PLAY';
  prefillCode();
}
function prefillCode() {
  const code = new URLSearchParams(location.search).get('room');
  if (code && root.querySelector('#room-code')) root.querySelector('#room-code').value = code.toUpperCase();
}
function subscribe() {
  disconnect();
  const params = new URLSearchParams({code: currentSession.code, token: currentSession.token});
  events = new EventSource('/api/events?' + params.toString());
  statusLabel.textContent = 'CONNECTING…';
  events.addEventListener('open', () => statusLabel.textContent = '● LIVE GAME');
  events.addEventListener('state', event => {
    state = JSON.parse(event.data);
    render();
    statusLabel.textContent = '● LIVE GAME';
  });
  events.addEventListener('expired', () => {notify('This room expired. Please start another game.'); goHome();});
  events.onerror = () => { statusLabel.textContent = 'RECONNECTING…'; };
  timerHandle = setInterval(updateClock, 100);
}
function timeLeft() { return state?.endsAt ? Math.max(0, state.endsAt - Date.now()) : 0; }
function updateClock() {
  const remaining = timeLeft();
  const timer = root.querySelector('[data-timer]');
  if (timer) timer.textContent = String(Math.ceil(remaining / 1000)).padStart(2, '0');
  const progress = root.querySelector('[data-progress]');
  if (progress && state) {
    const total = state.phase === 'reveal' ? 4000 : state.secondsPerQuestion * 1000;
    progress.style.width = `${Math.max(0, Math.min(100, remaining / total * 100))}%`;
  }
}
function topbar(phaseText) {
  return `<div class="game-top"><span class="phase-label">${esc(phaseText)}</span><div class="room-pill">ROOM <strong>${esc(currentSession.code)}</strong></div></div>`;
}
function leaderboard(limit = 100) {
  const rows = (state?.leaderboard || []).slice(0, limit).map((p, i) => `<tr><td class="${i===0?'first':''}">${i + 1}${i === 0 ? ' ★' : ''}</td><td>${esc(p.name)}</td><td class="score">${p.score}</td></tr>`).join('');
  return `<table class="leaderboard"><thead><tr><th>RANK</th><th>PLAYER</th><th>POINTS</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No players yet</td></tr>'}</tbody></table>`;
}
function renderLobby() {
  const host = currentSession.role === 'host';
  const count = state.players.length;
  root.innerHTML = `<section class="game-shell">
    ${topbar('MISSION 00 // THE CREW')}
    <h1 class="large-title">${host ? 'YOUR ROOM IS <span class="accent">READY</span>' : 'YOU’RE <span class="accent">IN!</span>'}</h1>
    <p class="sublead">${host ? 'Share the link or room code with your classmates. Everyone joins on their own phone.' : 'Your host will begin the five-question challenge when the class is ready.'}</p>
    ${host ? `<div class="panel lobby-card"><div class="panel-tag">INVITE PLAYERS</div><h2>Room code: <span style="color:var(--yellow)">${esc(currentSession.code)}</span></h2><div class="sharelink"><a href="${esc(roomLink())}" target="_blank" rel="noopener noreferrer">${esc(roomLink())}</a><button class="mini-btn" data-action="copy">COPY LINK</button></div><p class="small">Open the link on classmates’ phones, or enter the room code on the homepage.</p></div>` : ''}
    <div class="stats"><div class="stat"><div class="num">${count}</div><div class="desc">PLAYERS JOINED</div></div><div class="stat"><div class="num">5</div><div class="desc">MISSIONS</div></div><div class="stat"><div class="num">10s</div><div class="desc">EACH QUESTION</div></div></div>
    <div class="panel lobby-card"><div class="panel-tag">THE CREW</div>${count ? `<ul class="names">${state.players.map(p => `<li>${esc(p.name)}</li>`).join('')}</ul>` : '<div class="waiting">Waiting for the first player to join…</div>'}</div>
    <div style="margin-top:22px;display:flex;gap:12px;flex-wrap:wrap;align-items:center">${host ? `<button class="btn btn-pink" data-action="start" ${!count?'disabled':''}>START 5-MISSION QUIZ <span>→</span></button>` : '<span class="waiting" style="flex:1">WAITING FOR THE HOST TO PRESS START…</span>'}<button class="btn btn-ghost" data-action="leave">LEAVE ROOM</button></div>
  </section>`;
}
function renderQuestion() {
  const host = currentSession.role === 'host';
  const revealing = state.phase === 'reveal';
  const answered = state.myAnswer !== null;
  const answersHTML = state.options.map((opt, index) => {
    const mine = answered && state.myAnswer === index;
    const right = revealing && state.correct === index;
    const wrong = revealing && mine && !right;
    const classes = ['answer', mine && 'chosen', right && 'correct', wrong && 'incorrect-chosen'].filter(Boolean).join(' ');
    return `<button class="${classes}" type="button" data-choice="${index}" ${host || answered || revealing ? 'disabled' : ''}><b>${LETTERS[index]}</b><span>${esc(opt)}</span></button>`;
  }).join('');
  let panel = '';
  if (revealing) {
    panel = `<div class="reveal" role="status"><div class="success-title">RIGHT ANSWER: ${LETTERS[state.correct]}</div><strong>${esc(state.options[state.correct])}</strong><p>${esc(state.explanation)}</p></div><div class="panel" style="padding:18px 24px"><div class="panel-tag">CURRENT LEADERBOARD</div>${leaderboard(6)}</div>`;
  }
  root.innerHTML = `<section class="game-shell">
    ${topbar(revealing ? 'ANSWER REVEAL // SCORE UPDATE' : `MISSION ${String(state.questionNumber).padStart(2, '0')} // CHOOSE A / B / C / D`)}
    <div class="question-kicker"><span class="meta">QUESTION ${state.questionNumber} / ${state.totalQuestions}</span><span class="timer"><span data-timer>10</span> s</span></div>
    <div class="countdown"><div class="countdown-fill" data-progress></div></div>
    <h1 class="question-title">${esc(state.question)}</h1>
    <div class="answers">${answersHTML}</div>
    <p class="status-line">${revealing ? 'Next question loads automatically.' : host ? `${state.answeredCount} of ${state.playerCount} players answered` : answered ? 'ANSWER LOCKED ✓ · Wait for the reveal' : 'Choose your answer before time runs out!'}</p>
    ${panel}
  </section>`;
  updateClock();
}
function resultLabel(points) {
  if (points >= 500) return 'VICE CITY CREW LEGEND';
  if (points >= 400) return 'NEON INSIDER';
  if (points >= 200) return 'RISING RECRUIT';
  return 'BACK TO ORIENTATION';
}
function renderFinish() {
  const isHost = currentSession.role === 'host';
  const winner = state.leaderboard[0];
  const label = isHost ? resultLabel(winner?.score || 0) : resultLabel(state.myScore || 0);
  root.innerHTML = `<section class="game-shell">
    ${topbar('MISSION COMPLETE // FINAL SCORE')}
    <h1 class="result-heading">${esc(label)}</h1>
    ${winner ? `<div class="winner">🏆 ${esc(winner.name)} LEADS WITH ${winner.score} POINTS!</div>` : ''}
    <div class="panel result-panel"><div class="panel-tag">FINAL CLASS LEADERBOARD</div>${leaderboard()}</div>
    <p class="center sublead">Every strength makes the team stronger.</p>
    <div class="center">${isHost ? '<button class="btn btn-cyan" data-action="restart">PLAY AGAIN <span>↺</span></button>' : '<div class="small">Thanks for playing! The host can start another round.</div>'}</div>
  </section>`;
}
function render() {
  if (!state || !currentSession) return;
  if (state.phase === 'lobby') renderLobby();
  else if (state.phase === 'question' || state.phase === 'reveal') renderQuestion();
  else if (state.phase === 'finished') renderFinish();
}
async function callSafe(route, body) {
  try { return await post(route, body); }
  catch (err) { notify(err.message); return null; }
}
root.addEventListener('submit', async event => {
  if (event.target.id !== 'join-form') return;
  event.preventDefault();
  const code = document.getElementById('room-code').value.trim().toUpperCase();
  const name = document.getElementById('player-name').value.trim();
  const response = await callSafe('join', {code, name});
  if (response) remember(response);
});
root.addEventListener('click', async event => {
  const clickTarget = event.target.closest('button');
  if (!clickTarget) return;
  if (clickTarget.id === 'create-game') {
    clickTarget.disabled = true;
    const response = await callSafe('create', {});
    if (response) remember(response); else clickTarget.disabled = false;
    return;
  }
  const choiceAttr = clickTarget.getAttribute('data-choice');
  if (choiceAttr !== null && currentSession && state?.phase === 'question') {
    clickTarget.disabled = true;
    await callSafe('answer', {code: currentSession.code, token: currentSession.token, choice: Number(choiceAttr)});
    return;
  }
  const action = clickTarget.getAttribute('data-action');
  if (action === 'copy') {
    try { await navigator.clipboard.writeText(roomLink()); notify('Join link copied!'); }
    catch { notify('Copy the link shown above.'); }
  } else if (action === 'start' || action === 'restart') {
    clickTarget.disabled = true;
    await callSafe(action, {code: currentSession.code, token: currentSession.token});
  } else if (action === 'leave') {
    goHome();
  }
});
(async () => {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem('hit-quiz-session-v1') || 'null'); } catch {}
  const requestedCode = new URLSearchParams(location.search).get('room');
  if (stored && (!requestedCode || requestedCode.toUpperCase() === stored.code)) {
    const result = await callSafe('resume', stored);
    if (result) { remember(result); return; }
    localStorage.removeItem('hit-quiz-session-v1');
  }
  prefillCode();
})();
