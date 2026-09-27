# SUPER.INTELIGENICIA — tienda y administración local

Réplica del sitio observado el 25–26 de septiembre de 2026, con 90 productos iniciales, imágenes locales y un panel para administrar su contenido.

## Abrir la tienda

El repositorio contiene dos partes: la página pública preparada en `docs/` y la aplicación completa con el panel y su servidor en `dist/`, `server.mjs` y `lib/`.

Requiere Node.js 22 o posterior. No necesita instalar dependencias. Desde esta carpeta:

```sh
node server.mjs
```

- Tienda: http://127.0.0.1:4173/
- Administración: http://127.0.0.1:4173/admin

También puedes usar `npm start` si tienes npm. Mantén el servidor abierto mientras trabajas. Esta versión necesita su servidor: abrir `dist/index.html` directamente o subir solo `dist` a un alojamiento estático no permite administrar los datos.

## Qué puedes editar

- **Productos:** crear, duplicar, eliminar, mostrar u ocultar; nombre, descripciones, condiciones, categorías, orden, disponibilidad y destacados.
- **Fotos:** subir JPG, PNG, WebP y GIF de hasta 8 MB; cambiar la portada, añadir una galería y reutilizar imágenes desde la biblioteca.
- **Precios y ofertas:** precio habitual, precio rebajado y etiqueta de oferta. Los precios de oferta se reflejan en las fichas, búsqueda y carrito. Los importes admiten hasta dos decimales y el precio rebajado debe ser inferior al habitual.
- **Variantes:** planes o duraciones con su propio precio, oferta y disponibilidad. Cuando existen variantes, sus precios se usan al comprar; el precio general sirve como valor inicial al crear nuevos planes.
- **Categorías:** nombre, imagen, orden, subcategorías y visibilidad en la navegación. Una categoría asignada a productos debe reasignarse antes de eliminarla. Ocultarla retira sus enlaces, pero no oculta los productos; estos tienen su propio control de visibilidad.
- **Banners:** imágenes, títulos, descripciones, botones, enlaces, orden y visibilidad.
- **Apariencia y textos:** logo, favicon, colores, títulos, descripción de la página, presentación, pie, copyright, imagen de métodos de pago y secciones de inicio.
- **Contacto:** teléfonos, WhatsApp, redes, comunidades, distribuidor y enlace de acceso de clientes.
- **Moneda:** USD, PEN o EUR. Cambia la moneda mostrada; no convierte automáticamente los importes.

Selecciona un producto, modifica sus campos y pulsa **Guardar cambios**. Puedes editar varias secciones antes de guardar. Las fotos se suben a la biblioteca al seleccionarlas; su asignación a un producto se publica al guardar. Los productos nuevos y duplicados comienzan ocultos: activa **Visible en la tienda** cuando estén listos.

La tienda carga los datos guardados al abrirse y se actualiza al volver a su pestaña o cuando recibe un aviso de guardado del panel. Los productos ocultos, eliminados o agotados se retiran del carrito al actualizar el catálogo. Los favoritos y el carrito son propios de cada navegador.

## Guardado y copias

- `data/store.json`: contenido actual, persistente aunque cierres el navegador o reinicies el servidor.
- `data/store.backup.json`: versión anterior al último guardado. El botón **Restaurar versión anterior** permite recuperarla; la versión que reemplaza queda como copia anterior.
- `data/uploads/`: fotos subidas. Quitar una foto de un producto no borra su archivo de la biblioteca.
- `data/seed.json`: catálogo inicial, usado solo si no existe un catálogo guardado.

**Exportar copia JSON** descarga el contenido del catálogo. Las imágenes no se incluyen en ese JSON: para una copia completa conserva toda la carpeta `data` junto con `dist/assets`. Para trasladar la tienda, copia el proyecto completo con el servidor detenido. No reemplaces `store.json` mientras el servidor esté funcionando.

Si dos paneles editan a la vez, se impide sobrescribir una versión más reciente. El borrador se conserva en pantalla y puedes descargarlo antes de recargar y aplicar los cambios nuevamente.

## Acceso y alcance

El panel está diseñado para este equipo: el servidor solo admite conexiones locales y rechaza direcciones de escucha públicas. No necesita contraseña local. Las escrituras requieren sesión del navegador y token CSRF, y se validan imágenes, enlaces, precios y referencias. Para publicar una administración multiusuario harían falta autenticación y un despliegue específico; esta versión no está publicada.

El catálogo es independiente del sitio original: no sincroniza automáticamente sus precios ni existencias. Conserva la navegación, búsqueda, favoritos, carrito y contactos de la réplica. El checkout sigue siendo una demostración: **no cobra, genera pedidos reales ni entrega cuentas**. El acceso de clientes abre el enlace configurado. Los productos originales con rangos de precios pueden configurarse con variantes; mientras no tengan variantes, el carrito utiliza el precio inicial.

## Verificación

### GitHub Pages

La carpeta `docs/` contiene una exportación estática de la tienda. En **Settings → Pages**, selecciona **Deploy from a branch**, rama **main**, carpeta **/docs**, y guarda. Consulta la URL de publicación y el estado de despliegue en esa misma pantalla.

Para actualizar la página pública después de guardar cambios en el panel local:

```sh
node scripts/build-pages.mjs
```

Después sube la carpeta `docs/` actualizada al repositorio. El exportador toma el catálogo local guardado, o el catálogo inicial si todavía no existe. Solo incluye campos públicos, productos visibles y los medios referenciados; adapta las rutas para una página dentro de `/Superinteligencia.IA/`. La publicación es una copia estática y no cambia al editar el panel hasta regenerarla y subirla.

GitHub Pages no ejecuta Node.js ni recibe subidas de fotos. El código del panel está incluido en el repositorio y se usa localmente con `node server.mjs`; publicarlo como administración online requiere un servidor con almacenamiento persistente y autenticación. La exportación de Pages no muestra enlaces a un panel que no esté disponible.

Los datos de trabajo `data/store.json`, su copia anterior y `data/uploads/` están excluidos de Git. El catálogo inicial `data/seed.json` permite arrancar una copia nueva. Guarda tus datos locales por separado.

### Pruebas

```sh
node --test tests/*.test.mjs
```

Las pruebas verifican la integridad del catálogo, precios y variantes, carrito, filtros, persistencia, reinicio, restauración, conflictos de guardado, validaciones, protección de las escrituras, subidas y rutas de archivos. También se realizaron pruebas del panel y la tienda en navegador. Con npm puedes ejecutar `npm run check` y `npm test`.

`REVISION.md` detalla la revisión de la tienda y del panel del 27 de septiembre de 2026, con 21 pruebas satisfactorias, correcciones y límites actuales. Se añaden tres pruebas de exportación estática para GitHub Pages. Las imágenes originales y sus URLs de procedencia figuran en `dist/assets/manifest.json`.
