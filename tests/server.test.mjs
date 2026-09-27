import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createApp} from '../server.mjs';

const seed = {
  schemaVersion:1,revision:1,updatedAt:'2026-09-26T00:00:00.000Z',
  products:[{id:1,name:'Servicio de prueba',price:10,max:20,salePrice:null,offerLabel:'',available:true,visible:true,featured:true,image:'assets/test.png',gallery:[],description:'Descripción',content:'Contenido',category:'streaming',categories:['streaming'],sub:'Video',subs:['Video'],order:0,homeOrder:0,variants:[]}],
  categories:[{id:'streaming',name:'Streaming',image:'assets/test.png',subs:['Video'],homeSubs:['Video'],visible:true,order:0}],
  banners:[{id:'home',title:'Bienvenidos',description:'Catálogo',image:'assets/test.png',buttonText:'Ver',buttonLink:'#tienda',visible:true,order:0}],
  settings:{name:'Tienda de prueba',currency:'USD',accentColor:'#f7006a',showAbout:true}
};
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=','base64');
async function fixture(t, initialSeed = seed) {
  const tmpParent = path.resolve(os.tmpdir());
  const root = await mkdtemp(path.join(tmpParent,'gavidia-api-test-'));
  const dataDir = path.join(root,'data');
  const publicDir = path.join(root,'public');
  const seedPath = path.join(root,'seed.json');
  await mkdir(publicDir);
  await writeFile(path.join(publicDir,'index.html'),'<h1>Store</h1>');
  await writeFile(path.join(publicDir,'admin.html'),'<h1>Admin</h1>');
  await writeFile(seedPath,JSON.stringify(initialSeed));
  const servers = [];
  const start = async () => {
    const server = await createApp({dataDir,publicDir,seedPath});
    servers.push(server);
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    return {server,url:`http://127.0.0.1:${server.address().port}`};
  };
  t.after(async () => {
    await Promise.all(servers.map(server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); })));
    assert.ok(root.startsWith(tmpParent + path.sep) && path.basename(root).startsWith('gavidia-api-test-'));
    await rm(root,{recursive:true,force:true});
  });
  const running = await start();
  return {...running,root,dataDir,publicDir,seedPath,start};
}
async function session(url) {
  const response = await fetch(url + '/api/admin/session');
  assert.equal(response.status,200);
  const cookieHeader = response.headers.get('set-cookie');
  assert.match(cookieHeader,/HttpOnly/);
  assert.match(cookieHeader,/SameSite=Strict/);
  const payload = await response.json();
  return {...payload,headers:{Cookie:cookieHeader.split(';')[0],'X-CSRF-Token':payload.csrfToken,'Content-Type':'application/json',Origin:url}};
}
const save = (url,auth,store) => fetch(url + '/api/admin/store',{method:'PUT',headers:auth.headers,body:JSON.stringify(store)});
function rawRequest(url,pathname,headers = {}) {
  const target = new URL(url);
  return new Promise((resolve,reject) => {
    const req = http.request({hostname:target.hostname,port:target.port,path:pathname,headers},res => {
      const chunks = [];
      res.on('data',chunk => chunks.push(chunk));
      res.on('end',() => resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()}));
    });
    req.on('error',reject);req.end();
  });
}

test('seeds once, persists edits and extensions, restores previous version and survives restart',async t => {
  const f = await fixture(t);
  const auth = await session(f.url);
  assert.deepEqual(auth.store,seed);
  const edited = structuredClone(auth.store);
  edited.products[0].name = 'Nombre guardado';
  edited.products[0].salePrice = 7;
  edited.products[0].extension = {note:'Dato adicional'};
  const response = await save(f.url,auth,edited);
  assert.equal(response.status,200);
  const saved = await response.json();
  assert.equal(saved.revision,2);
  assert.equal(saved.products[0].extension.note,'Dato adicional');
  assert.deepEqual(JSON.parse(await readFile(path.join(f.dataDir,'store.json'),'utf8')),saved);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.dataDir,'store.backup.json'),'utf8')),seed);
  const restarted = await f.start();
  assert.deepEqual(await (await fetch(restarted.url + '/api/store')).json(),saved);
  const restored = await fetch(f.url + '/api/admin/restore',{method:'POST',headers:auth.headers,body:JSON.stringify({revision:2})});
  assert.equal(restored.status,200);
  const restoredStore = await restored.json();
  assert.equal(restoredStore.revision,3);
  assert.equal(restoredStore.products[0].name,seed.products[0].name);
  assert.equal(JSON.parse(await readFile(path.join(f.dataDir,'store.backup.json'),'utf8')).products[0].name,'Nombre guardado');
  const exported = await fetch(f.url + '/api/admin/export',{headers:auth.headers});
  assert.match(exported.headers.get('content-disposition'),/attachment/);
  assert.deepEqual(await exported.json(),restoredStore);
});

test('simultaneous stale saves cannot overwrite each other',async t => {
  const {url} = await fixture(t);
  const auth = await session(url);
  const a = structuredClone(auth.store), b = structuredClone(auth.store);
  a.settings.name = 'A';b.settings.name = 'B';
  const responses = await Promise.all([save(url,auth,a),save(url,auth,b)]);
  assert.deepEqual(responses.map(response => response.status).sort(),[200,409]);
  assert.equal((await (await fetch(url + '/api/store')).json()).revision,2);
  const conflict = await save(url,auth,a);
  assert.equal(conflict.status,409);
  assert.equal((await conflict.json()).code,'CONFLICT');
});

test('validation rejects invalid references, prices, HTML, IDs and dangerous URLs without changing storage',async t => {
  const {url,dataDir} = await fixture(t);
  const auth = await session(url);
  const changes = [
    store => {store.products[0].price = -1;},
    store => {store.products[0].max = 1;},
    store => {store.products[0].salePrice = 10;},
    store => {store.products[0].categories = ['missing'];},
    store => {store.products[0].subs.push('missing');},
    store => {store.categories[0].homeSubs = ['missing'];},
    store => {store.products.push(structuredClone(store.products[0]));},
    store => {store.products[0].id = '1';},
    store => {store.products[0].name = '<img src=x onerror=alert(1)>';},
    store => {store.products[0].image = 'javascript:alert(1)';},
    store => {store.products[0].image = '/uploads/../store.json';},
    store => {store.banners[0].buttonLink = 'data:text/html,test';},
    store => {store.settings.whatsapp = 'javascript:alert(1)';},
    store => {store.settings.whatsappSecondary = 'data:text/html,test';},
    store => {store.settings.accentColor = 'red;display:none';},
    store => {store.products[0].variants = [{id:'same',label:'Mes',price:2,salePrice:null,available:true},{id:'same',label:'Año',price:3,salePrice:null,available:true}];},
    store => {store.products[0].gallery = Array(31).fill('assets/test.png');},
    store => {store.settings.showAbout = 'true';},
    store => {store.extra = JSON.parse('{"__proto__":{"polluted":true}}');}
  ];
  for (const change of changes) {
    const candidate = structuredClone(auth.store);change(candidate);
    const response = await save(url,auth,candidate);
    assert.equal(response.status,400,change.toString());
    assert.equal((await response.json()).code,'VALIDATION');
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(dataDir,'store.json'),'utf8')),seed);
});

test('mutations require session, matching CSRF and same origin; host and remote binding are restricted',async t => {
  const {url,server} = await fixture(t);
  const auth = await session(url);
  const payload = JSON.stringify(auth.store);
  for (const [headers,status] of [
    [{'Content-Type':'application/json'},401],
    [{...auth.headers,'X-CSRF-Token':'wrong'},403],
    [{...auth.headers,Origin:'https://attacker.example'},403],
    [{...auth.headers,'Sec-Fetch-Site':'cross-site'},403],
    [{...auth.headers,Referer:'https://attacker.example/'},403]
  ]) assert.equal((await fetch(url + '/api/admin/store',{method:'PUT',headers,body:payload})).status,status);
  assert.equal((await fetch(url + '/api/admin/media')).status,401);
  assert.equal((await fetch(url + '/api/admin/export')).status,401);
  assert.equal((await rawRequest(url,'/api/store',{Host:'attacker.example'})).status,403);
  assert.throws(() => server.listen(0,'0.0.0.0'),/loopback/);
  const reused = await (await fetch(url + '/api/admin/session',{headers:{Cookie:auth.headers.Cookie}})).json();
  assert.equal(reused.csrfToken,auth.csrfToken,'second admin tab should reuse the existing session');
});

test('image upload verifies signatures, enforces size, uses random names and serves/list media',async t => {
  const {url} = await fixture(t);
  const auth = await session(url);
  const headers = {...auth.headers,'Content-Type':'image/png','X-File-Name':encodeURIComponent('../../Logo bonito.png')};
  const response = await fetch(url + '/api/admin/upload',{method:'POST',headers,body:png});
  assert.equal(response.status,201);
  const upload = await response.json();
  assert.match(upload.url,/^\/uploads\/[a-f0-9]{36}\.png$/);
  assert.equal(upload.size,png.length);
  const downloaded = await fetch(url + upload.url);
  assert.equal(downloaded.headers.get('content-type'),'image/png');
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),png);
  const media = await (await fetch(url + '/api/admin/media',{headers:auth.headers})).json();
  assert.deepEqual(media.items,[upload]);
  assert.equal((await fetch(url + '/api/admin/upload',{method:'POST',headers,body:'<svg onload="alert(1)"></svg>'})).status,415);
  assert.equal((await fetch(url + '/api/admin/upload',{method:'POST',headers:{...headers,'Content-Type':'image/jpeg'},body:png})).status,415);
  assert.equal((await fetch(url + '/api/admin/upload',{method:'POST',headers,body:Buffer.alloc(8*1024*1024+1)})).status,413);
});

test('static serving maps admin and blocks traversal and data exposure',async t => {
  const {url} = await fixture(t);
  for (const pathname of ['/admin','/admin.html','/admin/']) assert.equal(await (await fetch(url + pathname)).text(),'<h1>Admin</h1>');
  for (const pathname of ['/../seed.json','/%2e%2e/seed.json','/uploads/%2e%2e/store.json','/assets%5c..%5c..%5cseed.json','/.env']) {
    assert.equal((await rawRequest(url,pathname)).status,403,pathname);
  }
  assert.equal((await fetch(url + '/data/store.json')).status,404);
  assert.equal((await fetch(url + '/uploads/store.json')).status,404);
  const root = await fetch(url);
  assert.equal(root.headers.get('x-content-type-options'),'nosniff');
  assert.equal(root.headers.get('x-frame-options'),'DENY');
});

test('a corrupt persisted store is reported without silently replacing user data with the seed',async t => {
  const f = await fixture(t);
  const corrupted = '{invalid saved content';
  await writeFile(path.join(f.dataDir,'store.json'),corrupted);
  await assert.rejects(createApp({dataDir:f.dataDir,publicDir:f.publicDir,seedPath:f.seedPath}),/existing file has not been changed/);
  assert.equal(await readFile(path.join(f.dataDir,'store.json'),'utf8'),corrupted);
});

test('product IDs are not recycled after deleting or restoring newer products',async t=>{
  const {url}=await fixture(t), auth=await session(url);
  const added=structuredClone(auth.store);
  added.products.push({...structuredClone(added.products[0]),id:99});
  let saved=await (await save(url,auth,added)).json();
  assert.equal(saved.nextProductId,100);
  saved.products=saved.products.filter(p=>p.id!==99);
  saved=await (await save(url,auth,saved)).json();
  assert.equal(saved.nextProductId,100);
  const restored=await (await fetch(url+'/api/admin/restore',{method:'POST',headers:auth.headers,body:JSON.stringify({revision:saved.revision})})).json();
  assert.equal(restored.nextProductId,100);
});

test('fractional cents are rejected without changing the current store or its backup',async t => {
  const {url,dataDir} = await fixture(t), auth = await session(url);
  const current = await (await save(url,auth,auth.store)).json();
  const originalFile = await readFile(path.join(dataDir,'store.json'),'utf8');
  const originalBackup = await readFile(path.join(dataDir,'store.backup.json'),'utf8');
  const changes = [
    product => {product.price = 1.005;},
    product => {product.salePrice = 1.335;},
    product => {product.max = 20.001;},
    product => {product.variants = [{id:'m',label:'Mes',price:1.005,salePrice:null,available:true}];},
    product => {product.variants = [{id:'m',label:'Mes',price:10,salePrice:1.335,available:true}];}
  ];
  for (const change of changes) {
    const candidate = structuredClone(current);change(candidate.products[0]);
    const response = await save(url,auth,candidate);
    assert.equal(response.status,400,change.toString());
    assert.match((await response.json()).error,/dos decimales/);
    assert.equal(await readFile(path.join(dataDir,'store.json'),'utf8'),originalFile);
    assert.equal(await readFile(path.join(dataDir,'store.backup.json'),'utf8'),originalBackup);
  }
  assert.deepEqual(await (await fetch(url + '/api/store')).json(),current);
  const valid = structuredClone(current);
  Object.assign(valid.products[0],{price:19.99,max:29.99,salePrice:0.1 + 0.2,variants:[{id:'m',label:'Mes',price:999999999.99,salePrice:999999999.98,available:true}]});
  assert.equal((await save(url,auth,valid)).status,200,'valid cents and harmless floating point tails remain accepted');
});

test('overflowing product IDs or revisions cannot persist an unreadable snapshot',async t => {
  for (const counter of ['product ID','revision']) await t.test(counter,async t => {
    const initial = structuredClone(seed);
    if (counter === 'revision') initial.revision = Number.MAX_SAFE_INTEGER - 1;
    const f = await fixture(t,initial), auth = await session(f.url);
    const current = await (await save(f.url,auth,auth.store)).json();
    const originalFile = await readFile(path.join(f.dataDir,'store.json'),'utf8');
    const originalBackup = await readFile(path.join(f.dataDir,'store.backup.json'),'utf8');
    const candidate = structuredClone(current);
    if (counter === 'product ID') candidate.products[0].id = Number.MAX_SAFE_INTEGER;
    const response = await save(f.url,auth,candidate);
    assert.equal(response.status,400);
    assert.equal((await response.json()).code,'VALIDATION');
    assert.equal(await readFile(path.join(f.dataDir,'store.json'),'utf8'),originalFile);
    assert.equal(await readFile(path.join(f.dataDir,'store.backup.json'),'utf8'),originalBackup);
    assert.deepEqual(await (await fetch(f.url + '/api/store')).json(),current);
    const restarted = await f.start();
    assert.deepEqual(await (await fetch(restarted.url + '/api/store')).json(),current);
  });
});
