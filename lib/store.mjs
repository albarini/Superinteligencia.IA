import {mkdir, readFile, writeFile, rename, rm} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, code = 'VALIDATION') { super(message); this.status = status; this.code = code; }
}
const invalid = message => { throw new HttpError(400, message, 'VALIDATION'); };
const object = (value, label) => { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label}: debe ser un objeto.`); };
function text(value, label, max = 500, allowEmpty = true) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || /<\/?[a-z!][^>]*>/i.test(value)) invalid(`${label}: texto inválido (máximo ${max} caracteres, sin HTML).`);
}
function number(value, label, max = 1e9) { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) invalid(`${label}: número inválido.`); }
function money(value, label) {
  number(value,label);
  const cents = value * 100;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(cents)) * 4;
  if (Math.abs(cents - Math.round(cents)) > tolerance) invalid(`${label}: usa como máximo dos decimales.`);
}
function boolean(value, label) { if (typeof value !== 'boolean') invalid(`${label}: debe ser verdadero o falso.`); }
function list(value, label, max) { if (!Array.isArray(value) || value.length > max) invalid(`${label}: lista inválida (máximo ${max}).`); }
function strings(value, label, max = 100) {
  list(value, label, max);
  value.forEach(item => text(item,label,150,false));
  if (new Set(value).size !== value.length) invalid(`${label}: valores duplicados.`);
}
function identifier(value, label) { if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value)) invalid(`${label}: identificador inválido.`); }
function unique(values, label) { if (new Set(values).size !== values.length) invalid(`${label}: identificadores duplicados.`); }
function image(value, label, allowEmpty = true) {
  text(value,label,2048,allowEmpty);
  if (!value && allowEmpty) return;
  if (/[\\\u0000-\u0020]/.test(value)) invalid(`${label}: la URL de imagen contiene caracteres inválidos.`);
  if (/^https:\/\//i.test(value)) {
    try { const url = new URL(value); if (url.protocol === 'https:' && url.hostname && !url.username && !url.password) return; } catch {}
  }
  if (/^\/?(?:assets|uploads)\/[a-zA-Z0-9_./-]+$/.test(value) && !value.split('/').some(part => ['.','..'].includes(part)) && /\.(?:png|jpe?g|webp|gif|svg|ico)$/i.test(value)) return;
  invalid(`${label}: usa una imagen HTTPS o una imagen de assets/uploads.`);
}
function link(value, label) {
  text(value,label,2048);
  if (!value) return;
  if (/[\\\u0000-\u0020]/.test(value)) invalid(`${label}: el enlace contiene caracteres inválidos.`);
  if (/^[#?]/.test(value) || /^\/(?!\/)/.test(value)) { if (!/[\\\r\n]/.test(value)) return; }
  try {
    const url = new URL(value);
    if (['https:','mailto:','tel:'].includes(url.protocol) && !url.username && !url.password) return;
  } catch {}
  invalid(`${label}: enlace inválido (HTTPS o ruta local).`);
}
function sale(item, label) {
  money(item.price, `${label}.price`);
  if (item.salePrice !== null) {
    money(item.salePrice, `${label}.salePrice`);
    if (item.salePrice >= item.price) invalid(`${label}: el precio de oferta debe ser menor al precio normal.`);
  }
}
function safeJSON(value, depth = 0, counter = {count:0}) {
  if (++counter.count > 100_000 || depth > 15) invalid('Los datos son demasiado complejos.');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) invalid('Número inválido.'); return; }
  if (typeof value === 'string') { if (value.length > 50_000) invalid('Texto demasiado largo.'); return; }
  if (typeof value !== 'object') invalid('Los datos deben ser JSON.');
  for (const [key,item] of Object.entries(value)) {
    if (['__proto__','constructor','prototype'].includes(key) || key.length > 200) invalid('Propiedad no permitida.');
    safeJSON(item, depth + 1, counter);
  }
}

/** Validate known fields while retaining bounded, inert JSON extension fields. */
export function validateStore(input) {
  object(input,'Catálogo');
  safeJSON(input);
  if (input.schemaVersion !== 1) invalid('Versión de catálogo no compatible.');
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) invalid('Revisión inválida.');
  if ('nextProductId' in input && (!Number.isSafeInteger(input.nextProductId) || input.nextProductId < 1)) invalid('Siguiente identificador de producto inválido.');
  if (typeof input.updatedAt !== 'string' || !Number.isFinite(Date.parse(input.updatedAt))) invalid('Fecha de actualización inválida.');
  list(input.products,'Productos',2000);
  list(input.categories,'Categorías',100);
  list(input.banners,'Banners',30);
  object(input.settings,'Configuración');
  for (const category of input.categories) {
    object(category,'Categoría');
    identifier(category.id,'Categoría.id');
    text(category.name,'Categoría.nombre',150,false);
    image(category.image,'Categoría.imagen');
    strings(category.subs,'Categoría.subcategorías');
    strings(category.homeSubs,'Categoría.subcategorías destacadas');
    if (category.homeSubs.some(sub => !category.subs.includes(sub))) invalid('Una subcategoría destacada no existe en la categoría.');
    boolean(category.visible,'Categoría.visible');
    number(category.order,'Categoría.orden',1e6);
  }
  unique(input.categories.map(category => category.id),'Categorías');
  const categories = new Map(input.categories.map(category => [category.id,category]));
  for (const product of input.products) {
    object(product,'Producto');
    if (!Number.isSafeInteger(product.id) || product.id < 1) invalid('Producto.id: debe ser un entero positivo.');
    text(product.name,'Producto.nombre',300,false);
    sale(product,'Producto');
    money(product.max,'Producto.precio máximo');
    if (product.max && product.max < product.price) invalid('El precio máximo debe ser cero o mayor o igual al precio normal.');
    text(product.offerLabel,'Producto.etiqueta de oferta',100);
    for (const field of ['available','visible','featured']) boolean(product[field],`Producto.${field}`);
    image(product.image,'Producto.imagen');
    list(product.gallery,'Producto.galería',30);
    product.gallery.forEach(value => image(value,'Producto.galería',false));
    text(product.description,'Producto.descripción',10_000);
    text(product.content,'Producto.contenido',30_000);
    identifier(product.category,'Producto.categoría');
    strings(product.categories,'Producto.categorías');
    if (!product.categories.includes(product.category) || product.categories.some(id => !categories.has(id))) invalid('El producto hace referencia a una categoría inexistente o falta su categoría principal.');
    text(product.sub,'Producto.subcategoría',150);
    strings(product.subs,'Producto.subcategorías');
    const allowedSubs = new Set(product.categories.flatMap(id => categories.get(id).subs));
    if ((product.sub && (!product.subs.includes(product.sub) || !categories.get(product.category).subs.includes(product.sub))) || product.subs.some(sub => !allowedSubs.has(sub))) invalid('El producto hace referencia a una subcategoría inexistente.');
    number(product.order,'Producto.orden',1e6);
    if ('homeOrder' in product) number(product.homeOrder,'Producto.orden de portada',1e6);
    list(product.variants,'Producto.variantes',100);
    for (const variant of product.variants) {
      object(variant,'Variante');
      identifier(variant.id,'Variante.id');
      text(variant.label,'Variante.nombre',200,false);
      sale(variant,'Variante');
      boolean(variant.available,'Variante.disponible');
    }
    unique(product.variants.map(variant => variant.id),'Variantes');
  }
  unique(input.products.map(product => product.id),'Productos');
  for (const banner of input.banners) {
    object(banner,'Banner');
    identifier(banner.id,'Banner.id');
    text(banner.title,'Banner.título',300);
    text(banner.description,'Banner.descripción',1000);
    image(banner.image,'Banner.imagen');
    text(banner.buttonText,'Banner.botón',100);
    link(banner.buttonLink,'Banner.enlace');
    boolean(banner.visible,'Banner.visible');
    number(banner.order,'Banner.orden',1e6);
  }
  unique(input.banners.map(banner => banner.id),'Banners');
  const settings = input.settings;
  text(settings.name,'Nombre de tienda',200,false);
  if (!['USD','PEN','EUR'].includes(settings.currency)) invalid('Moneda inválida.');
  for (const key of ['logo','favicon','paymentImage']) if (key in settings) image(settings[key],`Configuración.${key}`);
  for (const key of ['accentColor','backgroundColor','headerColor','footerColor']) if (key in settings && !/^#[a-fA-F0-9]{6}$/.test(settings[key])) invalid(`${key}: usa un color hexadecimal de seis dígitos.`);
  for (const key of ['pageTitle','metaDescription','categoryTitle','featuredTitle','aboutTitle','aboutHeading','aboutText','footerText','copyright','contactTitle','contactText','phone','phoneSecondary','whatsapp','whatsappSecondary']) if (key in settings) text(settings[key],`Configuración.${key}`,key.endsWith('Text') ? 10_000 : 1000);
  for (const key of ['whatsapp','whatsappSecondary','instagram','tiktok','whatsappCommunity','telegramCommunity','distributorUrl','accountUrl']) if (key in settings) link(settings[key],`Configuración.${key}`);
  for (const key of ['showCategories','showFeatured','showAbout']) if (key in settings) boolean(settings[key],`Configuración.${key}`);
  return structuredClone(input);
}

async function atomicWrite(destination, value) {
  const temporary = destination + '.' + randomBytes(8).toString('hex') + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(value,null,2) + '\n', {flag:'wx',flush:true});
    await rename(temporary,destination);
  } finally { await rm(temporary,{force:true}).catch(() => {}); }
}
export class StoreRepository {
  static async open(dataDir, seedPath) {
    await mkdir(dataDir,{recursive:true});
    const instance = new StoreRepository(path.resolve(dataDir));
    try { instance.current = validateStore(JSON.parse(await readFile(instance.file,'utf8'))); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Cannot load ${instance.file}: ${error.message}. The existing file has not been changed.`);
      instance.current = validateStore(JSON.parse(await readFile(seedPath,'utf8')));
      await atomicWrite(instance.file,instance.current);
    }
    return instance;
  }
  constructor(dataDir) {
    this.file = path.join(dataDir,'store.json');
    this.backup = path.join(dataDir,'store.backup.json');
    this.queue = Promise.resolve();
  }
  get() { return structuredClone(this.current); }
  run(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  checkRevision(revision) {
    if (!Number.isSafeInteger(revision) || revision < 1) invalid('Revisión inválida.');
    if (revision !== this.current.revision) throw new HttpError(409,'El catálogo cambió en otra sesión. Recarga los datos antes de guardar.','CONFLICT');
  }
  async commit(next) {
    const snapshot = validateStore({
      ...next,
      nextProductId:Math.max(this.current.nextProductId || 1, next.nextProductId || 1, ...this.current.products.map(item => item.id + 1), ...next.products.map(item => item.id + 1)),
      revision:this.current.revision + 1,
      updatedAt:new Date().toISOString()
    });
    await atomicWrite(this.backup,this.current);
    await atomicWrite(this.file,snapshot);
    this.current = snapshot;
    return this.get();
  }
  save(input) {
    return this.run(async () => {
      this.checkRevision(input?.revision);
      return this.commit(validateStore(input));
    });
  }
  restore(revision) {
    return this.run(async () => {
      this.checkRevision(revision);
      let previous;
      try { previous = validateStore(JSON.parse(await readFile(this.backup,'utf8'))); }
      catch (error) {
        if (error.code === 'ENOENT') throw new HttpError(404,'Todavía no hay una versión anterior para restaurar.','NO_BACKUP');
        throw error;
      }
      return this.commit(previous);
    });
  }
}
