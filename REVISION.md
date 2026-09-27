# Revisión de fidelidad y funcionamiento

Fecha: 27 de septiembre de 2026.

La tienda reproduce el catálogo y el aspecto principal de GavidiaStreaming e incorpora una administración local con guardado persistente. Esta revisión entiende «autenticidad» como fidelidad a la referencia: no certifica la legitimidad comercial ni los derechos de distribución del negocio original.

## Fidelidad a la referencia

El [inicio original](https://gavidiastreaming.com/) se volvió a consultar y comparar visualmente el 27 de septiembre. La revisión de las cuatro páginas de la [tienda original](https://gavidiastreaming.com/productos/) corresponde a la inspección del 25–26 de septiembre; no se ha repetido una comparación completa de todas sus páginas.

| Elemento | Resultado |
|---|---|
| Catálogo inicial | 90 productos: 72 disponibles y 18 agotados. Se conserva intacto tras las pruebas. |
| Imágenes | Logos, banners, categorías y productos originales guardados localmente; procedencia en `dist/assets/manifest.json`. |
| Categorías | 59 productos en streaming, 20 en software, 4 en herramientas, 2 en gaming, 6 en VPN y 0 en educación. Un producto pertenece a dos categorías. |
| Diseño | Conserva fondo oscuro, rojo, cabecera, banners, tarjetas y pie. La tipografía y varias páginas secundarias son aproximadas. |
| Precios y planes | Conserva los rangos observados. No reproduce exactamente la configuración original de todos los planes y descuentos. Las variantes configuradas en el panel sí tienen precio, oferta y disponibilidad propios. |
| Actualización | Catálogo independiente: no sincroniza precios ni existencias con la referencia. |

## Correcciones de esta revisión

- El carrito y los favoritos se sincronizan entre pestañas. Las acciones del carrito identifican cada producto y variante mediante una clave estable.
- El panel muestra los precios, ofertas y disponibilidad de las variantes; bloquea los campos generales que no se aplican cuando existen planes.
- La tienda y el servidor rechazan importes con más de dos decimales para evitar diferencias entre el precio mostrado y el total.
- El bloqueo de `localStorage` por el navegador ya no impide iniciar la tienda.
- Si falta la imagen principal, la portada utiliza la primera foto de la galería.
- Tras perder la sesión del servidor, el panel obtiene una nueva sesión sin descartar el borrador. Se comprobó reiniciando la copia de pruebas.
- El servidor valida el catálogo final antes de escribirlo. Un desbordamiento de IDs o revisiones se rechaza sin modificar los datos actuales ni su copia anterior.

Se mantienen las correcciones anteriores: inclusión de los 18 productos agotados, filtros de renovación y búsqueda normalizada, reinicio de la paginación al repetir una búsqueda, recuperación de datos locales inválidos, etiquetas accesibles de favoritos, menú de tablet y cierre independiente de la pestaña de comunidad.

## Verificación y alcance

**21 de 21 pruebas automáticas satisfactorias** con `node --test tests/*.test.mjs`: 9 del modelo de tienda y 12 del servidor, contando los subcasos de desbordamiento.

Cubren catálogo e imágenes, ofertas y variantes, carrito, búsqueda, disponibilidad, almacenamiento bloqueado, precisión de importes, persistencia y reinicio, restauración, conflictos de guardado, validación de datos, sesión y CSRF, subidas, rutas y conservación de archivos ante errores.

Las pruebas actuales de interacción se realizaron sobre una copia aislada en `http://127.0.0.1:4174`, sin modificar los 90 productos de la tienda real. Se comprobó:

- Sincronización del carrito y favoritos entre dos pestañas, conservando cantidades y subtotales.
- Precio y estado de las variantes en el panel y la tienda; un producto con todos sus planes agotados no permite añadirlo al carrito.
- Filtros de ofertas y agotados coherentes con los planes.
- Rechazo de un precio de 1,335 al guardar desde otra sección del panel, conservando el borrador para corregirlo o descartarlo.
- Imagen de la galería cuando falta portada y guardado después de reiniciar el servidor de pruebas.
- Panel a 320 píxeles y tienda a 320 y 768 píxeles sin desbordamiento horizontal de página; la tabla del panel dispone de desplazamiento interno.
- Sin errores de consola en las interacciones finales de la copia de pruebas.

La revisión anterior también comprobó búsqueda, filtros, paginación, carrito, favoritos, diálogos y menú móvil, incluyendo una vista de 1280 píxeles. Estos resultados no equivalen a garantizar ausencia de fallos en cualquier navegador o escenario.

### Activación en la sesión abierta

La versión 2.0.1 está guardada en el proyecto y validada en el servidor de pruebas. Se encontró un borrador sin guardar en una pestaña antigua del panel real; esa pestaña y el servidor de `4173` se dejaron intactos para permitir terminar la edición. Tras guardar o descartar ese borrador, hay que reiniciar `node server.mjs` y recargar la tienda y el panel para cargar todas las correcciones. El catálogo real permanece en la revisión 6, con 90 productos y 72 disponibles.

## Administración y límites actuales

El panel permite editar productos, fotos, galerías, precios, ofertas, variantes, categorías, banners, apariencia, textos y contactos. Guarda el catálogo en `data/store.json`, la versión anterior en `data/store.backup.json` y las fotos subidas en `data/uploads`. La exportación JSON no incluye los archivos de imagen.

El acceso administrativo es local, sin contraseña: solo admite conexiones de este equipo y protege las escrituras mediante sesión y CSRF. No está preparado como administración remota o multiusuario publicada.

El checkout sigue siendo una demostración. No están integrados el cobro, los pedidos reales, las cuentas de clientes, la entrega de cuentas/licencias ni la renovación real. El acceso de clientes abre el enlace configurado. Los rangos originales sin variantes usan el precio inicial en el carrito; los planes añadidos desde el panel ya son seleccionables y operativos. USD, PEN y EUR cambian la moneda mostrada, sin conversión automática. La reproducción exacta de las páginas secundarias y las descripciones completas sigue pendiente.

No se enviaron mensajes, credenciales ni pedidos a terceros durante estas comprobaciones.
