import http from 'node:http';
import {readFile, realpath, stat, mkdir, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {StoreRepository, HttpError} from './lib/store.mjs';

const baseDir = path.dirname(fileURLToPath(import.meta.url));
const MAX_UPLOAD = 8 * 1024 * 1024;
const MAX_JSON = 4 * 1024 * 1024;
const SESSION_DURATION = 12 * 60 * 60 * 1000;
const COOKIE = 'gavidia_admin_session';
const mediaTypes = {'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif'};
const types = {...mediaTypes,'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2','.json':'application/json; charset=utf-8'};

function json(res, status, value, headers = {}) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', ...headers});
  res.end(JSON.stringify(value));
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left,right);
}
async function body(req, max) {
  if (Number(req.headers['content-length']) > max) throw new HttpError(413, 'El archivo o los datos exceden el tamaño permitido.', 'TOO_LARGE');
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > max) throw new HttpError(413, 'El archivo o los datos exceden el tamaño permitido.', 'TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(req) {
  if ((req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') throw new HttpError(415, 'Se requiere application/json.', 'CONTENT_TYPE');
  try { return JSON.parse((await body(req, MAX_JSON)).toString('utf8')); }
  catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'JSON inválido.', 'INVALID_JSON');
  }
}
function detectedType(bytes) {
  if (bytes.length >= 12 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 10 && ['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii'))) return 'image/gif';
  if (bytes.length >= 16 && bytes.subarray(0,4).toString('ascii') === 'RIFF' && bytes.subarray(8,12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}
function hostOrigin(req, server) {
  const host = req.headers.host;
  if (!host || !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host)) throw new HttpError(403, 'Host no permitido.', 'HOST');
  let url;
  try { url = new URL('http://' + host); } catch { throw new HttpError(403, 'Host no permitido.', 'HOST'); }
  if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname) || Number(url.port || 80) !== server.address()?.port) throw new HttpError(403, 'Este panel solo está disponible en la dirección local.', 'HOST');
  if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) throw new HttpError(403, 'Solo se permiten conexiones locales.', 'LOCAL_ONLY');
  return url.origin;
}
function sameOrigin(req, origin) {
  if (req.headers.origin && req.headers.origin !== origin) throw new HttpError(403, 'Origen no permitido.', 'ORIGIN');
  if (req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site'])) throw new HttpError(403, 'Origen no permitido.', 'ORIGIN');
  if (req.headers.referer) {
    try { if (new URL(req.headers.referer).origin !== origin) throw new Error(); }
    catch { throw new HttpError(403, 'Origen no permitido.', 'ORIGIN'); }
  }
}
function constrainListen(server) {
  const original = server.listen.bind(server);
  server.listen = (...args) => {
    const callback = args.find(arg => typeof arg === 'function');
    let options;
    if (args[0] && typeof args[0] === 'object') options = {...args[0]};
    else if (typeof args[0] === 'number' || /^\d+$/.test(String(args[0]))) options = {port:Number(args[0]),host:typeof args[1] === 'string' ? args[1] : '127.0.0.1'};
    else throw new Error('Use a TCP port on a loopback address.');
    options.host ||= '127.0.0.1';
    if (!['127.0.0.1','::1','localhost'].includes(options.host) || options.path || options.fd) throw new Error('The administration server must listen on a loopback address.');
    return callback ? original(options, callback) : original(options);
  };
  return server;
}

/** Create a local HTTP server without listening. Each dataDir is a separate store. */
export async function createApp({dataDir = path.join(baseDir,'data'), publicDir = path.join(baseDir,'dist'), seedPath = path.join(dataDir,'seed.json')} = {}) {
  const repository = await StoreRepository.open(dataDir, seedPath);
  const uploadsDir = path.join(path.resolve(dataDir), 'uploads');
  await mkdir(uploadsDir, {recursive:true});
  const publicRoot = await realpath(publicDir);
  const uploadRoot = await realpath(uploadsDir);
  const sessions = new Map();
  const getSession = req => {
    const cookie = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(COOKIE + '='));
    const id = cookie?.slice(COOKIE.length + 1);
    const session = sessions.get(id);
    if (!session || session.expires < Date.now()) { if (id) sessions.delete(id); throw new HttpError(401, 'Abre el panel para iniciar una sesión local.', 'SESSION'); }
    return session;
  };
  const requireMutation = (req, origin) => {
    sameOrigin(req, origin);
    if (!safeEqual(req.headers['x-csrf-token'], getSession(req).token)) throw new HttpError(403, 'Sesión de seguridad inválida. Recarga el panel.', 'CSRF');
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const origin = hostOrigin(req, server);
      let pathname;
      try { pathname = decodeURIComponent((req.url || '/').split('?')[0]); } catch { throw new HttpError(400, 'Ruta inválida.', 'PATH'); }
      if (!pathname.startsWith('/') || /[\\\u0000-\u001f]/.test(pathname) || pathname.split('/').some(part => part === '..' || part === '.')) throw new HttpError(403, 'Ruta no permitida.', 'PATH');
      if (pathname.startsWith('/api/')) {
        sameOrigin(req, origin);
        if (req.method === 'GET' && pathname === '/api/store') return json(res, 200, repository.get());
        if (req.method === 'GET' && pathname === '/api/admin/session') {
          for (const [id, session] of sessions) if (session.expires < Date.now()) sessions.delete(id);
          try {
            const existing = getSession(req);
            return json(res, 200, {csrfToken:existing.token, store:repository.get()});
          } catch {}
          if (sessions.size >= 200) sessions.delete(sessions.keys().next().value);
          const id = randomBytes(32).toString('hex');
          const token = randomBytes(32).toString('hex');
          sessions.set(id, {token, expires:Date.now() + SESSION_DURATION});
          return json(res, 200, {csrfToken:token, store:repository.get()}, {'Set-Cookie':`${COOKIE}=${id}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DURATION / 1000}`});
        }
        if (req.method === 'PUT' && pathname === '/api/admin/store') {
          requireMutation(req, origin);
          return json(res, 200, await repository.save(await jsonBody(req)));
        }
        if (req.method === 'POST' && pathname === '/api/admin/restore') {
          requireMutation(req, origin);
          const payload = await jsonBody(req);
          return json(res, 200, await repository.restore(payload?.revision));
        }
        if (req.method === 'POST' && pathname === '/api/admin/upload') {
          requireMutation(req, origin);
          const type = (req.headers['content-type'] || '').split(';')[0].trim();
          if (!Object.values(mediaTypes).includes(type)) throw new HttpError(415, 'Usa imágenes JPG, PNG, WebP o GIF.', 'IMAGE_TYPE');
          let originalName;
          try { originalName = decodeURIComponent(req.headers['x-file-name'] || 'imagen'); } catch { throw new HttpError(400,'Nombre de archivo inválido.','FILE_NAME'); }
          if (originalName.length > 255 || /[\u0000-\u001f]/.test(originalName)) throw new HttpError(400,'Nombre de archivo inválido.','FILE_NAME');
          const bytes = await body(req, MAX_UPLOAD);
          if (detectedType(bytes) !== type) throw new HttpError(415, 'El contenido no coincide con un formato de imagen permitido.', 'IMAGE_SIGNATURE');
          const extension = {'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/gif':'.gif'}[type];
          const name = randomBytes(18).toString('hex') + extension;
          await writeFile(path.join(uploadRoot, name), bytes, {flag:'wx'});
          return json(res, 201, {url:'/uploads/' + name, name, size:bytes.length, type});
        }
        if (req.method === 'GET' && pathname === '/api/admin/media') {
          getSession(req);
          const items = [];
          for (const entry of await readdir(uploadRoot, {withFileTypes:true})) {
            const type = mediaTypes[path.extname(entry.name).toLowerCase()];
            if (!entry.isFile() || !type || !/^[a-f0-9]{36}\.(jpg|png|webp|gif)$/.test(entry.name)) continue;
            const info = await stat(path.join(uploadRoot, entry.name));
            items.push({url:'/uploads/' + entry.name, name:entry.name, size:info.size, type});
          }
          return json(res, 200, {items:items.reverse()});
        }
        if (req.method === 'GET' && pathname === '/api/admin/export') {
          getSession(req);
          return json(res, 200, repository.get(), {'Content-Disposition':'attachment; filename="catalogo-gavidia.json"'});
        }
        throw new HttpError(404, 'Endpoint no encontrado.', 'NOT_FOUND');
      }
      if (!['GET','HEAD'].includes(req.method)) throw new HttpError(405, 'Método no permitido.', 'METHOD');
      const uploaded = pathname.startsWith('/uploads/');
      const root = uploaded ? uploadRoot : publicRoot;
      let relative = uploaded ? pathname.slice('/uploads/'.length) : pathname.slice(1);
      if (uploaded && !/^[a-f0-9]{36}\.(jpg|png|webp|gif)$/.test(relative)) throw new HttpError(404,'Archivo no encontrado.','NOT_FOUND');
      if (!relative) relative = 'index.html';
      if (relative === 'admin' || relative === 'admin/') relative = 'admin.html';
      if (relative.split('/').some(part => part.startsWith('.'))) throw new HttpError(403,'Ruta no permitida.','PATH');
      const file = await realpath(path.resolve(root, relative));
      if (!file.startsWith(root + path.sep)) throw new HttpError(403,'Ruta no permitida.','PATH');
      const bytes = await readFile(file);
      res.writeHead(200, {'Content-Type':types[path.extname(file).toLowerCase()] || 'application/octet-stream','Content-Length':bytes.length});
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (res.headersSent) return res.end();
      if (error instanceof HttpError) return json(res, error.status, {error:error.message, code:error.code});
      if (['ENOENT','EISDIR','ENOTDIR'].includes(error.code)) return json(res, 404, {error:'Archivo no encontrado.',code:'NOT_FOUND'});
      console.error('Local store request failed:', error.message);
      json(res, 500, {error:'No se pudo completar la operación. Revisa el espacio disponible y vuelve a intentar.',code:'SERVER_ERROR'});
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return constrainListen(server);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || '127.0.0.1';
  const server = await createApp();
  server.listen(port, host, () => console.log(`Gavidia local: http://${host}:${port}`));
}
