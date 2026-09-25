import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Requires a built Windows Player; captures both speakers for visual review.
const executable = resolve('unity/KataruneAvatar/Builds/Windows/KataruneAvatar.exe');
const output = resolve('.test-dist/user-subtitles-player');
assert.ok(existsSync(executable), 'Build the Unity Windows Player first');
mkdirSync(output, { recursive: true });
for (const speaker of ['user', 'role']) {
  const pipe = `katarune-subtitles-${randomUUID()}`;
  const capture = resolve(output, `${speaker}-${Date.now()}.png`);
  let socket;
  let child;
  let ready;
  const connected = new Promise((resolve) => { ready = resolve; });
  const server = createServer((connection) => {
    socket = connection;
    connection.setEncoding('utf8');
    let buffer = '';
    connection.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const message = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (message.type === 'ready') ready();
      }
    });
  });
  const deadline = Date.now() + 45000;
  const send = (message) => socket.write(JSON.stringify(message) + '\n');
  let timer;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(`\\\\.\\pipe\\${pipe}`, resolve);
    });
    child = spawn(executable, [
      '-screen-fullscreen', '1', '-window-mode', 'borderless',
      '-logFile', resolve(output, `${speaker}.log`),
      '--screenshot', capture, '--capture-delay', '3', '--exit-on-error',
    ], { cwd: dirname(executable), windowsHide: false, stdio: 'ignore',
      env: { ...process.env, KATARUNE_AVATAR_PIPE: pipe } });
    await Promise.race([connected, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Player did not become ready')), 30000);
    })]);
    clearTimeout(timer);
    send({ type: 'user-subtitle', text: '今天想和你聊聊天。' });
    if (speaker === 'role') {
      await delay(2200);
      const runId = randomUUID();
      for (const event of [
        { type: 'text-start', id: 'reply' },
        { type: 'text-delta', id: 'reply', delta: '我听到了，今天想聊些什么？' },
        { type: 'text-end', id: 'reply' },
      ]) send({ type: 'event', runId, speechEnabled: false, event });
    }
    while ((!existsSync(capture) || statSync(capture).size < 1000) && Date.now() < deadline)
      await delay(200);
    assert.ok(existsSync(capture) && statSync(capture).size > 1000, 'Missing Player screenshot');
    console.log(`${speaker}: ${capture}`);
  } finally {
    clearTimeout(timer);
    socket?.destroy();
    server.close();
    child?.kill();
    await delay(500);
  }
}
