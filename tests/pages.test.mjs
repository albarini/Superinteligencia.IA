import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, readdir, rm, cp, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPages, publicSnapshot} from '../scripts/build-pages.mjs';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seed = JSON.parse(await readFile(path.join(sourceRoot,'data','seed.json'),'utf8'));
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(),'gavidia-pages-'));
  // The only recursively removed path is this exact newly created temporary directory.
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('gavidia-pages-'));
    await rm(directory, {recursive:true, force:true});
  });
  await cp(path.join(sourceRoot,'dist'), path.join(directory,'dist'), {recursive:true});
  await mkdir(path.join(directory,'data','uploads'), {recursive:true});
  await writeFile(path.join(directory,'data','seed.json'), JSON.stringify(seed));
  return directory;
}
async function fileList(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory,{withFileTypes:true})) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await fileList(path.join(directory,entry.name), name + '/'));
    else result.push(name);
  }
  return result;
}

test('public snapshot removes hidden products, banners and extension fields without hiding visible products in hidden categories', () => {
  const input = structuredClone(seed);
  input.banners.forEach(banner => { banner.visible = true; });
  input.privateToken = 'root-secret';
  input.nextProductId = 91;
  input.settings.password = 'settings-secret';
  input.products[0].visible = false;
  input.products[1].visible = true;
  input.products[1].internalNotes = 'product-secret';
  input.products[1].variants = [{id:'month',label:'Mes',price:14,salePrice:null,available:true,secret:'variant-secret'}];
  input.banners[0].visible = false;
  input.banners[1].secret = 'banner-secret';
  const hiddenCategory = input.categories.find(category => category.id === input.products[1].category);
  hiddenCategory.visible = false;
  hiddenCategory.secret = 'category-secret';
  const emptyCategory = {...structuredClone(input.categories[0]),id:'fixture-empty-category',visible:false};
  input.categories.push(emptyCategory);
  const result = publicSnapshot(input);
  assert.equal(result.products.length,input.products.filter(product => product.visible !== false).length);
  assert.equal(result.products.some(product => product.id === input.products[0].id),false);
  assert.equal(result.products.some(product => product.id === input.products[1].id),true);
  assert.deepEqual(result.categories.find(category => category.id === hiddenCategory.id), {id:hiddenCategory.id,name:hiddenCategory.name,visible:false});
  assert.equal(result.categories.some(category => category.id === emptyCategory.id),false);
  assert.equal(result.banners.length,1);
  assert.doesNotMatch(JSON.stringify(result), /secret|nextProductId|internalNotes/);
  assert.equal(input.products[1].internalNotes,'product-secret');
});

test('static build works under a repository path, exports only referenced media and preserves local data', async t => {
  const directory = await fixture(t);
  const current = structuredClone(seed);
  current.revision = 27;
  current.products[0].name = 'Producto actualizado';
  current.products[0].visible = true;
  const uploadName = 'a'.repeat(36) + '.png';
  current.products[0].image = '/uploads/' + uploadName;
  current.products[0].gallery = ['/assets/dbb07b5a2d23926b.png'];
  current.products[1].visible = false;
  current.products[1].image = '/uploads/oculto.png';
  current.settings.accountUrl = '/admin';
  current.banners[0].buttonLink = '/admin/';
  const currentText = JSON.stringify(current);
  await writeFile(path.join(directory,'data','store.json'),currentText);
  await writeFile(path.join(directory,'data','store.backup.json'),'PRIVATE_BACKUP');
  const imageBytes = await readFile(path.join(directory,'dist','assets','dbb07b5a2d23926b.png'));
  await writeFile(path.join(directory,'data','uploads',uploadName),imageBytes);
  await writeFile(path.join(directory,'data','uploads','oculto.png'),imageBytes);
  await writeFile(path.join(directory,'data','uploads','sin-usar.png'),imageBytes);
  const originalApp = await readFile(path.join(directory,'dist','app.js'),'utf8');
  const result = await buildPages({projectDir:directory});
  const listed = await fileList(result.outputDir);
  assert.equal(result.products,current.products.filter(product => product.visible !== false).length);
  for (const expected of ['index.html','app.js','styles.css','store-model.js','store.json','.nojekyll','assets/placeholder.svg','uploads/' + uploadName]) assert.ok(listed.includes(expected),expected);
  assert.equal(listed.some(name => /admin|manifest|backup|seed|oculto|sin-usar/.test(name)),false);
  const app = await readFile(path.join(result.outputDir,'app.js'),'utf8');
  const html = await readFile(path.join(result.outputDir,'index.html'),'utf8');
  const snapshot = JSON.parse(await readFile(path.join(result.outputDir,'store.json'),'utf8'));
  assert.match(app,/fetch\('\.\/store\.json'/);
  assert.doesNotMatch(app + html,/\/(?:api|admin)(?:[/'"?#]|$)/);
  assert.doesNotMatch(html,/(?:src|href)=["']\/(?:assets|app\.js|styles\.css)/);
  assert.equal(snapshot.revision,27);
  assert.equal(snapshot.products[0].name,'Producto actualizado');
  assert.equal(snapshot.products[0].image,'./uploads/' + uploadName);
  assert.equal(snapshot.settings.accountUrl,'');
  const hostedBase = 'https://albarini.github.io/Superinteligencia.IA/';
  for (const relative of ['./app.js','./styles.css','./store.json',snapshot.products[0].image,...snapshot.products[0].gallery]) {
    const url = new URL(relative,hostedBase);
    assert.ok(url.pathname.startsWith('/Superinteligencia.IA/'));
    await access(path.join(result.outputDir,url.pathname.slice('/Superinteligencia.IA/'.length)));
  }
  assert.equal(await readFile(path.join(directory,'data','store.json'),'utf8'),currentText);
  assert.equal(await readFile(path.join(directory,'dist','app.js'),'utf8'),originalApp);
  await writeFile(path.join(result.outputDir,'stale.txt'),'old generated file');
  await buildPages({projectDir:directory});
  await assert.rejects(access(path.join(result.outputDir,'stale.txt')), {code:'ENOENT'});
});

test('seed fallback is supported and invalid uploads fail before replacing an existing build', async t => {
  const directory = await fixture(t);
  await buildPages({projectDir:directory});
  const generated = await readFile(path.join(directory,'docs','store.json'),'utf8');
  assert.equal(JSON.parse(generated).products.length,seed.products.filter(product => product.visible !== false).length);
  const current = structuredClone(seed);
  current.products[0].image = '/uploads/imagen.png';
  await writeFile(path.join(directory,'data','store.json'),JSON.stringify(current));
  await writeFile(path.join(directory,'data','uploads','imagen.png'),'<script>not an image</script>');
  await assert.rejects(buildPages({projectDir:directory}), /no es una imagen/);
  assert.equal(await readFile(path.join(directory,'docs','store.json'),'utf8'),generated);
  current.products[0].image = '/uploads/../store.json';
  await writeFile(path.join(directory,'data','store.json'),JSON.stringify(current));
  await assert.rejects(buildPages({projectDir:directory}), /Ruta de imagen no permitida/);
  assert.equal(await readFile(path.join(directory,'docs','store.json'),'utf8'),generated);
});
