export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
export const ordered = list => [...list].sort((a,b) => (a.order ?? 0) - (b.order ?? 0) || a.name?.localeCompare(b.name, 'es') || 0);
export const visibleProducts = store => ordered(store.products.filter(p => p.visible !== false));
export const variantsOf = product => product.variants || [];
export const effectivePrice = item => item.salePrice !== null && item.salePrice !== undefined ? item.salePrice : item.price;
export const onSale = item => item.salePrice !== null && item.salePrice !== undefined && item.salePrice < item.price;
export const isAvailable = product => product.available && (!variantsOf(product).length || variantsOf(product).some(v => v.available));
export const hasOffer = product => (variantsOf(product).length ? variantsOf(product).filter(v => v.available) : [product]).some(onSale);
export const isMoneyAmount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9 && Math.abs(value * 100 - Math.round(value * 100)) <= Number.EPSILON * Math.max(1, Math.abs(value * 100)) * 4;
export function priceRange(product) {
 const variants = variantsOf(product);
 if (variants.length) {
  const offered = variants.some(v => v.available) ? variants.filter(v => v.available) : variants;
  const prices = offered.map(effectivePrice);
  return {min: Math.min(...prices), max: Math.max(...prices)};
 }
 return {min: effectivePrice(product), max: onSale(product) ? effectivePrice(product) : product.max || product.price};
}
export function resolveItem(product, variantId) {
 if (!product || product.visible === false || !product.available) return null;
 if (variantsOf(product).length) return variantsOf(product).find(v => v.id === variantId && v.available) || null;
 return variantId ? null : product;
}
export const cartKey = row => `${row.id}:${row.variantId || ''}`;
export function sanitizeCart(value, products) {
 const rows = new Map();
 for (const row of Array.isArray(value) ? value : []) {
  if (!row || !Number.isInteger(row.id) || !Number.isInteger(row.qty) || row.qty < 1 || row.qty > 99) continue;
  const variantId = typeof row.variantId === 'string' && row.variantId ? row.variantId : null;
  if (!resolveItem(products.find(p => p.id === row.id), variantId)) continue;
  const next = {id:row.id, variantId, qty:row.qty}, key = cartKey(next);
  next.qty = Math.min(99, (rows.get(key)?.qty || 0) + row.qty);
  rows.set(key, next);
 }
 return [...rows.values()];
}
export function cartTotal(cart, products) {
 return Math.round(cart.reduce((total, row) => {
  const item = resolveItem(products.find(p => p.id === row.id), row.variantId);
  return total + (item ? Math.round(effectivePrice(item) * 100) * row.qty : 0);
 }, 0)) / 100;
}
export function readLocal(key, fallback, storage) {
 try { const raw = (storage ?? globalThis.localStorage).getItem(key); if (raw === null) return []; const value = JSON.parse(raw); return Array.isArray(value) ? value : fallback; }
 catch { return fallback; }
}
export function matchesSearch(product, query) {
 const text = normalize(product.name + ' ' + (product.subs || [product.sub]).join(' '));
 return normalize(query).split(' ').filter(Boolean).every(word => text.includes(word));
}
export function matchesRenewal(product, platform, service) {
 if (!matchesSearch(product, platform)) return false;
 const name = normalize(product.name);
 if (service === 'cuenta') return /\bcuentas?\b/.test(name);
 if (service === 'perfil') return /\b(perfil|dispositivos?)\b/.test(name);
 return true;
}
