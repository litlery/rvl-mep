'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, 'data');
const VOTES_FILE = path.join(DATA_DIR, 'votes.json');
const TRACKS_FILE = path.join(ROOT_DIR, 'tracks.json');

const ADMIN_NICKNAME = 'litlery';
const ADMIN_TELEGRAM = '@melight';

const FPS_OPTIONS = [
  { id: '24fps', label: '24fps' },
  { id: '30fps', label: '30fps' },
  { id: '60fps', label: '60fps' },
];
const FPS_BY_ID = new Map(FPS_OPTIONS.map((f) => [f.id, f]));

const AUDIO_MIME = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function parseFilenameFallback(filename) {
  const base = filename.replace(/\.(mp3|m4a|wav|ogg)$/i, '').trim();
  const sep = base.includes(' – ') ? ' – ' : base.includes(' - ') ? ' - ' : null;
  if (sep) {
    const [artist, ...rest] = base.split(sep);
    return { artist: artist.trim(), title: rest.join(sep).trim() };
  }
  return { artist: 'Неизвестный исполнитель', title: base };
}

function loadTracks() {
  const tracks = [];
  const seenFiles = new Set();

  if (fs.existsSync(TRACKS_FILE)) {
    try {
      const configured = JSON.parse(fs.readFileSync(TRACKS_FILE, 'utf8'));
      for (const item of configured) {
        const fullPath = path.join(ROOT_DIR, item.file);
        if (fs.existsSync(fullPath)) {
          tracks.push({
            id: item.id,
            file: item.file,
            fullPath,
            artist: item.artist,
            title: item.title,
          });
          seenFiles.add(item.file);
        }
      }
    } catch (err) {
      console.error('Failed to read tracks.json:', err.message);
    }
  }

  // Also auto-discover any additional audio files placed in the project root
  const entries = fs.readdirSync(ROOT_DIR);
  let extraIndex = tracks.length + 1;
  for (const name of entries) {
    if (seenFiles.has(name)) continue;
    const ext = path.extname(name).toLowerCase();
    if (!AUDIO_MIME[ext]) continue;
    const parsed = parseFilenameFallback(name);
    tracks.push({
      id: `track-${String(extraIndex++).padStart(2, '0')}`,
      file: name,
      fullPath: path.join(ROOT_DIR, name),
      artist: parsed.artist,
      title: parsed.title,
    });
  }

  return tracks;
}

const TRACKS = loadTracks();
const TRACK_BY_ID = new Map(TRACKS.map((t) => [t.id, t]));

function loadStore() {
  ensureDataDir();
  if (!fs.existsSync(VOTES_FILE)) {
    return { songVotes: [], fpsVotes: [] };
  }
  try {
    const raw = fs.readFileSync(VOTES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { songVotes: parsed, fpsVotes: [] };
    }
    return {
      songVotes: Array.isArray(parsed.songVotes) ? parsed.songVotes : [],
      fpsVotes: Array.isArray(parsed.fpsVotes) ? parsed.fpsVotes : [],
    };
  } catch (err) {
    console.error('Failed to parse votes.json:', err.message);
    return { songVotes: [], fpsVotes: [] };
  }
}

let store = loadStore();

function saveVotes() {
  ensureDataDir();
  const tmpFile = `${VOTES_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmpFile, VOTES_FILE);
}

function getClientIp(req) {
  const cfIp = req.headers['cf-connecting-ip'];
  const xff = req.headers['x-forwarded-for'];
  const realIp = req.headers['x-real-ip'];
  let ip = '';

  if (typeof cfIp === 'string' && cfIp.trim()) {
    ip = cfIp.trim();
  } else if (typeof xff === 'string' && xff.trim()) {
    ip = xff.split(',')[0].trim();
  } else if (typeof realIp === 'string' && realIp.trim()) {
    ip = realIp.trim();
  } else {
    ip = req.socket.remoteAddress || 'unknown';
  }

  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  if (ip === '::1') {
    ip = '127.0.0.1';
  }
  return ip;
}

function normalizeNickname(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

function normalizeTelegram(raw) {
  let val = String(raw || '').trim();
  if (!val) return '';
  if (val.startsWith('https://t.me/')) val = val.slice('https://t.me/'.length);
  if (val.startsWith('http://t.me/')) val = val.slice('http://t.me/'.length);
  if (val.startsWith('t.me/')) val = val.slice('t.me/'.length);
  val = val.replace(/^@+/, '');
  return val ? `@${val}` : '';
}

function validateIdentity(rawNick, rawTg) {
  const nickname = normalizeNickname(rawNick);
  const telegram = normalizeTelegram(rawTg);

  if (nickname.length < 2 || nickname.length > 40) {
    return { error: 'Никнейм должен содержать от 2 до 40 символов.' };
  }
  if (!/^@[a-zA-Z0-9_]{3,32}$/.test(telegram)) {
    return { error: 'Введите корректный Telegram-юзернейм (например, @username, от 3 до 32 латинских символов, цифр или _).' };
  }
  return { nickname, telegram };
}

function isAdminIdentity(nickname, telegram) {
  return (
    normalizeNickname(nickname).toLowerCase() === ADMIN_NICKNAME &&
    normalizeTelegram(telegram).toLowerCase() === ADMIN_TELEGRAM
  );
}

function buildPublicState(clientIp) {
  // Song poll state
  const songVotes = store.songVotes;
  const totalVoters = songVotes.length;
  const counts = {};
  for (const t of TRACKS) {
    counts[t.id] = 0;
  }
  for (const v of songVotes) {
    for (const tid of v.trackIds) {
      if (counts[tid] !== undefined) {
        counts[tid] += 1;
      }
    }
  }

  const stats = {};
  for (const t of TRACKS) {
    const count = counts[t.id] || 0;
    const percent = totalVoters > 0 ? Math.round((count / totalVoters) * 1000) / 10 : 0;
    stats[t.id] = { count, percent };
  }

  const publicVoters = [...songVotes]
    .sort((a, b) => new Date(b.votedAt) - new Date(a.votedAt))
    .map((v) => ({
      id: v.id,
      nickname: v.nickname,
      telegram: v.telegram,
      votedAt: v.votedAt,
      trackIds: v.trackIds,
    }));

  const ownVoteRecord = clientIp ? songVotes.find((v) => v.ip === clientIp) : null;
  const myVote = ownVoteRecord
    ? {
        nickname: ownVoteRecord.nickname,
        telegram: ownVoteRecord.telegram,
        votedAt: ownVoteRecord.votedAt,
        trackIds: ownVoteRecord.trackIds,
      }
    : null;

  // FPS poll state
  const fpsVotes = store.fpsVotes;
  const totalFpsVoters = fpsVotes.length;
  const fpsCounts = {};
  for (const f of FPS_OPTIONS) {
    fpsCounts[f.id] = 0;
  }
  for (const v of fpsVotes) {
    for (const fid of v.fpsIds) {
      if (fpsCounts[fid] !== undefined) {
        fpsCounts[fid] += 1;
      }
    }
  }

  const fpsStats = {};
  for (const f of FPS_OPTIONS) {
    const count = fpsCounts[f.id] || 0;
    const percent = totalFpsVoters > 0 ? Math.round((count / totalFpsVoters) * 1000) / 10 : 0;
    fpsStats[f.id] = { count, percent };
  }

  const publicFpsVoters = [...fpsVotes]
    .sort((a, b) => new Date(b.votedAt) - new Date(a.votedAt))
    .map((v) => ({
      id: v.id,
      nickname: v.nickname,
      telegram: v.telegram,
      votedAt: v.votedAt,
      fpsIds: v.fpsIds,
    }));

  const ownFpsRecord = clientIp ? fpsVotes.find((v) => v.ip === clientIp) : null;
  const myFpsVote = ownFpsRecord
    ? {
        nickname: ownFpsRecord.nickname,
        telegram: ownFpsRecord.telegram,
        votedAt: ownFpsRecord.votedAt,
        fpsIds: ownFpsRecord.fpsIds,
      }
    : null;

  return {
    tracks: TRACKS.map((t) => ({
      id: t.id,
      artist: t.artist,
      title: t.title,
      audioUrl: `/audio/${encodeURIComponent(t.id)}`,
    })),
    stats,
    voters: publicVoters,
    totalVoters,
    myVote,
    fpsOptions: FPS_OPTIONS,
    fpsStats,
    fpsVoters: publicFpsVoters,
    totalFpsVoters,
    myFpsVote,
  };
}

// SSE client registry
const sseClients = new Set();

function broadcastUpdate(reason = 'update') {
  for (const client of sseClients) {
    try {
      const payload = {
        reason,
        ...buildPublicState(client.ip),
      };
      client.res.write(`event: state\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

setInterval(() => {
  for (const client of sseClients) {
    try {
      client.res.write(': ping\n\n');
    } catch {
      sseClients.delete(client);
    }
  }
}, 25000).unref();

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serveAudio(req, res, trackId) {
  const track = TRACK_BY_ID.get(trackId);
  if (!track || !fs.existsSync(track.fullPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Audio not found');
    return;
  }

  const stat = fs.statSync(track.fullPath);
  const fileSize = stat.size;
  const ext = path.extname(track.file).toLowerCase();
  const contentType = AUDIO_MIME[ext] || 'application/octet-stream';
  const range = req.headers.range;

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) {
      res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
      res.end();
      return;
    }

    const start = match[1] ? parseInt(match[1], 10) : 0;
    const end = match[2] ? Math.min(parseInt(match[2], 10), fileSize - 1) : fileSize - 1;

    if (isNaN(start) || isNaN(end) || start > end || start >= fileSize) {
      res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
      res.end();
      return;
    }

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    });

    const stream = fs.createReadStream(track.fullPath, { start, end });
    stream.on('error', () => res.end());
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Accept-Ranges': 'bytes',
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    });
    const stream = fs.createReadStream(track.fullPath);
    stream.on('error', () => res.end());
    stream.pipe(res);
  }
}

function serveStatic(req, res, pathname) {
  let relPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const fullPath = path.join(PUBLIC_DIR, safePath);

  if (!fullPath.startsWith(PUBLIC_DIR) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  const ext = path.extname(fullPath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': STATIC_MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  fs.createReadStream(fullPath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;
  const clientIp = getClientIp(req);

  try {
    if (req.method === 'GET' && pathname === '/api/state') {
      return sendJson(res, 200, buildPublicState(clientIp));
    }

    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const client = { res, ip: clientIp };
      sseClients.add(client);

      const initial = { reason: 'init', ...buildPublicState(clientIp) };
      res.write(`event: state\ndata: ${JSON.stringify(initial)}\n\n`);

      req.on('close', () => {
        sseClients.delete(client);
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth') {
      const body = await readJsonBody(req);
      const checked = validateIdentity(body.nickname, body.telegram);
      if (checked.error) {
        return sendJson(res, 400, { error: checked.error });
      }

      const isAdmin = isAdminIdentity(checked.nickname, checked.telegram);
      const existingByIp = store.songVotes.find((v) => v.ip === clientIp);
      const existingByTg = store.songVotes.find(
        (v) => v.telegram.toLowerCase() === checked.telegram.toLowerCase()
      );
      const existingFpsByIp = store.fpsVotes.find((v) => v.ip === clientIp);
      const existingFpsByTg = store.fpsVotes.find(
        (v) => v.telegram.toLowerCase() === checked.telegram.toLowerCase()
      );

      return sendJson(res, 200, {
        ok: true,
        nickname: checked.nickname,
        telegram: checked.telegram,
        isAdmin,
        ipLocked: Boolean(existingByIp),
        tgLocked: Boolean(existingByTg),
        myVote: existingByIp
          ? {
              nickname: existingByIp.nickname,
              telegram: existingByIp.telegram,
              votedAt: existingByIp.votedAt,
              trackIds: existingByIp.trackIds,
            }
          : existingByTg
          ? {
              nickname: existingByTg.nickname,
              telegram: existingByTg.telegram,
              votedAt: existingByTg.votedAt,
              trackIds: existingByTg.trackIds,
            }
          : null,
        myFpsVote: existingFpsByIp
          ? {
              nickname: existingFpsByIp.nickname,
              telegram: existingFpsByIp.telegram,
              votedAt: existingFpsByIp.votedAt,
              fpsIds: existingFpsByIp.fpsIds,
            }
          : existingFpsByTg
          ? {
              nickname: existingFpsByTg.nickname,
              telegram: existingFpsByTg.telegram,
              votedAt: existingFpsByTg.votedAt,
              fpsIds: existingFpsByTg.fpsIds,
            }
          : null,
      });
    }

    if (req.method === 'POST' && pathname === '/api/vote') {
      const body = await readJsonBody(req);
      const checked = validateIdentity(body.nickname, body.telegram);
      if (checked.error) {
        return sendJson(res, 400, { error: checked.error });
      }

      if (!Array.isArray(body.trackIds) || body.trackIds.length === 0) {
        return sendJson(res, 400, { error: 'Выберите хотя бы одну песню.' });
      }

      const uniqueTracks = [...new Set(body.trackIds)].filter((id) => TRACK_BY_ID.has(id));
      if (uniqueTracks.length === 0) {
        return sendJson(res, 400, { error: 'Выбранные треки не найдены.' });
      }

      const existingByIp = store.songVotes.find((v) => v.ip === clientIp);
      if (existingByIp) {
        return sendJson(res, 409, {
          error: `С вашего IP-адреса уже проголосовали (${existingByIp.nickname}, ${existingByIp.telegram}). Повторное голосование или голосование за другого человека с одного IP запрещено.`,
        });
      }

      const existingByTg = store.songVotes.find(
        (v) => v.telegram.toLowerCase() === checked.telegram.toLowerCase()
      );
      if (existingByTg) {
        return sendJson(res, 409, {
          error: `Пользователь с Telegram ${existingByTg.telegram} уже проголосовал.`,
        });
      }

      const voteRecord = {
        id: crypto.randomUUID(),
        nickname: checked.nickname,
        telegram: checked.telegram,
        ip: clientIp,
        trackIds: uniqueTracks,
        votedAt: new Date().toISOString(),
      };

      store.songVotes.push(voteRecord);
      saveVotes();
      broadcastUpdate('vote');

      return sendJson(res, 200, {
        ok: true,
        state: buildPublicState(clientIp),
      });
    }

    if (req.method === 'POST' && pathname === '/api/vote-fps') {
      const body = await readJsonBody(req);
      const checked = validateIdentity(body.nickname, body.telegram);
      if (checked.error) {
        return sendJson(res, 400, { error: checked.error });
      }

      if (!Array.isArray(body.fpsIds) || body.fpsIds.length === 0) {
        return sendJson(res, 400, { error: 'Выберите хотя бы один вариант FPS.' });
      }

      const uniqueFps = [...new Set(body.fpsIds)].filter((id) => FPS_BY_ID.has(id));
      if (uniqueFps.length === 0) {
        return sendJson(res, 400, { error: 'Выбранный вариант FPS не найден.' });
      }

      const existingByIp = store.fpsVotes.find((v) => v.ip === clientIp);
      if (existingByIp) {
        return sendJson(res, 409, {
          error: `С вашего IP-адреса уже проголосовали за FPS (${existingByIp.nickname}, ${existingByIp.telegram}). Повторное голосование с одного IP запрещено.`,
        });
      }

      const existingByTg = store.fpsVotes.find(
        (v) => v.telegram.toLowerCase() === checked.telegram.toLowerCase()
      );
      if (existingByTg) {
        return sendJson(res, 409, {
          error: `Пользователь с Telegram ${existingByTg.telegram} уже проголосовал за FPS.`,
        });
      }

      const voteRecord = {
        id: crypto.randomUUID(),
        nickname: checked.nickname,
        telegram: checked.telegram,
        ip: clientIp,
        fpsIds: uniqueFps,
        votedAt: new Date().toISOString(),
      };

      store.fpsVotes.push(voteRecord);
      saveVotes();
      broadcastUpdate('vote-fps');

      return sendJson(res, 200, {
        ok: true,
        state: buildPublicState(clientIp),
      });
    }

    if (req.method === 'POST' && pathname === '/api/admin/reset') {
      const body = await readJsonBody(req);
      if (!isAdminIdentity(body.nickname, body.telegram)) {
        return sendJson(res, 403, { error: 'Недостаточно прав для сброса результатов.' });
      }

      store.songVotes = [];
      store.fpsVotes = [];
      saveVotes();
      broadcastUpdate('reset');

      return sendJson(res, 200, {
        ok: true,
        state: buildPublicState(clientIp),
      });
    }

    if (req.method === 'POST' && pathname === '/api/admin/delete-vote') {
      const body = await readJsonBody(req);
      if (!isAdminIdentity(body.nickname, body.telegram)) {
        return sendJson(res, 403, { error: 'Недостаточно прав для удаления голоса.' });
      }

      const voteId = String(body.voteId || '').trim();
      const kind = body.kind === 'fps' ? 'fps' : 'song';
      const list = kind === 'fps' ? store.fpsVotes : store.songVotes;
      const idx = list.findIndex((v) => v.id === voteId);
      if (idx === -1) {
        return sendJson(res, 404, { error: 'Голос не найден.' });
      }

      const [removed] = list.splice(idx, 1);
      saveVotes();
      broadcastUpdate('delete-vote');

      return sendJson(res, 200, {
        ok: true,
        removed: { nickname: removed.nickname, telegram: removed.telegram },
        state: buildPublicState(clientIp),
      });
    }

    if (req.method === 'GET' && pathname.startsWith('/audio/')) {
      const trackId = decodeURIComponent(pathname.slice('/audio/'.length));
      return serveAudio(req, res, trackId);
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveStatic(req, res, pathname);
    }

    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
  } catch (err) {
    console.error('Request error:', err);
    sendJson(res, 500, { error: 'Внутренняя ошибка сервера.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`RVL MEP Song Poll running at http://localhost:${PORT} (${TRACKS.length} tracks loaded)`);
});
