'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, 'public');
const TOTAL_QUESTIONS = 5;
const QUESTION_MS = Number(process.env.QUIZ_QUESTION_MS || 10_000);
const REVEAL_MS = Number(process.env.QUIZ_REVEAL_MS || 4_000);
const ROOM_LIFETIME_MS = 2 * 60 * 60 * 1000;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Five items adapted directly from the uploaded “How Well Do You Know the Team?” game.
// The facilitator question is explicitly about best fit, not a rotating meeting assignment.
const QUESTIONS = [
  {
    question: 'Who is best suited to the facilitator role in our team profiles?',
    options: ['Michael', 'Ademide (Demo) Otuyalo', 'Laurens Bell', 'Sharonm'],
    correct: 1,
    explanation: 'Demo’s honesty, perspective, and creativity support facilitation.'
  },
  {
    question: 'What are Michael’s top THREE VIA strengths?',
    options: ['Humor • Honesty • Hope', 'Kindness • Fairness • Spirituality', 'Curiosity • Creativity • Bravery', 'Leadership • Zest • Prudence'],
    correct: 0,
    explanation: 'Michael’s VIA strengths are Humor, Honesty, and Hope.'
  },
  {
    question: 'Which strengths belong to Sharonm?',
    options: ['Hope • Honesty • Teamwork', 'Humor • Curiosity • Creativity', 'Kindness • Fairness • Spirituality', 'Bravery • Zest • Leadership'],
    correct: 1,
    explanation: 'Sharonm’s top VIA strengths are Humor, Curiosity, and Creativity.'
  },
  {
    question: 'Whose top three strengths are Kindness, Fairness, and Spirituality?',
    options: ['Laurens Bell', 'Michael', 'Sharonm', 'Ademide'],
    correct: 0,
    explanation: 'Laurens has Kindness, Fairness, and Spirituality as her top strengths.'
  },
  {
    question: 'What is Sharonm’s suggested leadership style?',
    options: ['Adaptive', 'Directive', 'Transactional', 'Servant'],
    correct: 0,
    explanation: 'Sharonm’s curiosity and creativity align with adaptive leadership.'
  }
];

const rooms = new Map();
const token = () => crypto.randomBytes(24).toString('hex');
function code() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = Array.from({length: 5}, () => ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)]).join('');
    if (!rooms.has(value)) return value;
  }
  throw new Error('Could not generate room code');
}
function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': Buffer.byteLength(data)
  });
  res.end(data);
}
function readJSON(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 8192) { reject(new Error('Request is too large')); req.destroy(); }
    });
    req.on('end', () => { try {resolve(JSON.parse(body || '{}'));} catch {reject(new Error('Invalid JSON'));} });
    req.on('error', reject);
  });
}
function validRoom(codeValue) {
  const value = String(codeValue || '').trim().toUpperCase();
  return rooms.get(value) || null;
}
function auth(room, value) {
  if (!room || typeof value !== 'string') return null;
  if (value === room.hostToken) return {role: 'host'};
  const player = room.players.find(player => player.token === value);
  return player ? {role: 'player', player} : null;
}
function rankings(room) {
  return [...room.players].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)
    .map((player, index) => ({rank: index + 1, name: player.name, score: player.score, id: player.id}));
}
function publicState(room, authInfo) {
  const players = room.players.map(p => ({id: p.id, name: p.name, score: p.score}));
  const base = {
    code: room.code, phase: room.phase, totalQuestions: TOTAL_QUESTIONS,
    questionNumber: room.index + 1, secondsPerQuestion: QUESTION_MS / 1000,
    players, leaderboard: rankings(room),
    answeredCount: room.answers.size, playerCount: room.players.length,
    endsAt: room.endsAt,
    myAnswer: authInfo?.role === 'player' ? room.answers.get(authInfo.player.token) ?? null : null,
    myScore: authInfo?.role === 'player' ? authInfo.player.score : null
  };
  if (room.phase === 'question' || room.phase === 'reveal') {
    base.question = QUESTIONS[room.index].question;
    base.options = QUESTIONS[room.index].options;
  }
  if (room.phase === 'reveal') {
    const q = QUESTIONS[room.index];
    base.correct = q.correct;
    base.explanation = q.explanation;
  }
  return base;
}
function streamEvent(res, event, payload) {
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`); } catch {}
}
function publish(room) {
  for (const listener of room.listeners) {
    streamEvent(listener.res, 'state', publicState(room, listener.authInfo));
  }
}
function finishQuestion(room) {
  if (room.phase !== 'question') return;
  const q = QUESTIONS[room.index];
  for (const player of room.players) {
    if (room.answers.get(player.token) === q.correct) player.score += 100;
  }
  room.phase = 'reveal';
  room.endsAt = Date.now() + REVEAL_MS;
  publish(room);
  room.timeout = setTimeout(() => {
    if (room.index >= TOTAL_QUESTIONS - 1) {
      room.phase = 'finished'; room.endsAt = null;
      publish(room);
    } else {
      room.index++;
      askQuestion(room);
    }
  }, REVEAL_MS);
}
function askQuestion(room) {
  room.phase = 'question';
  room.answers.clear();
  room.endsAt = Date.now() + QUESTION_MS;
  publish(room);
  room.timeout = setTimeout(() => finishQuestion(room), QUESTION_MS);
}
function clearRoom(room) {
  clearTimeout(room.timeout);
  for (const listener of room.listeners) {
    streamEvent(listener.res, 'expired', {message: 'The room has expired. Please create a new one.'});
    try {listener.res.end();} catch {}
  }
  room.listeners.clear();
  rooms.delete(room.code);
}
setInterval(() => {
  for (const room of rooms.values()) {
    if (Date.now() - room.createdAt > ROOM_LIFETIME_MS) clearRoom(room);
  }
}, 60_000).unref();

function staticFile(req, res, pathname) {
  const route = pathname === '/' || pathname === '/join' ? '/index.html' : pathname;
  if (!['/index.html', '/styles.css', '/app.js'].includes(route)) {
    return json(res, 404, {error: 'Not found'});
  }
  const file = path.join(ROOT, route);
  const type = route.endsWith('.css') ? 'text/css' : route.endsWith('.js') ? 'application/javascript' : 'text/html';
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, {error: 'Not found'});
    res.writeHead(200, {
      'Content-Type': `${type}; charset=utf-8`, 'Content-Length': data.length,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'"
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  try {
    if (pathname === '/api/health' && req.method === 'GET') return json(res, 200, {ok: true, rooms: rooms.size});
    if (pathname === '/api/events' && req.method === 'GET') {
      const room = validRoom(url.searchParams.get('code'));
      const authInfo = auth(room, url.searchParams.get('token'));
      if (!authInfo) return json(res, 401, {error: 'Your room session could not be found.'});
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write('retry: 1500\n\n');
      const listener = {res, authInfo};
      room.listeners.add(listener);
      streamEvent(res, 'state', publicState(room, authInfo));
      const heartbeat = setInterval(() => {try {res.write(': keepalive\n\n');} catch {}}, 20_000);
      req.on('close', () => { clearInterval(heartbeat); room.listeners.delete(listener); });
      return;
    }
    if (pathname.startsWith('/api/') && req.method === 'POST') {
      const input = await readJSON(req);
      if (pathname === '/api/create') {
        const roomCode = code();
        const room = { code: roomCode, hostToken: token(), createdAt: Date.now(),
          phase: 'lobby', index: -1, answers: new Map(), players: [], listeners: new Set(), timeout: null, endsAt: null };
        rooms.set(roomCode, room);
        return json(res, 200, {code: roomCode, token: room.hostToken, role: 'host'});
      }
      if (pathname === '/api/join') {
        const room = validRoom(input.code);
        if (!room) return json(res, 404, {error: 'Room not found. Check the code.'});
        if (room.phase !== 'lobby') return json(res, 409, {error: 'This game has already started.'});
        if (room.players.length >= 120) return json(res, 409, {error: 'Room is full.'});
        const name = String(input.name || '').trim().replace(/[\r\n\t]/g, ' ').slice(0, 24);
        if (!name) return json(res, 400, {error: 'Please enter your name.'});
        if (room.players.some(player => player.name.toLowerCase() === name.toLowerCase())) {
          return json(res, 409, {error: 'That name is taken in this room. Try another one.'});
        }
        const player = {id: crypto.randomUUID(), token: token(), name, joinedAt: Date.now(), score: 0};
        room.players.push(player);
        publish(room);
        return json(res, 200, {code: room.code, token: player.token, role: 'player', name});
      }
      if (pathname === '/api/resume') {
        const room = validRoom(input.code);
        const a = auth(room, input.token);
        if (!a) return json(res, 401, {error: 'Session expired or no longer available.'});
        return json(res, 200, {code: room.code, token: input.token, role: a.role, name: a.player?.name || ''});
      }
      if (pathname === '/api/start') {
        const room = validRoom(input.code);
        const a = auth(room, input.token);
        if (a?.role !== 'host') return json(res, 403, {error: 'Only the host can start.'});
        if (room.phase !== 'lobby') return json(res, 409, {error: 'The game has already started.'});
        if (room.players.length === 0) return json(res, 409, {error: 'At least one player must join first.'});
        room.index = 0;
        for (const player of room.players) player.score = 0;
        askQuestion(room);
        return json(res, 200, {ok: true});
      }
      if (pathname === '/api/answer') {
        const room = validRoom(input.code);
        const a = auth(room, input.token);
        if (a?.role !== 'player') return json(res, 403, {error: 'Join the game to answer.'});
        if (room.phase !== 'question') return json(res, 409, {error: 'Answers are closed.'});
        if (room.answers.has(a.player.token)) return json(res, 409, {error: 'You already answered this question.'});
        if (!Number.isInteger(input.choice) || input.choice < 0 || input.choice > 3) return json(res, 400, {error: 'Invalid answer.'});
        if (Date.now() >= room.endsAt) return json(res, 409, {error: 'Time is up.'});
        room.answers.set(a.player.token, input.choice);
        publish(room);
        return json(res, 200, {ok: true});
      }
      if (pathname === '/api/restart') {
        const room = validRoom(input.code);
        const a = auth(room, input.token);
        if (a?.role !== 'host') return json(res, 403, {error: 'Only the host can restart.'});
        clearTimeout(room.timeout);
        room.phase = 'lobby'; room.index = -1; room.endsAt = null; room.answers.clear();
        for (const player of room.players) player.score = 0;
        publish(room);
        return json(res, 200, {ok: true});
      }
      return json(res, 404, {error: 'Not found'});
    }
    if (req.method === 'GET') return staticFile(req, res, pathname);
    return json(res, 405, {error: 'Method not allowed'});
  } catch (error) {
    if (!res.headersSent && !res.writableEnded) json(res, 400, {error: error.message || 'Request failed'});
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Quiz running at http://localhost:${PORT}`));
