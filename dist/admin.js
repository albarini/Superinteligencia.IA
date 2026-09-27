import {priceRange, variantsOf, isAvailable, hasOffer, onSale, isMoneyAmount} from './store-model.js';

(() => {
  const $ = selector => document.querySelector(selector);
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const unique = values => [...new Set(values.filter(Boolean))];
  const lines = value => unique(String(value).split('\n').map(item => item.trim()));
  const imageURL = value => /^(?:https?:\/\/|\/)/i.test(value || '') ? value : value ? '/' + value : '';
  const imageSafe = value => !value || /^(?:https:\/\/[^\s]+|\/?(?:assets|uploads)\/[\w./-]+)$/i.test(value);
  const linkSafe = value => !value || /^(?:https:\/\/|mailto:|tel:|#|\/(?!\/))[^\s]*$/i.test(value);
  const newId = prefix => prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const titles = {products:'Productos',offers:'Ofertas',categories:'Categorías',banners:'Banners',appearance:'Apariencia y textos',contact:'Contacto',media:'Medios'};
  const state = {store:null,draft:null,csrf:'',view:'products',selected:{product:null,category:null,banner:null},search:'',filter:'all',dirty:false,busy:false,uploads:0,media:[],mediaLoaded:false,mediaLoading:false,mediaError:'',mediaPicker:null};
  let toastTimer;

  function confirmChange(message) {
    return new Promise(resolve => {
      const dialog = $('#confirm-dialog');
      $('#confirm-text').textContent = message;
      let accepted = false;
      $('#confirm-accept').onclick = () => { accepted = true; dialog.close(); };
      $('#confirm-cancel').onclick = () => dialog.close();
      dialog.addEventListener('close', () => resolve(accepted), {once:true});
      dialog.showModal();
      $('#confirm-cancel').focus();
    });
  }

  function money(value) {
    return new Intl.NumberFormat('es-PE', {style:'currency',currency:state.draft?.settings?.currency || 'USD'}).format(Number(value) || 0);
  }
  function notify(message) {
    $('#toast').textContent = message;
    $('#toast').classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4000);
  }
  function showError(message, conflict = false) {
    $('#message').textContent = message;
    if (conflict) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'button small'; button.dataset.action = 'export-draft'; button.textContent = 'Descargar borrador';
      $('#message').append(button);
    }
    $('#message').hidden = false;
    $('#message').scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  function clearError() { $('#message').hidden = true; $('#message').textContent = ''; }
  function current(scope) {
    if (scope === 'settings') return state.draft.settings;
    const collections = {product:'products',category:'categories',banner:'banners'};
    return state.draft[collections[scope]]?.find(item => String(item.id) === String(state.selected[scope]));
  }
  function markDirty() { state.dirty = true; updateStatus(); }
  function allocateProductId() {
    const id = Math.max(state.draft.nextProductId || 1, ...state.draft.products.map(item => item.id + 1));
    state.draft.nextProductId = id + 1;
    return id;
  }
  function updateStatus() {
    const blocked = !state.draft || state.busy || state.uploads > 0;
    $('#save').disabled = blocked || !state.dirty;
    $('#discard').disabled = blocked || !state.dirty;
    $('#restore').disabled = blocked || (state.store?.revision ?? 1) < 2;
    $('#save').textContent = state.busy ? 'Guardando…' : 'Guardar cambios';
    const status = state.uploads ? 'Subiendo imágenes…' : state.busy ? 'Guardando en este equipo…' : !state.draft ? 'Conectando con tu tienda…' : state.dirty ? 'Tienes cambios sin guardar' : 'Todos los cambios guardados';
    $('#save-status').innerHTML = `<span class="status-dot ${state.busy || state.uploads ? 'busy' : state.dirty ? 'dirty' : ''}"></span>${status}`;
    if (state.store) {
      const time = state.store.updatedAt ? new Date(state.store.updatedAt).toLocaleString('es-PE', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
      $('#revision').textContent = `Panel local · Versión ${state.store.revision}${time ? ' · Guardado ' + time : ''}`;
    }
  }
  async function api(path, options = {}, retrySession = true) {
    const response = await fetch(path, {credentials:'same-origin',cache:'no-store',...options,headers:{...(options.body && typeof options.body === 'string' ? {'Content-Type':'application/json'} : {}),...(options.method && options.method !== 'GET' ? {'X-CSRF-Token':state.csrf} : {}),...options.headers}});
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && retrySession && path !== '/api/admin/session') {
      const session = await api('/api/admin/session', {}, false);
      state.csrf = session.csrfToken;
      return api(path, options, false);
    }
    if (!response.ok) {
      const error = new Error(response.status === 409 ? 'Hay una versión más reciente de la tienda. Tus cambios siguen en este panel. Descarga el borrador antes de recargar la página y después vuelve a aplicar tus ediciones sobre la versión nueva.' : typeof data.error === 'string' ? data.error : data.message || `No se pudo completar la operación (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function setStore(value) {
    const store = value.store || value;
    if (!store.products || !store.categories || !store.settings) throw new Error('La respuesta de la tienda no tiene el formato esperado.');
    state.store = clone(store);
    state.draft = clone(store);
    state.dirty = false;
    ['product','category','banner'].forEach(scope => {
      const list = store[{product:'products',category:'categories',banner:'banners'}[scope]];
      if (!list.some(item => String(item.id) === String(state.selected[scope]))) state.selected[scope] = list[0]?.id ?? null;
    });
    updateStatus();
  }
  function broadcastRevision() {
    try { localStorage.setItem('gavidia-store-revision', String(state.store.revision)); } catch {}
  }
  async function initialize() {
    try {
      const session = await api('/api/admin/session');
      state.csrf = session.csrfToken;
      if (!state.csrf) throw new Error('No se pudo iniciar la sesión local. Recarga la página para volver a intentarlo.');
      setStore(session.store || await api('/api/store'));
      render();
    } catch (error) {
      $('#workspace').innerHTML = '<div class="card empty"><strong>No pudimos conectar con la tienda</strong>Comprueba que el servidor local esté en ejecución.<div class="inline-actions" style="justify-content:center"><button class="button" data-action="retry">Volver a intentar</button></div></div>';
      showError(error.message);
    }
  }
  function field(scope, key, label, options = {}) {
    const value = options.value !== undefined ? options.value : current(scope)?.[key] ?? '';
    const attrs = `data-scope="${scope}" data-field="${key}"${options.index !== undefined ? ` data-variant="${options.index}"` : ''}${options.required ? ' required' : ''}${options.readonly ? ' readonly' : ''}${options.disabled ? ' disabled' : ''}${options.placeholder ? ` placeholder="${escapeHTML(options.placeholder)}"` : ''}${options.min !== undefined ? ` min="${options.min}"` : ''}${options.step ? ` step="${options.step}"` : ''}${options.array ? ' data-array="true"' : ''}`;
    let control;
    if (options.type === 'textarea') control = `<textarea ${attrs} rows="${options.rows || 3}">${escapeHTML(options.array ? (Array.isArray(value) ? value.join('\n') : value) : value)}</textarea>`;
    else if (options.options) control = `<select ${attrs}>${options.options.map(option => `<option value="${escapeHTML(option.value)}"${String(option.value) === String(value) ? ' selected' : ''}>${escapeHTML(option.label)}</option>`).join('')}</select>`;
    else control = `<input type="${options.type || 'text'}" ${attrs} value="${escapeHTML(value)}">`;
    return `<label class="field${options.full ? ' full' : ''}"><span>${escapeHTML(label)}${options.required ? ' <span aria-hidden="true">*</span>' : ''}</span>${control}${options.hint ? `<small>${escapeHTML(options.hint)}</small>` : ''}</label>`;
  }
  function check(scope, key, label, options = {}) {
    const value = options.value !== undefined ? options.value : current(scope)?.[key];
    return `<label class="check"><input type="checkbox" data-scope="${scope}" data-field="${key}"${options.index !== undefined ? ` data-variant="${options.index}"` : ''}${value ? ' checked' : ''}>${escapeHTML(label)}</label>`;
  }
  function section(title, body) { return `<section class="form-section"><h3>${title}</h3>${body}</section>`; }
  function imageControl(scope, key, label) {
    const value = current(scope)?.[key] || '';
    return `<div class="image-control"><div class="cover-layout"><div data-preview="${scope}:${key}"><img class="cover-preview"${value && imageSafe(value) ? ` src="${escapeHTML(imageURL(value))}"` : ' hidden'} alt="Vista previa de ${escapeHTML(label.toLowerCase())}"><div class="cover-preview image-empty"${value ? ' hidden' : ''}>Sin imagen</div></div><div>${field(scope,key,label,{placeholder:'assets/imagen.jpg o https://…'})}<div class="image-actions"><button type="button" class="button" data-action="upload-image" data-scope="${scope}" data-key="${key}">Subir imagen</button><button type="button" class="button" data-action="choose-image" data-scope="${scope}" data-key="${key}">Biblioteca</button>${value ? `<button type="button" class="button subtle" data-action="remove-image" data-scope="${scope}" data-key="${key}">Quitar</button>` : ''}</div><p class="hint">JPG, PNG, WebP o GIF · Hasta 8 MB</p></div></div></div>`;
  }
  function productMatches(product) {
    const search = state.search.toLocaleLowerCase('es');
    if (search && !`${product.name} ${product.id} ${product.description || ''}`.toLocaleLowerCase('es').includes(search)) return false;
    if (state.filter === 'offer') return hasOffer(product);
    if (state.filter === 'no-offer') return !hasOffer(product);
    if (state.filter === 'hidden') return !product.visible;
    if (state.filter === 'available') return isAvailable(product);
    if (state.filter === 'unavailable') return !isAvailable(product);
    if (state.filter === 'featured') return product.featured;
    if (state.filter.startsWith('category:')) return product.category === state.filter.slice(9) || product.categories.includes(state.filter.slice(9));
    return true;
  }
  function renderProductRows() {
    const products = [...state.draft.products].sort((a,b) => a.order - b.order).filter(productMatches);
    const rows = products.map(product => {
      const category = state.draft.categories.find(item => item.id === product.category);
      const range = priceRange(product), available = isAvailable(product);
      const displayedPrice = money(range.min) + (range.max > range.min ? ' – ' + money(range.max) : '');
      return `<tr class="${String(product.id) === String(state.selected.product) ? 'selected' : ''}"><td><div class="product-cell">${product.image ? `<img class="thumb" src="${escapeHTML(imageURL(product.image))}" alt="" loading="lazy">` : '<span class="thumb image-empty">—</span>'}<div><button type="button" class="product-name" data-action="select-product" data-id="${product.id}">${escapeHTML(product.name || 'Producto sin nombre')}</button><div class="product-meta">${escapeHTML(category?.name || 'Sin categoría')} · #${product.id}</div></div></div></td><td class="price-cell">${displayedPrice}${!variantsOf(product).length && onSale(product) ? `<del>${money(product.price)}</del>` : ''}</td><td class="status-col"><span class="badge ${!product.visible ? 'hidden' : !available ? 'unavailable' : ''}">${!product.visible ? 'Oculto' : !available ? 'Agotado' : 'Visible'}</span></td></tr>`;
    }).join('');
    const body = $('#product-rows');
    if (body) body.innerHTML = rows || '<tr><td colspan="3"><div class="empty">No hay productos con estos filtros.</div></td></tr>';
    const count = $('#product-count');
    if (count) count.textContent = `${products.length} de ${state.draft.products.length} productos · Selecciona uno para editar`;
  }
  function renderProducts() {
    const offers = state.view === 'offers';
    const filters = [{value:'all',label:'Todos los productos'},{value:'offer',label:'Con oferta'},{value:'no-offer',label:'Sin oferta'},...(!offers ? [{value:'hidden',label:'Ocultos'},{value:'available',label:'Disponibles'},{value:'unavailable',label:'Agotados'},{value:'featured',label:'Destacados'},...state.draft.categories.map(category => ({value:'category:'+category.id,label:category.name}))] : [])];
    $('#workspace').innerHTML = `<div class="intro"><div><h2>${offers ? 'Precios que destacan' : 'Tu catálogo, al día'}</h2><p>${offers ? 'Edita el precio habitual y el de oferta. Los cambios se publican al guardar.' : 'Organiza tus productos, actualiza sus imágenes y decide qué mostrar.'}</p></div><button type="button" class="button primary" data-action="add-product">+ Nuevo producto</button></div><div class="split-layout"><section class="card" aria-label="Catálogo de productos"><div class="filters"><label class="search-field"><span aria-hidden="true">⌕</span><input type="search" id="product-search" aria-label="Buscar por nombre o ID" placeholder="Buscar producto…" value="${escapeHTML(state.search)}"></label><select id="product-filter" aria-label="Filtrar productos">${filters.map(filter => `<option value="${escapeHTML(filter.value)}"${state.filter === filter.value ? ' selected' : ''}>${escapeHTML(filter.label)}</option>`).join('')}</select></div><div class="table-scroll"><table><thead><tr><th>Producto</th><th>Precio</th><th class="status-col">Estado</th></tr></thead><tbody id="product-rows"></tbody></table></div><div class="list-footer" id="product-count"></div></section><section class="card" id="product-editor" aria-label="Editor del producto"></section></div>`;
    renderProductRows();
    renderProductEditor();
  }
  function renderProductEditor() {
    const product = current('product');
    if (!product) { $('#product-editor').innerHTML = '<div class="empty"><strong>Tu siguiente producto empieza aquí</strong>Crea un producto para añadirlo a tu tienda.</div>'; return; }
    const categoryOptions = [{value:'',label:'Selecciona una categoría'},...state.draft.categories.map(category => ({value:category.id,label:category.name}))];
    if (product.category && !categoryOptions.some(option => option.value === product.category)) categoryOptions.push({value:product.category,label:product.category});
    const categoryChecks = state.draft.categories.map(category => `<label class="check"><input type="checkbox" data-category="${escapeHTML(category.id)}"${(product.categories || []).includes(category.id) ? ' checked' : ''}>${escapeHTML(category.name)}</label>`).join('');
    const suggestions = state.draft.categories.find(category => category.id === product.category)?.subs || [];
    const subOptions = [{value:'',label:'Sin subcategoría'},...unique([...suggestions,product.sub]).map(sub => ({value:sub,label:sub}))];
    const gallery = `<div class="gallery-strip">${(product.gallery || []).map((url,index) => `<div class="gallery-photo"><img src="${escapeHTML(imageURL(url))}" alt="Imagen adicional ${index+1}"><button type="button" data-action="remove-gallery" data-index="${index}" aria-label="Quitar imagen adicional ${index+1}">×</button></div>`).join('')}</div><div class="inline-actions"><button type="button" class="button small" data-action="upload-gallery">+ Subir fotos</button><button type="button" class="button small" data-action="choose-gallery">Añadir de biblioteca</button></div>${field('product','gallery','URLs de la galería',{type:'textarea',array:true,rows:2,hint:'Una imagen por línea. Quitar una foto no elimina el archivo de la biblioteca.'})}`;
    const variants = (product.variants || []).map((variant,index) => `<div class="variant"><div class="variant-top"><span class="hint">ID: ${escapeHTML(variant.id)}</span><button type="button" class="button small subtle" data-action="remove-variant" data-index="${index}" aria-label="Quitar variante ${escapeHTML(variant.label || index+1)}">Quitar</button></div>${field('product','label','Nombre / duración',{value:variant.label,index,required:true,placeholder:'1 mes · 1 perfil'})}<div class="form-grid">${field('product','price','Precio habitual',{value:variant.price,index,type:'number',min:0,step:'0.01',required:true})}${field('product','salePrice','Precio de oferta',{value:variant.salePrice ?? '',index,type:'number',min:0,step:'0.01',hint:'Vacío = sin oferta'})}</div><div class="check-grid">${check('product','available','Disponible',{value:variant.available,index})}</div></div>`).join('');
    $('#product-editor').innerHTML = `<div class="editor-head"><div><h2>${escapeHTML(product.name || 'Nuevo producto')}</h2><p>EDITANDO PRODUCTO · #${product.id}</p></div><div class="editor-actions"><button type="button" class="button small" data-action="duplicate-product">Duplicar</button><button type="button" class="button small subtle" data-action="toggle-product">${product.visible ? 'Ocultar' : 'Mostrar'}</button></div></div><div class="editor-form">${section('Información del producto',field('product','name','Nombre del producto',{required:true})+field('product','description','Descripción breve',{type:'textarea',rows:2})+field('product','content','Información y condiciones',{type:'textarea',rows:4,hint:'Describe la entrega, las condiciones de uso y lo que incluye.'}))}${section('Precios y ofertas',`${variantsOf(product).length ? '<p class="hint">Este producto vende por variantes. El precio y la oferta de cada plan se editan en Variantes y duraciones. El precio habitual general se usa al crear nuevos planes.</p>' : ''}<div class="form-grid">${field('product','price','Precio habitual ('+state.draft.settings.currency+')',{type:'number',min:0,step:'0.01',required:true})}${field('product','salePrice','Precio de oferta',{type:'number',value:product.salePrice ?? '',disabled:variantsOf(product).length>0,min:0,step:'0.01',hint:'Debe ser menor al habitual. Vacío = sin oferta.'})}${field('product','max','Precio máximo del rango',{type:'number',disabled:variantsOf(product).length>0,min:0,step:'0.01',hint:'0 para usar un precio único.'})}${field('product','offerLabel','Etiqueta de la oferta',{placeholder:'Ej.: Oferta especial'})}</div>${product.salePrice != null || product.offerLabel ? '<div class="inline-actions"><button type="button" class="button small" data-action="clear-offer">Quitar oferta del producto</button></div>' : ''}`)}${section('Imágenes',imageControl('product','image','Imagen principal')+gallery)}${section('Categorías y orden',field('product','category','Categoría principal',{options:categoryOptions,required:true})+`<div class="check-grid">${categoryChecks}</div><p class="hint">Puedes mostrar un producto en varias categorías. La principal también se incluye.</p>`+field('product','sub','Subcategoría principal',{options:subOptions})+field('product','subs','Todas las subcategorías',{type:'textarea',array:true,rows:2,hint:'Un nombre por línea. Deben existir en las categorías elegidas.'})+field('product','order','Orden en la tienda',{type:'number',min:0,step:'1',hint:'Los números menores aparecen primero.'})+`<div class="check-grid">${check('product','visible','Visible en la tienda')}${check('product','available','Disponible')}${check('product','featured','Destacado en inicio')}</div>`)}${section('Variantes y duraciones',`<p class="hint">Ofrece diferentes duraciones o planes, cada uno con su precio y disponibilidad.</p>${variants}<button type="button" class="button small" data-action="add-variant">+ Añadir variante</button>`)}${section('Eliminar producto',`<p class="hint">La eliminación se hará permanente al guardar los cambios.</p><button type="button" class="button danger small" data-action="delete-product">Eliminar producto</button>`)}</div>`;
  }
  function renderCategories() {
    const category = current('category');
    const rows = [...state.draft.categories].sort((a,b) => a.order-b.order).map(item => `<button type="button" class="entity-row ${item.id === state.selected.category ? 'selected' : ''}" data-action="select-category" data-id="${escapeHTML(item.id)}">${item.image ? `<img class="thumb" src="${escapeHTML(imageURL(item.image))}" alt="">` : '<span class="thumb image-empty">—</span>'}<span><strong>${escapeHTML(item.name || 'Nueva categoría')}</strong><small>${item.subs.length} subcategorías · Orden ${item.order}</small></span><span class="badge ${item.visible ? '' : 'hidden'}">${item.visible ? 'Visible' : 'Oculta'}</span></button>`).join('');
    const referenceCount = category ? state.draft.products.filter(product => product.category === category.id || product.categories.includes(category.id)).length : 0;
    $('#workspace').innerHTML = `<div class="intro"><div><h2>Una tienda fácil de explorar</h2><p>Organiza las categorías y sus subcategorías en el menú y en el inicio.</p></div><button type="button" class="button primary" data-action="add-category">+ Nueva categoría</button></div><div class="split-layout"><section class="card row-list" aria-label="Categorías">${rows || '<div class="empty">Todavía no hay categorías.</div>'}</section><section class="card">${category ? `<div class="editor-head"><div><h2>${escapeHTML(category.name || 'Nueva categoría')}</h2><p>${referenceCount} productos asociados</p></div></div><div class="editor-form">${section('Información',field('category','name','Nombre',{required:true})+field('category','id','Identificador',{readonly:true,hint:'El identificador se conserva para mantener los enlaces.'})+field('category','order','Orden',{type:'number',min:0,step:'1'})+`<div class="check-grid">${check('category','visible','Visible en la tienda')}</div>`)}${section('Imagen de categoría',imageControl('category','image','Imagen'))}${section('Subcategorías',field('category','subs','Subcategorías disponibles',{type:'textarea',array:true,rows:6,hint:'Un nombre por línea. Evita quitar una subcategoría asignada a un producto.'})+field('category','homeSubs','Subcategorías en el inicio',{type:'textarea',array:true,rows:4,hint:'Un nombre por línea, en el orden deseado. Deben existir en la lista superior.'}))}${section('Eliminar categoría',`<p class="hint">${referenceCount ? 'Esta categoría está asignada a productos. Puedes ocultarla o cambiar primero sus categorías.' : 'La eliminación se hará permanente al guardar.'}</p><button type="button" class="button danger small" data-action="delete-category"${referenceCount ? ' disabled' : ''}>Eliminar categoría</button>`)}</div>` : '<div class="empty">Crea una categoría para comenzar.</div>'}</section></div>`;
  }
  function renderBanners() {
    const banner = current('banner');
    const rows = [...state.draft.banners].sort((a,b)=>a.order-b.order).map(item => `<button type="button" class="entity-row ${item.id === state.selected.banner ? 'selected' : ''}" data-action="select-banner" data-id="${escapeHTML(item.id)}">${item.image ? `<img class="banner-thumb" src="${escapeHTML(imageURL(item.image))}" alt="">` : '<span class="banner-thumb image-empty">—</span>'}<span><strong>${escapeHTML(item.title || 'Nuevo banner')}</strong><small>Orden ${item.order}</small></span><span class="badge ${item.visible ? '' : 'hidden'}">${item.visible ? 'Visible' : 'Oculto'}</span></button>`).join('');
    $('#workspace').innerHTML = `<div class="intro"><div><h2>La primera impresión de tu tienda</h2><p>Personaliza las imágenes y los mensajes del banner de inicio.</p></div><button type="button" class="button primary" data-action="add-banner">+ Nuevo banner</button></div><div class="split-layout"><section class="card row-list" aria-label="Banners">${rows || '<div class="empty">Todavía no hay banners.</div>'}</section><section class="card">${banner ? `<div class="editor-head"><div><h2>Editar banner</h2><p>${escapeHTML(banner.id)}</p></div></div><div class="editor-form">${section('Contenido',field('banner','title','Título',{required:true})+field('banner','description','Descripción',{type:'textarea',rows:4})+field('banner','id','Identificador',{readonly:true}))}${section('Imagen',imageControl('banner','image','Imagen del banner'))}${section('Botón y visibilidad',field('banner','buttonText','Texto del botón')+field('banner','buttonLink','Destino del botón',{placeholder:'#productos o https://…',hint:'Usa un enlace completo o una sección como #productos.'})+field('banner','order','Orden',{type:'number',min:0,step:'1'})+`<div class="check-grid">${check('banner','visible','Visible en el inicio')}</div>`)}<button type="button" class="button danger small" data-action="delete-banner">Eliminar banner</button></div>` : '<div class="empty">Crea un banner para comenzar.</div>'}</section></div>`;
  }
  function settingsCard(title, body, wide = false) { return `<section class="card${wide ? ' wide' : ''}"><div class="card-head"><h2>${title}</h2></div><div class="card-body">${body}</div></section>`; }
  function renderAppearance() {
    const f = (key,label,options) => field('settings',key,label,options);
    $('#workspace').innerHTML = `<div class="intro"><div><h2>Hazla tuya</h2><p>Actualiza la identidad, los colores y los textos que ven tus clientes.</p></div></div><div class="settings-grid">${settingsCard('Identidad de la tienda',section('Marca',f('name','Nombre de la tienda',{required:true})+f('currency','Moneda',{options:[{value:'USD',label:'USD · Dólar estadounidense'},{value:'PEN',label:'PEN · Sol peruano'},{value:'EUR',label:'EUR · Euro'}],hint:'Cambia el símbolo de los precios. Los importes no se convierten automáticamente.'}))+section('Logotipo',imageControl('settings','logo','Logo'))+section('Icono del navegador',imageControl('settings','favicon','Favicon')))}${settingsCard('Colores y secciones',section('Paleta de colores',`<div class="form-grid">${f('accentColor','Color principal',{type:'color'})}${f('backgroundColor','Fondo de la tienda',{type:'color'})}${f('headerColor','Cabecera',{type:'color'})}${f('footerColor','Pie de página',{type:'color'})}</div><p class="hint">El color principal se aplica a botones y detalles de la tienda.</p>`)+section('Secciones del inicio',`<div class="check-grid">${check('settings','showCategories','Mostrar categorías')}${check('settings','showFeatured','Mostrar destacados')}${check('settings','showAbout','Mostrar nosotros')}</div>`)+section('Títulos de sección',f('categoryTitle','Título de categorías')+f('featuredTitle','Título de productos destacados')))}${settingsCard('Título y descripción de la página',f('pageTitle','Título del navegador',{required:true})+f('metaDescription','Descripción para buscadores',{type:'textarea',rows:3,hint:'Resume qué ofrece tu tienda.'}))}${settingsCard('Nosotros',f('aboutTitle','Etiqueta de la sección')+f('aboutHeading','Título principal')+f('aboutText','Texto de presentación',{type:'textarea',rows:6}))}${settingsCard('Pie de página',f('footerText','Texto del pie',{type:'textarea',rows:5})+f('copyright','Texto de copyright'))}${settingsCard('Métodos de pago',imageControl('settings','paymentImage','Imagen de métodos de pago'))}</div>`;
  }
  function renderContact() {
    const f = (key,label,options) => field('settings',key,label,options);
    $('#workspace').innerHTML = `<div class="intro"><div><h2>Mantén la conversación abierta</h2><p>Configura los datos de contacto, las redes y los destinos de los botones.</p></div></div><div class="settings-grid">${settingsCard('Página de contacto',f('contactTitle','Título de contacto')+f('contactText','Texto de contacto',{type:'textarea',rows:5})+`<div class="form-grid">${f('phone','Teléfono principal',{type:'tel'})}${f('phoneSecondary','Teléfono secundario',{type:'tel'})}</div>`)}${settingsCard('WhatsApp',f('whatsapp','Enlace principal de WhatsApp',{placeholder:'https://wa.me/519…'})+f('whatsappSecondary','Enlace secundario de WhatsApp',{placeholder:'https://wa.me/519…'})+f('distributorUrl','Enlace para distribuidores',{placeholder:'https://…'})+`<p class="hint">Usa enlaces completos. El principal también se usa para las consultas de compra.</p>`)}${settingsCard('Redes y comunidades',f('instagram','Instagram',{placeholder:'https://www.instagram.com/…'})+f('tiktok','TikTok',{placeholder:'https://www.tiktok.com/@…'})+f('whatsappCommunity','Comunidad de WhatsApp',{placeholder:'https://chat.whatsapp.com/…'})+f('telegramCommunity','Comunidad de Telegram',{placeholder:'https://t.me/…'}))}${settingsCard('Acceso de clientes',f('accountUrl','Enlace de acceso / registro',{placeholder:'https://…',hint:'Destino del botón de acceso de la tienda.'}))}</div>`;
  }
  function allMedia() {
    const known = new Map(state.media.map(item => [item.url,item]));
    const store = state.draft;
    const references = [...store.products.flatMap(item => [item.image,...item.gallery]),...store.categories.map(item=>item.image),...store.banners.map(item=>item.image),store.settings.logo,store.settings.favicon,store.settings.paymentImage];
    for (const url of references) if (url && !known.has(url)) known.set(url,{url,name:url.split('/').pop().split('?')[0],size:null,type:'Imagen de la tienda'});
    return [...known.values()];
  }
  function mediaHTML(picker) {
    const media = allMedia();
    return `${state.mediaError ? `<div class="dialog-error">${escapeHTML(state.mediaError)} <button type="button" class="button small" data-action="refresh-media">Reintentar</button></div>` : ''}<div class="media-toolbar"><p class="muted">${state.mediaLoading ? 'Cargando biblioteca…' : `${media.length} imágenes disponibles`}<br>Los archivos subidos se conservan en este equipo.</p><button type="button" class="button primary" data-action="upload-media"${state.uploads ? ' disabled' : ''}>+ Subir imágenes</button></div><div class="media-grid">${media.map(item => `<button type="button" class="media-tile" data-action="${picker ? 'pick-media' : 'inspect-media'}" data-url="${escapeHTML(item.url)}" title="${escapeHTML(picker ? 'Usar ' + item.name : 'Ver ' + item.name)}"><img src="${escapeHTML(imageURL(item.url))}" alt="${escapeHTML(item.name)}" loading="lazy"><span class="media-info">${escapeHTML(item.name)}<small>${item.size ? `${Math.ceil(item.size/1024)} KB · ` : ''}${picker ? 'Seleccionar imagen' : 'Ver imagen'}</small></span></button>`).join('') || '<div class="empty">Sube tu primera imagen.</div>'}</div>`;
  }
  function renderMedia() {
    $('#workspace').innerHTML = `<div class="intro"><div><h2>Tu biblioteca de imágenes</h2><p>Sube una vez y reutiliza tus fotos en productos, categorías o banners.</p></div></div><section class="card"><div class="card-body">${mediaHTML(false)}</div></section>`;
    if (!state.mediaLoaded && !state.mediaLoading) loadMedia();
  }
  async function loadMedia() {
    state.mediaLoading = true;
    state.mediaError = '';
    try { const result = await api('/api/admin/media'); state.media = result.items || []; state.mediaLoaded = true; }
    catch (error) { state.mediaError = error.message; state.mediaLoaded = true; }
    finally {
      state.mediaLoading = false;
      if (state.view === 'media') renderMedia();
      if ($('#media-dialog').open) $('#media-dialog-body').innerHTML = mediaHTML(true);
    }
  }
  function render() {
    if (!state.draft) return;
    $('#page-title').textContent = titles[state.view];
    document.title = titles[state.view] + ' · Administración';
    document.querySelectorAll('[data-view]').forEach(button => { const active = button.dataset.view === state.view; button.classList.toggle('active',active); if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); });
    if (state.view === 'products' || state.view === 'offers') renderProducts();
    else if (state.view === 'categories') renderCategories();
    else if (state.view === 'banners') renderBanners();
    else if (state.view === 'appearance') renderAppearance();
    else if (state.view === 'contact') renderContact();
    else renderMedia();
    updateStatus();
  }
  function updatePreview(scope,key,value) {
    const preview = document.querySelector(`[data-preview="${scope}:${key}"]`);
    if (!preview) return;
    const valid = Boolean(value) && imageSafe(value);
    const img = preview.querySelector('img');
    img.hidden = !valid;
    preview.querySelector('.image-empty').hidden = valid;
    if (valid) img.src = imageURL(value);
  }
  function bindInput(event) {
    const target = event.target;
    if (target.id === 'product-search') { state.search = target.value; renderProductRows(); return; }
    if (target.id === 'product-filter') { state.filter = target.value; renderProductRows(); return; }
    if (target.dataset.category) {
      const product = current('product');
      product.categories = unique([...document.querySelectorAll('[data-category]:checked')].map(input=>input.dataset.category));
      if (product.category && !product.categories.includes(product.category)) {
        product.category = product.categories[0] || '';
        const primary = document.querySelector('[data-scope="product"][data-field="category"]');
        if (primary) primary.value = product.category;
      }
      syncProductClassification(product);
      markDirty(); renderProductRows(); return;
    }
    if (!target.dataset.field || target.readOnly) return;
    const {scope,field:key,variant:index} = target.dataset;
    const object = current(scope);
    if (!object) return;
    const destination = index !== undefined ? object.variants[Number(index)] : object;
    let value = target.type === 'checkbox' ? target.checked : target.type === 'number' ? target.value === '' ? key === 'salePrice' ? null : '' : Number(target.value) : target.dataset.array ? lines(target.value) : target.value;
    destination[key] = value;
    if (scope === 'product' && index === undefined && key === 'category') {
      object.categories = unique([value,...object.categories]);
      document.querySelectorAll('[data-category]').forEach(input => input.checked = object.categories.includes(input.dataset.category));
      syncProductClassification(object);
    }
    if (scope === 'product' && index === undefined && key === 'sub' && value) {
      object.subs = unique([value,...object.subs]);
      document.querySelector('[data-scope="product"][data-field="subs"]').value = object.subs.join('\n');
    }
    if (scope === 'product' && index === undefined && key === 'subs' && object.sub && !value.includes(object.sub)) {
      object.sub = '';
      document.querySelector('[data-scope="product"][data-field="sub"]').value = '';
    }
    if (['image','logo','favicon','paymentImage'].includes(key)) updatePreview(scope,key,value);
    if (scope === 'product') renderProductRows();
    markDirty();
  }
  function syncProductClassification(product) {
    const allowed = state.draft.categories.find(category=>category.id===product.category)?.subs || [];
    if (!allowed.includes(product.sub)) product.sub = '';
    const select = document.querySelector('[data-scope="product"][data-field="sub"]');
    if (select) select.innerHTML = '<option value="">Sin subcategoría</option>' + allowed.map(sub=>`<option value="${escapeHTML(sub)}"${sub===product.sub?' selected':''}>${escapeHTML(sub)}</option>`).join('');
  }
  function validateStore(store) {
    if (!store.settings.name.trim()) return 'Escribe el nombre de la tienda en Apariencia y textos.';
    if (!store.settings.pageTitle.trim()) return 'Escribe el título del navegador en Apariencia y textos.';
    const validatePrice = (item,label) => {
      if (!isMoneyAmount(item.price)) return `Revisa el precio habitual de ${label}: usa un importe válido con un máximo de dos decimales.`;
      if (item.salePrice !== null && item.salePrice !== undefined && (!isMoneyAmount(item.salePrice) || item.salePrice >= item.price)) return `Revisa la oferta de ${label}: usa hasta dos decimales y un importe menor al precio habitual. Deja el precio de oferta vacío para quitarla.`;
    };
    for (const product of store.products) {
      if (!product.name.trim()) return `El producto #${product.id} necesita un nombre.`;
      const priceError = validatePrice(product,`«${product.name}»`);
      if (priceError) return priceError;
      if (!isMoneyAmount(product.max) || (product.max > 0 && product.max < product.price)) return `El precio máximo de «${product.name}» debe tener hasta dos decimales y ser 0 o igual/mayor al habitual.`;
      if (!Number.isInteger(product.order) || product.order < 0) return `El orden de «${product.name}» debe ser un entero igual o mayor que cero.`;
      if (!product.category || !store.categories.some(category=>category.id===product.category)) return `Elige una categoría principal para «${product.name}».`;
      if (!product.categories.includes(product.category)) return `Incluye la categoría principal entre las categorías de «${product.name}».`;
      if (product.categories.some(id=>!store.categories.some(category=>category.id===id))) return `«${product.name}» tiene una categoría que ya no existe.`;
      if (product.sub && (!product.subs.includes(product.sub) || !store.categories.find(category=>category.id===product.category).subs.includes(product.sub))) return `La subcategoría principal de «${product.name}» debe pertenecer a su categoría principal y estar incluida en todas sus subcategorías.`;
      const allowedSubs = unique(store.categories.filter(category => product.categories.includes(category.id) || category.id === product.category).flatMap(category=>category.subs));
      if (unique([product.sub,...product.subs]).some(sub=>!allowedSubs.includes(sub))) return `Una subcategoría de «${product.name}» no existe en las categorías elegidas. Revisa las subcategorías o añádela en Categorías.`;
      if (![product.image,...product.gallery].every(imageSafe)) return `Revisa las imágenes de «${product.name}». Usa la biblioteca, una ruta assets/ o uploads/, o un enlace https://.`;
      for (const variant of product.variants) {
        if (!variant.label.trim()) return `Escribe un nombre para cada variante de «${product.name}».`;
        const variantError = validatePrice(variant,`«${product.name}», variante «${variant.label}»`);
        if (variantError) return variantError;
      }
    }
    for (const category of store.categories) {
      if (!category.name.trim()) return 'Todas las categorías necesitan un nombre.';
      if (!Number.isInteger(category.order) || category.order < 0) return `Revisa el orden de la categoría «${category.name}».`;
      if (!imageSafe(category.image)) return `Revisa la imagen de la categoría «${category.name}».`;
      if (category.homeSubs.some(sub=>!category.subs.includes(sub))) return `Las subcategorías de inicio de «${category.name}» deben existir en sus subcategorías disponibles.`;
    }
    for (const banner of store.banners) {
      if (!banner.title.trim()) return 'Todos los banners necesitan un título.';
      if (!Number.isInteger(banner.order) || banner.order < 0) return `Revisa el orden del banner «${banner.title}».`;
      if (!imageSafe(banner.image)) return `Revisa la imagen del banner «${banner.title}».`;
      if (!linkSafe(banner.buttonLink)) return `Revisa el enlace del banner «${banner.title}». Usa una URL completa o una sección como #productos.`;
    }
    for (const key of ['logo','favicon','paymentImage']) if (!imageSafe(store.settings[key])) return 'Revisa las imágenes de Apariencia y textos. Usa la biblioteca o un enlace https://.';
    for (const key of ['whatsapp','whatsappSecondary','instagram','tiktok','whatsappCommunity','telegramCommunity','distributorUrl','accountUrl']) if (!linkSafe(store.settings[key])) return 'Revisa los enlaces de Contacto. Usa enlaces completos con https://.';
    for (const key of ['accentColor','backgroundColor','headerColor','footerColor']) if (!/^#[\da-f]{6}$/i.test(store.settings[key])) return 'Revisa los colores de Apariencia y textos.';
    return '';
  }
  async function save() {
    if (!state.dirty || state.busy || state.uploads) return;
    clearError();
    const error = validateStore(state.draft);
    if (error) { showError(error); return; }
    const invalid = document.querySelector('#workspace :invalid');
    if (invalid) { invalid.reportValidity(); return; }
    state.busy = true;
    $('#workspace').inert = true;
    $('#admin-nav').inert = true;
    updateStatus();
    try {
      const result = await api('/api/admin/store',{method:'PUT',body:JSON.stringify(state.draft)});
      setStore(result);
      broadcastRevision();
      render();
      notify('Cambios guardados. Tu tienda ya está actualizada.');
    } catch (error) { showError(error.message, error.status === 409); }
    finally { state.busy = false; $('#workspace').inert = false; $('#admin-nav').inert = false; updateStatus(); }
  }
  async function restore() {
    if (state.busy || state.uploads) return;
    if (!await confirmChange(`¿Restaurar la versión anterior de la tienda?${state.dirty ? ' Se descartarán los cambios pendientes de este panel.' : ''} La versión actual se conservará como copia anterior.`)) return;
    clearError();
    state.busy = true; $('#workspace').inert = true; $('#admin-nav').inert = true; updateStatus();
    try {
      const result = await api('/api/admin/restore',{method:'POST',body:JSON.stringify({revision:state.store.revision})});
      setStore(result); broadcastRevision(); render(); notify('Se restauró la versión anterior.');
    } catch (error) { showError(error.message, error.status === 409); }
    finally { state.busy = false; $('#workspace').inert = false; $('#admin-nav').inert = false; updateStatus(); }
  }
  function chooseFiles(multiple,callback) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp,image/gif'; input.multiple = multiple;
    input.className = 'upload-input';
    document.body.append(input);
    input.addEventListener('change',async () => { const files = [...input.files]; input.remove(); if (files.length) await uploadFiles(files,callback); },{once:true});
    input.addEventListener('cancel',()=>input.remove(),{once:true});
    input.click();
  }
  async function uploadFiles(files,callback) {
    clearError();
    const allowed = ['image/jpeg','image/png','image/webp','image/gif'];
    const bad = files.find(file=>!allowed.includes(file.type) || file.size > 8*1024*1024 || file.size === 0);
    if (bad) { const message = `No se pudo subir «${bad.name}». Elige una imagen JPG, PNG, WebP o GIF de hasta 8 MB.`; showError(message); if ($('#media-dialog').open) {state.mediaError=message;$('#media-dialog-body').innerHTML=mediaHTML(true);} return; }
    state.uploads++; updateStatus();
    try {
      let count = 0;
      for (const file of files) {
        const result = await api('/api/admin/upload',{method:'POST',body:file,headers:{'Content-Type':file.type,'X-File-Name':encodeURIComponent(file.name)}});
        if (!result.url) throw new Error('La imagen se subió pero no se recibió su ubicación. Actualiza la biblioteca para comprobarlo.');
        state.media.unshift(result); count++;
        if (callback) { callback(result.url); markDirty(); }
      }
      state.mediaError = '';
      notify(`${count === 1 ? 'Imagen subida' : count + ' imágenes subidas'}${callback ? '. Guarda los cambios para mostrarla en la tienda.' : ' a la biblioteca.'}`);
    } catch (error) { showError(error.message); if ($('#media-dialog').open) state.mediaError = error.message; }
    finally {
      state.uploads--; render();
      if ($('#media-dialog').open) $('#media-dialog-body').innerHTML = mediaHTML(true);
      updateStatus();
    }
  }
  function openMedia(callback) {
    state.mediaPicker = callback;
    $('#media-dialog-body').innerHTML = mediaHTML(true);
    $('#media-dialog').showModal();
    if (!state.mediaLoaded && !state.mediaLoading) loadMedia();
  }
  function addProduct() {
    const id = allocateProductId();
    const category = state.draft.categories[0]?.id || '';
    state.draft.products.push({id,name:'',price:0,max:0,salePrice:null,offerLabel:'',available:true,visible:false,featured:false,image:'',gallery:[],description:'',content:'',category,categories:category?[category]:[],sub:'',subs:[],order:Math.max(-1,...state.draft.products.map(product=>product.order))+1,variants:[]});
    state.selected.product = id; state.search=''; state.filter='all'; markDirty(); renderProducts();
    document.querySelector('[data-scope="product"][data-field="name"]')?.focus();
  }
  async function deleteEntity(scope) {
    const item = current(scope);
    if (!item) return;
    if (scope === 'category' && state.draft.products.some(product=>product.category===item.id || product.categories.includes(item.id))) {showError('Esta categoría todavía está asignada a productos. Puedes ocultarla o cambiar primero sus categorías.');return;}
    if (!await confirmChange(`¿Eliminar ${scope==='product'?'el producto':scope==='category'?'la categoría':'el banner'} «${item.name || item.title || item.id}»? Se eliminará de la tienda al guardar los cambios.`)) return;
    const key = {product:'products',category:'categories',banner:'banners'}[scope];
    state.draft[key] = state.draft[key].filter(entity=>entity.id!==item.id);
    state.selected[scope] = state.draft[key][0]?.id ?? null;
    markDirty(); render();
  }
  async function handleAction(button) {
    const {action,scope,key,id,index,url} = button.dataset;
    const product = state.draft ? current('product') : null;
    if (action === 'retry') {clearError();initialize();return;}
    if (action === 'export-draft') {
      const objectURL = URL.createObjectURL(new Blob([JSON.stringify(state.draft,null,2)],{type:'application/json'}));
      const link = document.createElement('a');link.href=objectURL;link.download=`gavidia-borrador-v${state.draft.revision}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(objectURL),1000);return;
    }
    if (action === 'close-media') {$('#media-dialog').close();return;}
    if (action === 'select-product') {state.selected.product=Number(id);renderProductRows();renderProductEditor();return;}
    if (action === 'select-category') {state.selected.category=id;renderCategories();return;}
    if (action === 'select-banner') {state.selected.banner=id;renderBanners();return;}
    if (action === 'add-product') return addProduct();
    if (action === 'duplicate-product') {const copy=clone(product);copy.id=allocateProductId();copy.name += ' (copia)';copy.visible=false;copy.order=Math.max(-1,...state.draft.products.map(item=>item.order))+1;copy.variants=copy.variants.map(variant=>({...variant,id:newId('var')}));state.draft.products.push(copy);state.selected.product=copy.id;state.search='';state.filter='all';markDirty();render();return;}
    if (action === 'toggle-product') {product.visible=!product.visible;markDirty();renderProducts();return;}
    if (action === 'delete-product') return deleteEntity('product');
    if (action === 'clear-offer') {product.salePrice=null;product.offerLabel='';markDirty();renderProducts();return;}
    if (action === 'add-variant') {product.variants.push({id:newId('var'),label:'',price:product.price,salePrice:null,available:true});markDirty();renderProductRows();renderProductEditor();return;}
    if (action === 'remove-variant') {product.variants.splice(Number(index),1);markDirty();renderProductRows();renderProductEditor();return;}
    if (action === 'remove-gallery') {product.gallery.splice(Number(index),1);markDirty();renderProductEditor();return;}
    if (action === 'upload-gallery') return chooseFiles(true,image=>product.gallery=unique([...product.gallery,image]));
    if (action === 'choose-gallery') return openMedia(image=>product.gallery=unique([...product.gallery,image]));
    if (action === 'upload-image') {const item=current(scope);return chooseFiles(false,image=>item[key]=image);}
    if (action === 'choose-image') {const item=current(scope);return openMedia(image=>item[key]=image);}
    if (action === 'remove-image') {current(scope)[key]='';markDirty();render();return;}
    if (action === 'add-category') {const item={id:newId('categoria'),name:'',image:'',subs:[],homeSubs:[],visible:false,order:Math.max(-1,...state.draft.categories.map(category=>category.order))+1};state.draft.categories.push(item);state.selected.category=item.id;markDirty();renderCategories();document.querySelector('[data-scope="category"][data-field="name"]')?.focus();return;}
    if (action === 'delete-category') return deleteEntity('category');
    if (action === 'add-banner') {const item={id:newId('banner'),title:'',description:'',image:'',buttonText:'Ver productos',buttonLink:'#productos',visible:false,order:Math.max(-1,...state.draft.banners.map(banner=>banner.order))+1};state.draft.banners.push(item);state.selected.banner=item.id;markDirty();renderBanners();document.querySelector('[data-scope="banner"][data-field="title"]')?.focus();return;}
    if (action === 'delete-banner') return deleteEntity('banner');
    if (action === 'upload-media') return chooseFiles(true,null);
    if (action === 'refresh-media') return loadMedia();
    if (action === 'pick-media') {state.mediaPicker?.(url);markDirty();$('#media-dialog').close();render();return;}
    if (action === 'inspect-media') {window.open(imageURL(url),'_blank','noopener,noreferrer');return;}
  }
  document.addEventListener('input', bindInput);
  document.addEventListener('change', event => {if (event.target.tagName==='SELECT' || event.target.type==='checkbox') bindInput(event);});
  document.addEventListener('click',event => {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton && state.draft && !state.busy) {state.view=viewButton.dataset.view;state.search='';state.filter='all';clearError();render();return;}
    const actionButton = event.target.closest('[data-action]');
    if (actionButton && !actionButton.disabled && !state.busy) handleAction(actionButton).catch(error=>showError(error.message));
  });
  $('#save').addEventListener('click',save);
  $('#discard').addEventListener('click',async()=>{if (state.dirty && await confirmChange('¿Descartar todos los cambios pendientes y volver a la última versión guardada?')) {state.draft=clone(state.store);state.dirty=false;clearError();setStore(state.store);render();notify('Cambios pendientes descartados.');}});
  $('#restore').addEventListener('click',restore);
  $('#media-dialog').addEventListener('close',()=>state.mediaPicker=null);
  window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
  initialize();
})();
