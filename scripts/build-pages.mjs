import {readFile, writeFile, mkdir, realpath, lstat, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fields = {
  product: ['id','name','price','max','image','category','sub','available','categories','subs','visible','featured','salePrice','offerLabel','gallery','description','content','order','homeOrder'],
  category: ['id','name','image','subs','homeSubs','visible','order'],
  banner: ['id','title','description','image','buttonText','buttonLink','visible','order'],
  variant: ['id','label','price','salePrice','available'],
  settings: ['name','logo','favicon','currency','accentColor','backgroundColor','headerColor','footerColor','pageTitle','metaDescription','categoryTitle','featuredTitle','aboutTitle','aboutHeading','aboutText','footerText','copyright','contactTitle','contactText','phone','phoneSecondary','whatsapp','whatsappSecondary','instagram','tiktok','whatsappCommunity','telegramCommunity','distributorUrl','accountUrl','paymentImage','showCategories','showFeatured','showAbout']
};
const pick = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, structuredClone(value[key])]));
const publicLink = value => /^\/(?:admin|api)(?:[/?#]|$)/i.test(value) ? '' : value.replace(/^\/(?!\/)/, './');

/** Keep only fields that the public storefront actually uses. */
export function publicSnapshot(store) {
  if (store?.schemaVersion !== 1 || !Array.isArray(store.products) || !Array.isArray(store.categories) || !Array.isArray(store.banners) || !store.settings) {
    throw new Error('El catálogo no tiene un formato compatible.');
  }
  const products = store.products.filter(product => product.visible !== false).map(product => ({
    ...pick(product, fields.product),
    variants: (product.variants || []).map(variant => pick(variant, fields.variant))
  }));
  const assignedCategories = new Set(products.flatMap(product => product.categories));
  const categories = store.categories.flatMap(category => category.visible !== false
    ? [pick(category, fields.category)]
    : assignedCategories.has(category.id) ? [{id:category.id, name:category.name, visible:false}] : []);
  const banners = store.banners.filter(banner => banner.visible !== false).map(banner => ({
    ...pick(banner, fields.banner), buttonLink:publicLink(banner.buttonLink || '')
  }));
  const settings = pick(store.settings, fields.settings);
  for (const key of ['whatsapp','whatsappSecondary','instagram','tiktok','whatsappCommunity','telegramCommunity','distributorUrl','accountUrl']) {
    if (typeof settings[key] === 'string') settings[key] = publicLink(settings[key]);
  }
  return {schemaVersion:1, revision:store.revision, updatedAt:store.updatedAt, products, categories, banners, settings};
}

function normalizeImage(value) {
  if (!value) return '';
  if (typeof value !== 'string' || /[\\\u0000-\u0020]/.test(value)) throw new Error('Ruta de imagen no válida.');
  if (/^https:\/\//i.test(value)) {
    const url = new URL(value);
    if (url.username || url.password) throw new Error('No se permiten credenciales en una imagen.');
    return value;
  }
  const relative = value.replace(/^\//, '').replace(/^\.\//, '');
  if (!/^(assets|uploads)\/[a-zA-Z0-9_./-]+\.(png|jpe?g|webp|gif|svg|ico)$/i.test(relative) || relative.split('/').some(part => ['.','..'].includes(part))) {
    throw new Error(`Ruta de imagen no permitida: ${value}`);
  }
  return './' + relative;
}

function imageIsValid(bytes, extension, uploaded) {
  if (extension === '.png') return bytes.length >= 12 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (['.jpg','.jpeg'].includes(extension)) return bytes.length >= 4 && bytes.subarray(0,3).equals(Buffer.from([255,216,255]));
  if (extension === '.gif') return bytes.length >= 10 && ['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii'));
  if (extension === '.webp') return bytes.length >= 16 && bytes.subarray(0,4).toString('ascii') === 'RIFF' && bytes.subarray(8,12).toString('ascii') === 'WEBP';
  if (uploaded) return false;
  if (extension === '.ico') return bytes.length >= 6 && bytes.subarray(0,4).equals(Buffer.from([0,0,1,0]));
  if (extension === '.woff2') return bytes.length >= 48 && bytes.subarray(0,4).toString('ascii') === 'wOF2';
  if (extension === '.svg') {
    const svg = bytes.toString('utf8');
    return /<svg[\s>]/i.test(svg) && /<\/svg>\s*$/i.test(svg)
      && !/<(?:script|foreignObject|iframe|object|embed)\b|<!ENTITY|<!DOCTYPE|\bon\w+\s*=|(?:href|src)\s*=\s*["']\s*(?!#)|url\(\s*["']?(?!#)/i.test(svg);
  }
  return false;
}

async function readWithin(root, relative) {
  const resolvedRoot = await realpath(root);
  const file = await realpath(path.resolve(resolvedRoot, relative));
  if (!file.startsWith(resolvedRoot + path.sep)) throw new Error(`Archivo fuera del directorio permitido: ${relative}`);
  return readFile(file);
}

function replaceRequired(source, oldText, newText, label) {
  if (!source.includes(oldText)) throw new Error(`Actualiza el exportador: no se encontró ${label}.`);
  return source.replace(oldText, newText);
}

/** Generate only project/docs; the local application and its data are never edited. */
export async function buildPages({projectDir = projectRoot} = {}) {
  const root = await realpath(path.resolve(projectDir));
  const publicDir = path.join(root, 'dist');
  const outputDir = path.resolve(root, 'docs');
  let storeText;
  try { storeText = await readWithin(path.join(root,'data'), 'store.json'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    storeText = await readWithin(path.join(root,'data'), 'seed.json');
  }
  const snapshot = publicSnapshot(JSON.parse(storeText));
  const files = new Map();
  const imagePaths = new Set(['assets/placeholder.svg']);
  const collectImage = value => {
    const normalized = normalizeImage(value);
    if (normalized.startsWith('./')) imagePaths.add(normalized.slice(2));
    return normalized;
  };
  for (const entity of [...snapshot.products,...snapshot.categories,...snapshot.banners]) {
    if ('image' in entity) entity.image = collectImage(entity.image);
    if (entity.gallery) entity.gallery = entity.gallery.map(collectImage);
  }
  for (const key of ['logo','favicon','paymentImage']) {
    if (key in snapshot.settings) snapshot.settings[key] = collectImage(snapshot.settings[key]);
  }

  let html = (await readWithin(publicDir, 'index.html')).toString('utf8');
  html = html.replace(/((?:href|src)=["'])\/(assets\/|styles\.css|app\.js)/g, '$1./$2');
  let app = (await readWithin(publicDir, 'app.js')).toString('utf8');
  app = replaceRequired(app, "fetch('/api/store',", "fetch('./store.json',", 'la petición de catálogo');
  const oldImageURL = "const imageURL = value => value?.startsWith('assets/') ? '/' + value : value || '/assets/placeholder.svg';";
  const newImageURL = String.raw`const imageURL = value => value ? value.replace(/^\/(assets|uploads)\//, './$1/') : './assets/placeholder.svg';`;
  app = replaceRequired(app, oldImageURL, newImageURL, 'el normalizador de imágenes');
  app = app.replace(/<a\b[^>]*href=["']\/admin\/?["'][^>]*>[\s\S]*?<\/a>/g, '');
  app = app.replace('Comprueba que el servidor local está iniciado y vuelve a intentarlo.', 'Comprueba tu conexión y vuelve a intentarlo.');
  if (/\/(?:api|admin)(?:[/'"?#]|$)/.test(app + html)) throw new Error('La página exportada todavía contiene una ruta de servidor.');
  let css = (await readWithin(publicDir, 'styles.css')).toString('utf8');
  css = css.replace(/url\(\s*(["']?)\/(assets\/[^)"']+)\1\s*\)/g, 'url($1./$2$1)');
  for (const source of [html,css,app]) {
    for (const match of source.matchAll(/(?:\.\/)?(assets\/[a-zA-Z0-9_./-]+\.(?:png|jpe?g|webp|gif|svg|ico|woff2))/gi)) imagePaths.add(match[1]);
  }
  files.set('index.html', html);
  files.set('app.js', app);
  files.set('styles.css', css);
  files.set('store-model.js', await readWithin(publicDir, 'store-model.js'));
  files.set('store.json', JSON.stringify(snapshot,null,2) + '\n');
  files.set('.nojekyll', '');
  for (const relative of [...imagePaths].sort()) {
    if (relative.split('/').some(part => ['.','..'].includes(part))) throw new Error('Ruta de recurso no permitida.');
    const uploaded = relative.startsWith('uploads/');
    const sourceRoot = uploaded ? path.join(root,'data','uploads') : path.join(publicDir,'assets');
    const bytes = await readWithin(sourceRoot, relative.slice(relative.indexOf('/') + 1));
    if (!imageIsValid(bytes, path.extname(relative).toLowerCase(), uploaded)) throw new Error(`El recurso no es una imagen o fuente permitida: ${relative}`);
    files.set(relative, bytes);
  }

  // Check the exact output target before replacing this generated directory.
  if (outputDir !== path.join(root,'docs') || path.dirname(outputDir) !== root) throw new Error('Directorio de salida no permitido.');
  try {
    const info = await lstat(outputDir);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(outputDir) !== outputDir) throw new Error('docs debe ser un directorio real dentro del proyecto.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await rm(outputDir, {recursive:true, force:true});
  await mkdir(outputDir, {recursive:true});
  for (const [relative, bytes] of files) {
    const target = path.join(outputDir, relative);
    if (!target.startsWith(outputDir + path.sep)) throw new Error('Archivo de salida no permitido.');
    await mkdir(path.dirname(target), {recursive:true});
    await writeFile(target, bytes);
  }
  return {outputDir, products:snapshot.products.length, files:files.size};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await buildPages();
  console.log(`GitHub Pages: ${result.outputDir} (${result.products} productos, ${result.files} archivos)`);
}
