import {escapeHTML as esc, normalize, ordered, visibleProducts, variantsOf, effectivePrice, onSale, isAvailable, priceRange, resolveItem, cartKey, sanitizeCart, cartTotal, readLocal, matchesSearch, matchesRenewal} from './store-model.js';
const $ = selector => document.querySelector(selector);
const main = $('#main'), modal = $('#modal'), drawer = $('#drawer');
const icons = {heart:'<svg viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg>',eye:'<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>'};
let store, settings = {}, products = [], categories = [], banners = [], cart = [], favorites = [], loading = false;
let currentSlide = 0, slideTimer, toastTimer, sort = 'default', catalogPage = 1, homePage = 1;
const money = value => settings.currency === 'PEN' ? 'S/ ' + Number(value).toFixed(2) : Number(value).toFixed(2) + (settings.currency === 'EUR' ? '€' : '$');
const textHTML = text => esc(text).replace(/\n/g, '<br>');
const imageURL = value => value ? value.replace(/^\/(assets|uploads)\//, './$1/') : './assets/placeholder.svg';
const extLink = (url,label,className='') => url ? `<a class="${className}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : '';
const categoryLink = (category,sub) => '#categoria/' + encodeURIComponent(category.id) + (sub ? '/' + encodeURIComponent(sub) : '');
const categoryName = product => store.categories.find(c => c.id === product.category)?.name || '';
const aboutCopy = () => `<h3>${esc(settings.aboutHeading)}</h3><p>${textHTML(settings.aboutText)}</p>`;
function foreground(hex) {
 const rgb=(hex || '#262625').slice(1).match(/.{2}/g).map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
 return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]>.179?'#202020':'#ffffff';
}
function persist() {
 try {localStorage.setItem('gavidia-demo-cart',JSON.stringify(cart)); localStorage.setItem('gavidia-demo-favorites',JSON.stringify(favorites));} catch {}
 updateHeader();
}
function syncLocal(refreshUI = true) {
 if (!store) return;
 const previousFavorites=JSON.stringify(favorites), previousCart=JSON.stringify(cart);
 cart=sanitizeCart(readLocal('gavidia-demo-cart',cart),products);
 favorites=[...new Set(readLocal('gavidia-demo-favorites',favorites).filter(id=>products.some(p=>p.id===id)))];
 updateHeader();
 if (!refreshUI) return;
 if (drawer.open && previousCart!==JSON.stringify(cart)) renderCart();
 if (previousFavorites!==JSON.stringify(favorites)) {
  document.querySelectorAll('[data-action="favorite"]').forEach(button=>{
   const id=Number(button.dataset.id),product=products.find(p=>p.id===id);
   if(!product)return;
   const selected=favorites.includes(id);button.setAttribute('aria-pressed',selected);
   if(button.classList.contains('favorite'))button.setAttribute('aria-label',(selected?'Quitar de':'Añadir a')+' favoritos: '+product.name);
   else button.textContent=selected?'♥ Guardado en favoritos':'♡ Añadir a la lista de deseos';
  });
  if(location.hash==='#favoritos')catalog('favoritos');
 }
}
function toast(text) {$('#toast').textContent=text; $('#toast').classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3200);}
function updateHeader() {
 const count=cart.reduce((total,row)=>total+row.qty,0);
 $('.cart-count').textContent=count; $('.cart-count-inline').textContent=count; $('#cart-total').textContent=money(cartTotal(cart,products));
}
function applySettings() {
 for (const [variable,field] of Object.entries({'--red':'accentColor','--bg':'backgroundColor','--header':'headerColor','--footer':'footerColor'})) document.documentElement.style.setProperty(variable,settings[field]);
 const root=document.documentElement.style, light=foreground(settings.backgroundColor)==='#202020';
 root.setProperty('--text',foreground(settings.backgroundColor));root.setProperty('--muted',light?'#535353':'#c9c9c9');
 root.setProperty('--header-text',foreground(settings.headerColor));root.setProperty('--footer-text',foreground(settings.footerColor));
 document.querySelector('meta[name="description"]').content=settings.metaDescription;
 document.querySelector('meta[name="theme-color"]').content=settings.headerColor;
 document.querySelector('link[rel="icon"]').href=imageURL(settings.favicon || settings.logo);
 $('.logo img').src=imageURL(settings.logo); $('.logo img').alt=settings.name; $('.logo').setAttribute('aria-label',settings.name+', inicio');
 $('.locale span').textContent='ES · '+settings.currency;
 $('#category-nav').innerHTML=categories.map(c=>`<div class="nav-item"><a href="${categoryLink(c)}">${esc(c.name)}</a>${c.subs.length?`<div class="submenu">${c.subs.map(s=>`<a href="${categoryLink(c,s)}">${esc(s)}</a>`).join('')}</div>`:''}</div>`).join('');
 $('footer').innerHTML=`<div class="payment-row"><strong>Métodos de Pago:</strong>${settings.paymentImage?`<img src="${esc(imageURL(settings.paymentImage))}" alt="Métodos de pago disponibles" loading="lazy">`:''}<span>🇪🇸 Spanish · ${esc(settings.currency)}</span></div><div class="footer-columns"><div><a href="#inicio"><img class="footer-logo" src="${esc(imageURL(settings.logo))}" alt="${esc(settings.name)}" loading="lazy"></a><p>${textHTML(settings.footerText)}</p></div><div><h3>Links Rápidos</h3><a href="#inicio">Inicio</a><a href="#productos">Productos</a><a href="#nosotros">Nosotros</a><a href="#contactanos">${esc(settings.contactTitle)}</a></div><div><h3>Categorías</h3>${categories.map(c=>`<a href="${categoryLink(c)}">${esc(c.name)}</a>`).join('')}</div><div><h3>Contacto</h3>${[settings.phone,settings.phoneSecondary].filter(Boolean).map(phone=>`<a href="tel:${esc(phone.replace(/[^\d+]/g,''))}">♧ &nbsp; ${esc(phone)}</a>`).join('')}<h3>Síguenos</h3><div class="socials">${extLink(settings.instagram,'◎')}${extLink(settings.tiktok,'♪')}</div></div></div><div class="copyright">${esc(settings.copyright)}</div>`;
 $('.whatsapp').hidden=!settings.whatsapp && !settings.whatsappSecondary;
}
function showModal(html,wide=false) {
 $('#modal-content').innerHTML=html; modal.style.width=wide?'min(900px, calc(100% - 32px))':'min(560px, calc(100% - 32px))';
 modal.setAttribute('aria-label',modal.querySelector('h1,h2')?.textContent||'Información'); if(!modal.open)modal.showModal();
}
function priceHTML(product) {
 if(!variantsOf(product).length && onSale(product))return `<del>${money(product.price)}</del> <strong>${money(effectivePrice(product))}</strong>`;
 const range=priceRange(product); return money(range.min)+(range.max>range.min?' – '+money(range.max):'');
}
function saleLabel(product) {
 const items=variantsOf(product).length?variantsOf(product).filter(v=>v.available):[product];
 return items.some(onSale)?product.offerLabel||'Oferta':'';
}
function productCard(product) {
 const available=isAvailable(product),sale=saleLabel(product),choose=variantsOf(product).length>0||product.max>0;
 return `<article class="product-card"><a href="#producto/${product.id}" class="product-visual"><img src="${esc(imageURL(product.image || product.gallery?.[0]))}" alt="${esc(product.name)}" width="242" height="300" loading="lazy">${sale?`<span class="offer-badge">${esc(sale)}</span>`:''}</a><button class="favorite" data-action="favorite" data-id="${product.id}" aria-label="${favorites.includes(product.id)?'Quitar de':'Añadir a'} favoritos: ${esc(product.name)}" aria-pressed="${favorites.includes(product.id)}">${icons.heart}</button><div class="product-info"><h3><a href="#producto/${product.id}">${esc(product.name)}</a></h3><p class="stock ${available?'':'out-of-stock'}"><span>${available?'✓':'×'}</span>${available?'En stock':'Agotado'}</p><p class="price">${priceHTML(product)}</p></div><div class="card-actions"><button class="add" data-action="${!available||choose?'quick':'add'}" data-id="${product.id}">${choose&&available?'Elegir opción':!available?'Leer más':'Añadir al carrito'}</button><button class="quick" data-action="quick" data-id="${product.id}" aria-label="Vista rápida: ${esc(product.name)}">${icons.eye}</button></div></article>`;
}
function pagination(count,page,action) {
 return count>1?`<nav class="pagination" aria-label="Paginación de productos">${Array.from({length:count},(_,i)=>`<button data-action="${action}" data-id="${i+1}" class="${i+1===page?'active':''}" ${i+1===page?'aria-current="page"':''}>${i+1}</button>`).join('')}</nav>`:'';
}
function home() {
 const featured=products.filter(p=>p.featured),pageCount=Math.ceil(featured.length/34);
 homePage=Math.min(homePage,Math.max(1,pageCount));
 main.innerHTML=`${banners.length?`<section class="hero" aria-label="Promociones">${banners.map((banner,i)=>`<div class="hero-slide ${i?'second':'active'}" aria-hidden="${!!i}"><div class="hero-copy"><h1>${esc(banner.title)}</h1><p>${textHTML(banner.description)}</p>${banner.buttonText&&banner.buttonLink?`<a href="${esc(banner.buttonLink)}" ${i?'tabindex="-1"':''}>${esc(banner.buttonText)}</a>`:''}</div></div>`).join('')}${banners.length>1?`<div class="slide-dots">${banners.map((b,i)=>`<button class="${i?'':'active'}" data-action="slide" data-id="${i}" aria-label="Ir a la diapositiva ${i+1}" aria-pressed="${!i}"></button>`).join('')}</div>`:''}</section>`:''}
 ${settings.showCategories&&categories.length?`<section class="section"><h2 class="section-title">${esc(settings.categoryTitle)}</h2><div class="category-grid">${categories.map(c=>`<article class="category-card"><a href="${categoryLink(c)}"><img src="${esc(imageURL(c.image))}" alt="${esc(c.name)}" width="410" height="238"><h3>${esc(c.name)}</h3></a><ul>${(c.homeSubs||c.subs).filter(s=>c.subs.includes(s)).map(s=>`<li><a href="${categoryLink(c,s)}">${esc(s)}</a></li>`).join('')}</ul></article>`).join('')}</div></section>`:''}
 ${settings.showFeatured&&featured.length?`<section class="section promoted" id="catalog"><h2 class="section-title">${esc(settings.featuredTitle)}</h2><div class="product-grid">${featured.slice((homePage-1)*34,homePage*34).map(productCard).join('')}</div>${pagination(pageCount,homePage,'home-page')}</section>`:''}
 ${settings.showAbout?`<section class="about-section"><h2>${esc(settings.aboutTitle)}</h2>${aboutCopy()}</section>`:''}
 ${!banners.length&&!(settings.showCategories&&categories.length)&&!(settings.showFeatured&&featured.length)&&!settings.showAbout?'<section class="empty"><a href="#productos" class="primary">Ver productos</a></section>':''}`;
 document.querySelectorAll('.hero-slide').forEach((slide,i)=>{slide.style.backgroundImage=`url(${JSON.stringify(imageURL(banners[i].image))})`;});
 currentSlide=0;
 if(banners.length>1&&!matchMedia('(prefers-reduced-motion: reduce)').matches)slideTimer=setInterval(()=>setSlide((currentSlide+1)%banners.length),8500);
}
function setSlide(index) {
 currentSlide=index;
 document.querySelectorAll('.hero-slide').forEach((element,i)=>{element.classList.toggle('active',i===index);element.setAttribute('aria-hidden',i!==index);if(element.querySelector('a'))element.querySelector('a').tabIndex=i===index?0:-1;});
 document.querySelectorAll('.slide-dots button').forEach((element,i)=>{element.classList.toggle('active',i===index);element.setAttribute('aria-pressed',i===index);});
}
function catalog(kind='',param='',sub='') {
 let title='Productos',list=[...products]; const category=categories.find(c=>c.id===param);
 if(kind==='categoria'){title=category?sub||category.name:'Categoría no disponible';list=category?list.filter(p=>p.categories.includes(param)&&(!sub||p.subs.includes(sub))):[];}
 if(kind==='buscar'){title='Resultados para: '+param;list=list.filter(p=>matchesSearch(p,param));}
 if(kind==='renovar'){title='Renueva tu suscripción: '+param;list=list.filter(p=>matchesRenewal(p,param,sub));}
 if(kind==='favoritos'){title='Lista de deseos';list=list.filter(p=>favorites.includes(p.id));}
 if(sort==='price-asc')list.sort((a,b)=>priceRange(a).min-priceRange(b).min);
 if(sort==='price-desc')list.sort((a,b)=>priceRange(b).min-priceRange(a).min);
 if(sort==='name')list.sort((a,b)=>a.name.localeCompare(b.name,'es'));
 const pageCount=Math.ceil(list.length/24);catalogPage=Math.min(catalogPage,Math.max(1,pageCount));
 main.innerHTML=`<div class="page-heading"><div class="breadcrumbs"><a href="#inicio">Inicio</a> / ${esc(title)}</div><h1>${esc(title)}</h1>${kind==='categoria'&&category?`<div class="filter-chips"><a class="${!sub?'active':''}" href="${categoryLink(category)}">Todo</a>${category.subs.map(s=>`<a class="${s===sub?'active':''}" href="${categoryLink(category,s)}">${esc(s)}</a>`).join('')}</div>`:''}</div><section class="section"><div class="catalog-toolbar"><span>${list.length} ${list.length===1?'producto':'productos'}${list.length?' · '+((catalogPage-1)*24+1)+'–'+Math.min(catalogPage*24,list.length):''}</span><select id="sort" aria-label="Ordenar productos"><option value="default">Orden predeterminado</option><option value="price-asc">Precio: menor a mayor</option><option value="price-desc">Precio: mayor a menor</option><option value="name">Nombre: A–Z</option></select></div><div class="product-grid">${list.length?list.slice((catalogPage-1)*24,catalogPage*24).map(productCard).join(''):`<div class="empty"><h2>${kind==='favoritos'?'Tu lista de deseos está vacía':'No se encontraron productos'}</h2><p>${kind==='favoritos'?'Pulsa el corazón de un producto para guardarlo.':'Prueba otra búsqueda o explora las demás categorías.'}</p><a class="primary" href="#productos">Ver todos los productos</a></div>`}</div>${pagination(pageCount,catalogPage,'page')}</section>`;
 $('#sort').value=sort;$('#sort').addEventListener('change',event=>{sort=event.target.value;catalogPage=1;catalog(kind,param,sub);});
}
function detailHTML(product,isPage=false) {
 const variants=variantsOf(product),selected=variants.find(v=>v.available)||variants[0],images=[...new Set([product.image,...(product.gallery||[])])].filter(Boolean),available=isAvailable(product);
 return `<div class="product-detail" data-product="${product.id}"><div class="product-gallery"><img class="detail-cover" src="${esc(imageURL(product.image || product.gallery?.[0]))}" alt="${esc(product.name)}">${images.length>1?`<div class="gallery-thumbs">${images.map((url,i)=>`<button data-action="gallery" data-src="${esc(imageURL(url))}" aria-label="Ver foto ${i+1}" aria-pressed="${!i}"><img src="${esc(imageURL(url))}" alt=""></button>`).join('')}</div>`:''}</div><div><p class="breadcrumbs">${esc(categoryName(product))} / ${esc(product.sub)}</p><${isPage?'h1':'h2'}>${esc(product.name)}</${isPage?'h1':'h2'}><p class="price" data-detail-price>${priceHTML(selected||product)}</p><p class="stock ${available?'':'out-of-stock'}"><span>${available?'✓':'×'}</span>${available?'En stock':'Agotado'}</p><p>${textHTML(product.description)}</p>${variants.length?`<label class="detail-label">Plan o presentación<select data-variant aria-label="Plan o presentación">${variants.map(v=>`<option value="${esc(v.id)}" ${v===selected?'selected':''} ${v.available?'':'disabled'}>${esc(v.label)} — ${money(effectivePrice(v))}${v.available?'':' (Agotado)'}</option>`).join('')}</select></label>`:product.max?'<p class="demo-note">El rango depende del plan. El carrito utiliza el precio inicial; consulta las opciones antes de comprar.</p>':''}${available?`<div class="purchase-row"><div class="qty"><button data-action="detail-qty" data-delta="-1" aria-label="Disminuir cantidad">−</button><input data-quantity type="number" min="1" max="99" value="1" aria-label="Cantidad"><button data-action="detail-qty" data-delta="1" aria-label="Aumentar cantidad">+</button></div><button class="primary" data-action="add-detail" data-id="${product.id}">Añadir al carrito</button></div>`:'<p class="demo-note">Este producto está agotado y no se puede añadir al carrito.</p>'}<button class="secondary" data-action="favorite" data-id="${product.id}">${favorites.includes(product.id)?'♥ Guardado en favoritos':'♡ Añadir a la lista de deseos'}</button><div class="detail-tabs"><details open><summary>Acerca del producto</summary><p>${textHTML(product.description)}</p></details><details><summary>Contenido</summary><p>${textHTML(product.content)}</p></details></div></div></div>`;
}
function productPage(id) {
 const product=products.find(p=>p.id===Number(id));
 if(!product){main.innerHTML='<div class="empty"><h1>Producto no disponible</h1><a href="#productos" class="primary">Volver a productos</a></div>';return;}
 const category=categories.find(c=>c.id===product.category);
 main.innerHTML=`<article class="product-page"><p class="breadcrumbs"><a href="#inicio">Inicio</a> / ${category?`<a href="${categoryLink(category)}">${esc(category.name)}</a>`:'<a href="#productos">Productos</a>'}</p>${detailHTML(product,true)}</article>`;
}
function addCart(id,qty=1,variantId=null) {
 const product=products.find(p=>p.id===id);if(!product)return;
 if(!resolveItem(product,variantId)){toast(variantsOf(product).length?'Selecciona una opción disponible.':'Este producto está agotado.');return;}
 qty=Math.max(1,Math.min(99,Math.floor(Number(qty)||1)));
 const next={id,variantId,qty},line=cart.find(row=>cartKey(row)===cartKey(next));
 if(line)line.qty=Math.min(99,line.qty+qty);else cart.push(next);
 persist();toast('“'+product.name+'” añadido al carrito');if(modal.open)modal.close();renderCart();if(!drawer.open)drawer.showModal();
}
function renderCart() {
 cart=sanitizeCart(cart,products);updateHeader();
 $('#cart-content').innerHTML=cart.length?`${cart.map((row,index)=>{const product=products.find(p=>p.id===row.id),item=resolveItem(product,row.variantId);return `<div class="cart-line"><a href="#producto/${product.id}" data-action="cart-link"><img src="${esc(imageURL(product.image || product.gallery?.[0]))}" alt="${esc(product.name)}"></a><div><h3>${esc(product.name)}</h3>${row.variantId?`<small>${esc(item.label)}</small>`:''}<div class="qty"><button data-action="cart-qty" data-key="${esc(cartKey(row))}" data-delta="-1" aria-label="Disminuir cantidad de ${esc(product.name)}">−</button><span aria-label="Cantidad">${row.qty}</span><button data-action="cart-qty" data-key="${esc(cartKey(row))}" data-delta="1" aria-label="Aumentar cantidad de ${esc(product.name)}">+</button></div><p>${row.qty} × ${money(effectivePrice(item))}</p></div><button class="remove" data-action="remove" data-key="${esc(cartKey(row))}" aria-label="Eliminar ${esc(product.name)}">×</button></div>`;}).join('')}<div class="cart-summary"><span>Subtotal:</span><strong>${money(cartTotal(cart,products))}</strong></div><div class="cart-buttons"><button class="primary" data-action="checkout">Finalizar compra</button><button class="secondary" data-action="close-cart">Seguir comprando</button></div><p class="cart-note">Carrito de demostración. No se procesan pagos ni pedidos reales.</p>`:'<div class="empty"><h3>No hay productos en el carrito.</h3><button class="primary" data-action="shop">Volver a la tienda</button></div>';
}
function contact() {return `<section class="standard-page"><h1>${esc(settings.contactTitle)}</h1><p>${textHTML(settings.contactText)}</p><div class="contact-cards">${settings.whatsapp?`<article><h3>Atención por WhatsApp</h3><p>${esc(settings.phone)}</p>${extLink(settings.whatsapp,'Abrir WhatsApp','primary')}</article>`:''}${settings.whatsappSecondary?`<article><h3>Soporte y consultas</h3><p>${esc(settings.phoneSecondary)}</p>${extLink(settings.whatsappSecondary,'Contactar','secondary')}</article>`:''}</div></section>`;}
function navigateTo(hash) {catalogPage=1;if(location.hash===hash)route();else location.hash=hash;}
function route(resetScroll=true) {
 if(!store)return;clearInterval(slideTimer);$('#search-suggestions').hidden=true;
 const [kind='',param='',sub='']=location.hash.slice(1).split('/').map(value=>{try{return decodeURIComponent(value);}catch{return value;}});
 if(modal.open)modal.close();if(drawer.open)drawer.close();
 if(!kind||kind==='inicio')home();
 else if(['productos','categoria','buscar','favoritos','renovar'].includes(kind))catalog(kind,param,sub);
 else if(kind==='producto')productPage(param);
 else if(kind==='nosotros')main.innerHTML=`<section class="standard-page"><h1>${esc(settings.aboutTitle)}</h1>${aboutCopy()}<button class="primary" data-action="community">Nuestra comunidad</button></section>`;
 else if(kind==='contactanos')main.innerHTML=contact();else home();
 document.title=!kind||kind==='inicio'?settings.pageTitle:(main.querySelector('h1')?.textContent||settings.pageTitle)+' | '+settings.name;
 if(resetScroll)window.scrollTo({top:0,behavior:'instant'});
}
function renewalModal() {
 showModal('<h2 class="modal-title">Renueva tu suscripción</h2><form id="renew-form" class="form-grid"><label>Plataforma<input required name="platform" aria-label="Plataforma" placeholder="Por ejemplo: Netflix o Disney+" maxlength="100"></label><label>Servicio<select required name="service" aria-label="Servicio"><option value="todos">Todos los servicios</option><option value="perfil">Perfil o dispositivo</option><option value="cuenta">Cuenta completa</option></select></label><p class="demo-note">Consulta los planes del catálogo. La renovación se coordina con el proveedor.</p><button class="primary" type="submit">Consultar productos</button></form>');
 $('#renew-form').onsubmit=event=>{event.preventDefault();const values=new FormData(event.target),platform=values.get('platform').trim();if(!platform)return;modal.close();$('#search-input').value=platform;navigateTo('#renovar/'+encodeURIComponent(platform)+'/'+encodeURIComponent(values.get('service')));};
}
document.addEventListener('click',event=>{
 const button=event.target.closest('[data-action]');if(!button)return;
 const action=button.dataset.action,id=Number(button.dataset.id),product=products.find(p=>p.id===id);
 if(action==='reload'){loadStore();return;}if(!store)return;
 syncLocal(false);
 if(action==='hide-community')button.closest('.community-tab').hidden=true;
 else if(action==='home-page'){homePage=id;clearInterval(slideTimer);home();$('#catalog')?.scrollIntoView({behavior:'instant'});}
 else if(action==='slide'){clearInterval(slideTimer);setSlide(id);}
 else if(action==='favorite'&&product){
  favorites=favorites.includes(id)?favorites.filter(value=>value!==id):[...favorites,id];persist();
  document.querySelectorAll(`[data-action="favorite"][data-id="${id}"]`).forEach(element=>{element.setAttribute('aria-pressed',favorites.includes(id));if(element.classList.contains('favorite'))element.setAttribute('aria-label',(favorites.includes(id)?'Quitar de':'Añadir a')+' favoritos: '+product.name);else element.textContent=favorites.includes(id)?'♥ Guardado en favoritos':'♡ Añadir a la lista de deseos';});
  toast(favorites.includes(id)?'Producto guardado en favoritos':'Producto eliminado de favoritos');if(location.hash==='#favoritos')route(false);
 }
 else if(action==='quick'&&product)showModal(detailHTML(product),true);
 else if(action==='add')addCart(id);
 else if(action==='add-detail'){const detail=button.closest('.product-detail');addCart(id,detail.querySelector('[data-quantity]').value,detail.querySelector('[data-variant]')?.value||null);}
 else if(action==='detail-qty'){const input=button.closest('.qty').querySelector('[data-quantity]');input.value=Math.min(99,Math.max(1,(Number(input.value)||1)+Number(button.dataset.delta)));}
 else if(action==='gallery'){const gallery=button.closest('.product-gallery');gallery.querySelector('.detail-cover').src=button.dataset.src;gallery.querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',item===button));}
 else if(action==='cart'){renderCart();if(!drawer.open)drawer.showModal();}
 else if(action==='close')modal.close();
 else if(action==='close-cart'||action==='cart-link')drawer.close();
 else if(action==='cart-qty'){const line=cart.find(row=>cartKey(row)===button.dataset.key);if(line)line.qty=Math.max(1,Math.min(99,line.qty+Number(button.dataset.delta)));persist();renderCart();}
 else if(action==='remove'){cart=cart.filter(row=>cartKey(row)!==button.dataset.key);persist();renderCart();}
 else if(action==='page'){catalogPage=id;route(false);main.scrollIntoView({behavior:'smooth'});}
 else if(action==='shop'){drawer.close();navigateTo('#productos');}
 else if(action==='checkout'){drawer.close();showModal(`<h2 class="modal-title">Resumen de tu compra</h2>${cart.map(row=>{const product=products.find(p=>p.id===row.id),item=resolveItem(product,row.variantId);return `<p>${row.qty} × ${esc(product.name)}${row.variantId?' · '+esc(item.label):''} <strong>${money(row.qty*effectivePrice(item))}</strong></p>`;}).join('')}<div class="cart-summary"><span>Total</span><strong>${money(cartTotal(cart,products))}</strong></div><p class="demo-note">Los pagos y la entrega de productos no están conectados. No se ha generado ningún pedido real.</p><button class="primary" data-action="close">Volver a la tienda</button>`);}
 else if(action==='account')showModal(`<div class="modal-intro"><h2 class="modal-title">Acceso / Registro</h2><p>El acceso de clientes se gestiona en el sitio enlazado. Esta tienda local no solicita contraseñas de cliente.</p>${extLink(settings.accountUrl,'Acceder al sitio de cuentas ↗','primary')}<a class="secondary" href="#favoritos">Ver mis favoritos</a></div>`);
 else if(action==='locale')showModal(`<h2 class="modal-title">Idioma / Moneda</h2><p>Idioma: Español</p><p>Los precios del catálogo se muestran en ${esc(settings.currency)}.</p><button class="primary" data-action="close">Aceptar</button>`);
 else if(action==='contact')showModal(`<h2 class="modal-title">¿En qué podemos ayudarte?</h2><p>Contacta con ${esc(settings.name)} por WhatsApp.</p><div class="community-links">${extLink(settings.whatsapp,settings.phone||'WhatsApp')}${extLink(settings.whatsappSecondary,settings.phoneSecondary||'Soporte')}</div>`);
 else if(action==='community')showModal(`<h2 class="modal-title">Nuestra comunidad</h2><p>¿Qué te gustaría lograr hoy?</p><div class="community-links">${extLink(settings.whatsappCommunity,'Comunidad de WhatsApp ↗')}${extLink(settings.telegramCommunity,'Comunidad de Telegram ↗')}${extLink(settings.distributorUrl,'Conviértete en distribuidor ↗')}<a href="#favoritos">Ver mi lista de deseos ♡</a></div>`);
 else if(action==='renew')renewalModal();
 else if(action==='menu')showModal(`<h2 class="modal-title">Menú</h2><nav class="menu-links"><a href="#inicio">Inicio</a><a href="#productos">Productos</a>${categories.map(c=>`<a href="${categoryLink(c)}">${esc(c.name)}</a>`).join('')}<a href="#nosotros">Nosotros</a><a href="#contactanos">${esc(settings.contactTitle)}</a><a href="#favoritos">♡ Lista de deseos</a></nav>`);
});
document.addEventListener('change',event=>{
 if(!event.target.matches('[data-variant]'))return;
 const detail=event.target.closest('.product-detail'),product=products.find(p=>p.id===Number(detail.dataset.product)),variant=variantsOf(product).find(v=>v.id===event.target.value);
 if(variant)detail.querySelector('[data-detail-price]').innerHTML=priceHTML(variant);
});
$('#search-form').addEventListener('submit',event=>{event.preventDefault();const query=$('#search-input').value.trim();navigateTo(query?'#buscar/'+encodeURIComponent(query):'#productos');$('#search-suggestions').hidden=true;});
$('#search-input').addEventListener('input',event=>{
 const query=normalize(event.target.value),results=query.length>1?products.filter(p=>matchesSearch(p,query)).slice(0,5):[],box=$('#search-suggestions');box.hidden=query.length<2;
 box.innerHTML=results.length?results.map(p=>`<a class="suggestion" href="#producto/${p.id}"><img src="${esc(imageURL(p.image || p.gallery?.[0]))}" alt=""><span>${esc(p.name)}</span><b>${money(priceRange(p).min)}</b></a>`).join(''):'<p class="suggestion">No se encontraron productos.</p>';
});
document.addEventListener('click',event=>{
 if(!event.target.closest('.search'))$('#search-suggestions').hidden=true;
 const link=event.target.closest('a[href^="#"]');if(!link||link.classList.contains('skip-link'))return;
 const href=link.getAttribute('href');if(href==='#inicio')homePage=1;if(href===location.hash){event.preventDefault();catalogPage=1;route();}
});
document.addEventListener('keydown',event=>{if(event.key==='Escape')$('#search-suggestions').hidden=true;});
[modal,drawer].forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}));
window.addEventListener('hashchange',()=>{catalogPage=1;route();});
$('.skip-link').addEventListener('click',event=>{event.preventDefault();main.tabIndex=-1;main.focus();main.scrollIntoView();});
async function loadStore(refresh=false) {
 if(loading)return;loading=true;
 if(!store)main.innerHTML='<section class="empty" role="status"><h1>Cargando tienda…</h1></section>';
 try {
  const response=await fetch('./store.json',{cache:'no-store'});if(!response.ok)throw new Error('No se pudo cargar el catálogo.');
  const next=await response.json();if(store?.revision===next.revision){syncLocal();return;}
  const hadStore=!!store,previousCart=JSON.stringify(cart);
  store=next;settings=store.settings;products=visibleProducts(store);categories=ordered(store.categories.filter(c=>c.visible!==false));banners=ordered(store.banners.filter(b=>b.visible!==false));
  cart=sanitizeCart(readLocal('gavidia-demo-cart',cart),products);favorites=[...new Set(readLocal('gavidia-demo-favorites',favorites).filter(id=>products.some(p=>p.id===id)))];
  applySettings();persist();route(!refresh);
  if(hadStore)toast(previousCart!==JSON.stringify(cart)?'Tienda actualizada. Se retiraron del carrito opciones que ya no están disponibles.':'Tienda actualizada con los cambios guardados.');
 }catch(error){if(!store)main.innerHTML='<section class="empty"><h1>No se pudo cargar la tienda</h1><p>Comprueba tu conexión y vuelve a intentarlo.</p><button class="primary" data-action="reload">Reintentar</button></section>';else if(!refresh)toast(error.message);}
 finally{loading=false;}
}
window.addEventListener('focus',()=>loadStore(true));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)loadStore(true);});
window.addEventListener('storage',event=>{
 if(event.key==='gavidia-store-revision')loadStore(true);
 else if(event.key===null || event.key==='gavidia-demo-cart' || event.key==='gavidia-demo-favorites')syncLocal();
});
loadStore();
