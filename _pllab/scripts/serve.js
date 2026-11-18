// ローカル確認用の静的サーバー（リポジトリのルートを配信。GitHub Pages と同じ /pl-lab/ のパスで確認できる）
//   node scripts/serve.js [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { ROOT } from '../src/config.js';

const base = resolve(ROOT, '..');
const port = Number(process.argv[2] || process.env.PORT || 8080);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.split('/').some((seg) => seg.startsWith('_') || seg.startsWith('.'))) throw Object.assign(new Error(), { code: 'ENOENT' });
    let f = normalize(join(base, p));
    if (!f.startsWith(base)) throw Object.assign(new Error(), { code: 'ENOENT' });
    if ((await stat(f)).isDirectory()) f = join(f, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(f)] || 'application/octet-stream' });
    res.end(await readFile(f));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
}).listen(port, () => console.log(`http://localhost:${port}/pl-lab/`));
