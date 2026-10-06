import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {visibleProducts,effectivePrice,onSale,isAvailable,hasOffer,isMoneyAmount,priceRange,resolveItem,sanitizeCart,cartTotal,readLocal,matchesSearch,matchesRenewal,escapeHTML} from '../dist/store-model.js';
import {validateStore} from '../lib/store.mjs';
const seed = JSON.parse(fs.readFileSync(new URL('../data/seed.json',import.meta.url),'utf8'));

test('catalogue validates, references existing local images and exposes valid price ranges',()=>{
 assert.doesNotThrow(()=>validateStore(seed));
 assert.ok(seed.products.length>0);
 assert.ok(seed.nextProductId>Math.max(...seed.products.map(product=>product.id)));
 for(const product of seed.products){
  const range=priceRange(product);
  assert.ok(isMoneyAmount(range.min)&&isMoneyAmount(range.max),product.name);
  assert.ok(range.min<=range.max,product.name);
 }
 for(const entity of [...seed.products,...seed.categories,...seed.banners]){
  for(const image of [entity.image,...(entity.gallery||[])].filter(Boolean)) assert.ok(fs.existsSync(new URL('../dist/'+image,import.meta.url)),image);
 }
});
test('offers including zero are applied, ranges use available variants',()=>{
 const product={price:10,max:30,salePrice:0,available:true,visible:true,variants:[]};
 assert.equal(effectivePrice(product),0); assert.ok(onSale(product)); assert.deepEqual(priceRange(product),{min:0,max:0});
 product.variants=[{id:'m',label:'Mes',price:10,salePrice:7,available:true},{id:'a',label:'Año',price:50,salePrice:null,available:true},{id:'old',price:1,salePrice:null,available:false}];
 assert.deepEqual(priceRange(product),{min:7,max:50}); assert.ok(isAvailable(product));
 assert.equal(resolveItem(product,'m').salePrice,7); assert.equal(resolveItem(product,null),null); assert.equal(resolveItem(product,'old'),null);
 product.variants.forEach(v=>v.available=false);assert.equal(isAvailable(product),false);
});
test('cart handles variants, removes hidden or unavailable items, caps quantities and charges current prices',()=>{
 const products=[{id:1,price:10,salePrice:7,visible:true,available:true,variants:[]},{id:2,price:5,salePrice:null,available:true,visible:false},{id:3,available:true,visible:true,variants:[{id:'m',price:5,salePrice:3.75,available:true},{id:'a',price:30,salePrice:null,available:true},{id:'x',price:2,available:false}]}];
 const rows=sanitizeCart([{id:1,qty:2},{id:1,qty:98},{id:2,qty:1},{id:3,variantId:'m',qty:2},{id:3,variantId:'a',qty:1},{id:3,variantId:'x',qty:1},{id:3,qty:1},{id:999,qty:1},{id:'1',qty:1},{id:1,qty:0},null],products);
 assert.deepEqual(rows,[{id:1,variantId:null,qty:99},{id:3,variantId:'m',qty:2},{id:3,variantId:'a',qty:1}]);
 assert.equal(cartTotal(rows,products),730.5);
 products[0].salePrice=5;assert.equal(cartTotal(rows,products),532.5);
 products[2].variants.splice(0,1);assert.equal(sanitizeCart(rows,products).length,2);
});
test('invalid local storage is recoverable',()=>{
 for(const value of ['{}','null','true','"text"','12','broken JSON'])assert.deepEqual(readLocal('key',[],{getItem:()=>value}),[]);
 assert.deepEqual(readLocal('key',[],{getItem:()=>{throw Error('Blocked');}}),[]);
 assert.deepEqual(sanitizeCart([null,{},false,{id:3,qty:0}],seed.products),[]);
});
test('visibility and admin ordering apply to storefront',()=>{
 const store={products:[{id:1,name:'B',order:3,visible:true},{id:2,name:'A',order:0,visible:false},{id:3,name:'C',order:1,visible:true}]};
 assert.deepEqual(visibleProducts(store).map(p=>p.id),[3,1]);assert.equal(store.products[0].id,1);
});
test('offer and availability filters follow the plans actually sold',()=>{
 const product={price:10,salePrice:5,available:true,variants:[{id:'month',price:25,salePrice:null,available:true}]};
 assert.deepEqual(priceRange(product),{min:25,max:25});assert.equal(hasOffer(product),false);
 product.variants[0].salePrice=20;assert.equal(hasOffer(product),true);
 product.variants[0].available=false;assert.equal(hasOffer(product),false);assert.equal(isAvailable(product),false);
});
test('blocked localStorage property access keeps the supplied fallback',()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 try {
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('SecurityError');}});
  assert.deepEqual(readLocal('cart',[{id:3,qty:1}]),[{id:3,qty:1}]);
 } finally { if(descriptor)Object.defineProperty(globalThis,'localStorage',descriptor);else delete globalThis.localStorage; }
 assert.deepEqual(readLocal('cart',[{id:3,qty:1}],{getItem:()=>null}),[]);
});
test('only whole cents are accepted consistently with server validation',()=>{
 for(const value of [0,0.29,0.1+0.2,1.33,999999999.99])assert.equal(isMoneyAmount(value),true,String(value));
 for(const value of [1.005,1.335,0.000001,-1,Infinity,'2.00'])assert.equal(isMoneyAmount(value),false,String(value));
});
test('search and renewals handle accents, punctuation and multiple categories',()=>{
 const products=[
  {id:1,name:'Disney Estándar | Cuenta Completa | 1 Mes',subs:['Video']},
  {id:2,name:'Disney Premium | 1 Perfil | 1 Mes',subs:['Video']},
  {id:3,name:'Netflix Premium | Cuenta Completa | 1 Mes',subs:['Video']},
  {id:4,name:'Netflix Estándar | 1 Perfil | 1 Mes',subs:['Video']},
  {id:5,name:'Spotify Premium | 1 Mes',subs:['Música']},
  {id:6,name:'YouTube Premium | 1 Mes',subs:['Música','Video']},
  {id:7,name:'Apple TV | 1 Dispositivo | 1 Mes',subs:['Video']},
  {id:8,name:'Apple TV | Cuenta Completa | 1 Mes',subs:['Video']}
 ];
 assert.deepEqual(products.filter(p=>matchesSearch(p,'Disney+')).map(p=>p.id),[1,2]);
 assert.deepEqual(products.filter(p=>matchesSearch(p,'PREMIUM netflix')).map(p=>p.id),[3]);
 assert.deepEqual(products.filter(p=>matchesSearch(p,'musica')).map(p=>p.id),[5,6]);
 assert.deepEqual(products.filter(p=>matchesSearch(p,'YouTube VIDEO')).map(p=>p.id),[6]);
 assert.deepEqual(products.filter(p=>matchesRenewal(p,'Disney+','cuenta')).map(p=>p.id),[1]);
 assert.deepEqual(products.filter(p=>matchesRenewal(p,'Apple TV','perfil')).map(p=>p.id),[7]);
 assert.equal(escapeHTML('<img onerror="bad">'),'&lt;img onerror=&quot;bad&quot;&gt;');
});
