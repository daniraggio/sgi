# SGI · Funcionamiento e integración

Documento del funcionamiento implementado en noviembre de 2026. Describe el tablero OESC/OECC/AET y una propuesta de integración; no implica que el sistema de gestión ya esté conectado. Los parámetros comerciales vigentes se consultan en la base, no en este documento.

## 1. Alcance y arquitectura

El tablero permite mantener contratos y generación proyectada, simular entregas por prioridad, consultar suministros reales, calcular márgenes comerciales y generar el archivo mensual para el bot de facturación.

| Componente | Responsabilidad |
| --- | --- |
| Interfaz HTML/JS | Filtros, edición y presentación. La sección Cómo funciona está en `help.html`. |
| `server/model.mjs` | Validación, calendario, distribución por prioridades, proyección de potencia y transferencias. Se comparte entre cliente y servidor. |
| `worker/handler.mjs` | API canónica de la versión publicada en Sites y acceso a conectores. |
| `server/dte.mjs` | Localización y descarga del Access, lectura por esquema y aplicación de condiciones comerciales. |
| `server/dte-xlsx.mjs` | Potencia del complemento mensual; lectura en flujo que evita descomprimir las hojas horarias. |
| `server/dte-cache.mjs` | Procesamientos por mes/edición, activación de reales y reutilización. |
| `server/billing.mjs` | Líneas, orden por PS, FNEE, comparación I/II y XLSX sin formato. |
| `server/published-billing.mjs` | Publicación del XLSX y catálogo, y descarga posterior sin conectores personales. |
| GitHub comercial | Datos editables, registros de DTE y archivos de facturación. |
| SharePoint | Fuente de los DTE. No recibe escrituras desde esta integración. |

El código desplegado se versiona en el repositorio de fuente de Sites. `daniraggio/sgi` es el repositorio comercial y también contiene copias de código; ambos repositorios no tienen una sincronización automática completa. Identificar el commit del despliegue antes de migrar a otro entorno. El servidor Node de desarrollo (`server/index.mjs`) no implementa todas las funciones del Worker: no tomarlo como contrato de paridad de la API publicada.

## 2. Modelo de datos

### Estado editable: `data/state.json`

| Campo | Significado |
| --- | --- |
| `schemaVersion` | Versión del formato del estado. |
| `revision` | Entero para control de concurrencia. Se incrementa al guardar. |
| `contracts[]` | Contratos, separados por sociedad, producto y prioridad. |
| `generation[]` | Planes de generación y proporción mensual comercializable. |
| `billingProfiles[]` | Condiciones compartidas por NEMO: PS, precio bruto, comisión o precio de potencia, cuando están configurados. |
| `audit[]` | Operación, fecha, revisión e identificadores; las modificaciones de generación incluyen sus parámetros. No es un historial completo de antes/después de cada contrato. |
| `societies` | Configuración adicional, como la unidad de negocio de AET, si está definida. |

### Contrato

| Campo | Tipo / regla |
| --- | --- |
| `id` | Identificador interno estable, cadena. Las altas usan UUID; existen identificadores migrados de otro formato. |
| `society` | `OESC`, `OECC` o `AET`. |
| `kind` | `energy` o `power`. |
| `client`, `nemo`, `supplier` | Nombre comercial, NEMO o conjunto de NEMO y generador/proveedor. Los NEMO conjuntos se separan con ` / `. |
| `psContract` | Cadena de dígitos, opcional en la base; necesario completarlo para la importación de facturación que lo requiera. No es el ID contrato del DTE. |
| `priority` | Entero de 1 a 99, o `null`. Sin prioridad no hay asignación automática de energía. |
| `start`, `end` | `AAAA-MM`, ambos incluidos. Validación actual: máximo 120 meses. |
| `volume` | Volumen mensual por defecto. Energía: MWh. Potencia almacenada: MWhrp previstos. |
| `monthlyVolumes` | Excepciones por mes, mismas unidades que `volume`. |
| `summerPrice`, `winterPrice` | USD/MWh para energía; USD/MWhrp para potencia. |
| `monthlyPrices` | Precios de un mes específico; prevalecen sobre los estacionales. |
| `active` | Participación en la proyección. |
| `source`, `imported`, `linkedDemand` | Metadatos mantenidos por el servidor. `linkedDemand` vincula el tope OECC→OESC a los contratos aguas abajo. |

Los clientes todavía no son una entidad normalizada e independiente: sus nombres y NEMO se repiten en contratos y operaciones. Un NEMO no identifica por sí solo un contrato. Para migrar, conservar sociedad, producto, generador, prioridad y vigencia, además de su ID interno.

### Generación

Cada plan tiene `id`, `society`, `supplier`, `monthlyGeneration` (MWh por mes) y `monthlyShares` (fracción comercializable por mes). No reemplazar las fracciones mensuales por un porcentaje fijo. La edición requiere un plan existente y un mes con proporción definida.

### Suministros y procesamientos de DTE

`data/dte-billing.json` contiene `periods` y, cuando existe activación por registros separados, `applied`:

- `periods`: mes, edición, fecha de procesamiento, fuente y `cachePath`; hay registros históricos guardados directamente en el índice.
- `applied`: edición activa por `AAAA-MM`. Si un mes antiguo ya procesado todavía no tiene una entrada en este mapa, la lectura de reales recupera su edición más reciente (II antes que I) desde las filas guardadas y su generación. No vuelve a leer SharePoint ni cambia cantidades o precios.
- `data/dte/<mes>-<edición>-<hash>.json`: procesamiento con `rows`, `billingRows`, `dashboard`, generación, método y fecha. El archivo se guarda antes de activar su referencia en el índice.

`rows` conserva sociedad, NEMO, proveedor, producto/unidad, cantidad, cliente, PS y precio para facturar. `dashboard` contiene las filas y agregados que sustituyen ese mes en el tablero. Una misma combinación puede tener varios tramos de precio: no eliminarlos al normalizar.

La base inicial del sitio (`data.json`, construida desde `source_data/`) contiene históricos y estructuras heredadas. Algunos registros antiguos de OESC usan mes numérico; el servidor los normaliza para su año histórico. Un sistema nuevo debe conservar siempre año y mes explícitos y no extender esa convención heredada a nuevos períodos.

## 3. Reglas de cálculo y unidades

### Energía

1. Se calcula por sociedad, generador y mes.
2. Energía comercializable = generación × proporción mensual.
3. Dentro de cada prioridad, entrega = tope × mínimo(1, disponible para el grupo / suma de topes del grupo). Un grupo de tope cero recibe cero.
4. El sobrante pasa a la siguiente prioridad. No se supera el tope individual.
5. Sin generación conocida, la entrega queda pendiente; no convertir ese pendiente en cero.
6. Las compras de OESC/AET desde OECC están limitadas por la entrega asignada aguas arriba. Los suministros mensuales se consultan en Contratos, junto a sus topes. La navegación no tiene una sección Cartera separada. La guía Cómo funciona se abre desde el encabezado, junto a Descargar HTML.

Las sociedades muestran sus operaciones e intercompañía. El tablero no elimina automáticamente operaciones internas para consolidar el grupo.

### Potencia

Los topes de la tabla se muestran en MW. El estado heredado guarda la proyección en MWhrp: la planilla usa 220 horas para relacionar ambas unidades, dato documentado en `contractHistory.powerForecastHours`. La edición de una celda de tope en MW convierte ese valor a MWhrp al guardar. El formulario general debe interpretarse por su unidad explícita.

El histórico del DTE contiene la cantidad mensual acumulada: no multiplicarla nuevamente por horas punta. En la columna final de topes se muestra el máximo del período, no la suma de MW entre meses.

### Precios y margen

Las excepciones mensuales tienen precedencia sobre las temporadas. Verano: octubre–abril; invierno: mayo–septiembre. Los precios comerciales provienen de la base y las planillas de facturación, no de la valorización del DTE.

Ingreso bruto = cantidad × precio. Ingreso neto = ingreso bruto − comisión, si corresponde. Margen OESC = ingresos menos compras y comisiones, con el tratamiento de excedentes spot de cada generador. Margen OECC = venta menos la referencia estacional de energía o referencia CAMMESA de potencia definida en el modelo. Margen AET = venta menos compra a OECC. Estos resultados no incluyen todos los costos operativos, IVA ni FNEE.

Energía sin contratar = comercializable − contratada. El color solicitado en esa columna de OECC es negativo verde / positivo rojo. Energía por vender suma sólo saldos positivos de meses proyectados desde el mes actual, dentro del filtro; no compensa déficits entre meses. El próximo mes es el primero con saldo positivo.

### Presentación

MWh e importes se muestran redondeados, pero se calcula con la precisión original. MW y precios admiten decimales. «—», cero y pendiente tienen significados distintos. Verde/azul identifica real/proyección en las series, no el signo de margen.

El Resumen abre desde el mes actual y cubre 12 meses. Contratos abre desde tres meses antes hasta ocho meses después del actual. Ambos períodos se mueven con el calendario de Argentina y admiten filtros manuales. El calendario no inicia una lectura de SharePoint.

## 4. Flujo DTE y facturación

### Fuente y extracción

Carpeta autorizada: `Comercial y Regulatorio/Energía Eléctrica/01 - Transacciones Economicas/04 - DTE/<año>/<mes>/DTE I o DTE II`.

El buscador reconoce Access directo o dentro de una carpeta con el nombre del DTE, sufijo de edición y ZIP con un único Access válido del período. No elige arbitrariamente entre dos Access de la misma edición. La búsqueda no activa valores reales.

| Esquema | Campo / hoja | Unidad |
| --- | --- | --- |
| Actual | `MATE_MATER.ENERGIA_TOTAL` | MWh |
| Anterior | `MATRenov.ENERGIA_CONT` y `ANEXO_MAT_CONTRATOS.TOTAL_MWH` | MWh |
| Access con potencia | `MATP.POTENCIA_CONTRATADA` | MWhrp acumulados por unidades |
| Access sin MATP | Complemento de la edición, `MATP MENSUAL` / `MATP_MENSUAL`, Potencia Cubierta | MWhrp acumulados, sin sumar hojas horarias |
| Generación | `GenR400.GENERACION_TOTAL` | MWh |

OESC se filtra por comercializador `DUKECOMO`; OECC por generador `CTALVALG`; AET por `ACONENEO` desde el inicio de sus operaciones. Julio conserva el detalle demandante de las ventas de energía OECC para aplicar los precios históricos por NEMO. Si un complemento omite el comercializador, su identidad se recupera del histórico comercial por NEMO; las cantidades siguen siendo del DTE seleccionado. El método queda identificado en el registro procesado.

### Preparación

`prepare` valida período/edición, reutiliza el registro procesado cuando corresponde o lee la fuente, completa precios y datos comerciales, verifica FNEE, guarda el procesamiento y activa su edición. Si falta el precio o hay precios históricos incompatibles sin reparto, detiene esa preparación.

Al preparar II sin I incorporado, prepara I para la comparación y luego activa II. Una preparación posterior de I no desplaza a II como real activo. En estos pasos hay varias escrituras; no es una transacción única de base de datos.

El XLSX se publica después del procesamiento. Su publicación y la del catálogo se hacen en un commit conjunto. Si esa publicación falla, el DTE puede haber quedado incorporado: consultar el mensaje y el índice antes de reintentar.

Repetir la descarga de un archivo publicado no consulta SharePoint ni cambia los reales. `force: true` relee, recalcula y puede actualizar los reales y el XLSX. Cambiar un contrato no regenera automáticamente un archivo ya publicado. Subir un DTE a SharePoint tampoco inicia automáticamente este flujo.

### Contrato del XLSX

Una hoja OESC y otra OECC; AET sólo con operaciones reales. Sólo el mes seleccionado. Encabezado: unidad de negocio, año, mes y tipo Provisorio. Las filas se ordenan por PS numérico. Columnas: Contrato PS, Cliente, NEMO, Línea de facturación, Cantidad, Unidad, Precio (moneda/unidad), Moneda y Observación.

- OESC energía: `Energías renovables`, BIDEI, MWh y USD/MWh.
- OECC energía: `Energia`, BIHCC, MWh y USD/MWh.
- Potencia: `Potencia`, MWhrp y USD/MWhrp.
- Cada suministro de energía agrega `FNEE` con iguales MWh y tarifa mensual en ARS/MWh, tomada de `data/fnee-rates.json`.
- La unidad de negocio de AET usa su configuración; si falta se señala como pendiente.
- Un PS faltante puede producir una observación en vez de bloquear el archivo. El sistema receptor debe exigir sus datos obligatorios antes de emitir.
- II incorpora comparación con I por sociedad/NEMO/producto: diferencia = II − I. Conserva PS y precio por edición; si hay varios tramos los muestra separados, sin promediar. No sumar MWh con MWhrp ni agregar FNEE como suministro adicional.

El XLSX es una entrada para el bot. Su generación no acredita que el bot lo importó, que una factura fue emitida o que fue cobrada.

## 5. API existente del Worker

Son rutas internas de la aplicación publicada. No hay todavía una API externa con credenciales propias para ERP.

| Método y ruta | Entrada | Resultado / efecto |
| --- | --- | --- |
| GET `/api/state` | — | Estado editable con `revision` y metadatos de almacenamiento. |
| POST `/api/contracts` | `{revision, contract}` | Alta y nueva revisión. |
| PUT `/api/contracts/:id` | `{revision, contract}` | Reemplaza condiciones validables del contrato y conserva metadatos de origen. Enviar el contrato completo, no un parche parcial. |
| DELETE `/api/contracts/:id` | `{revision, confirmDelete: true}` | Elimina el contrato de la proyección; conserva suministros reales. |
| PUT `/api/generation` | `{revision, planId, month, generation}` | Modifica la generación mensual en MWh. |
| POST `/api/dte/discover` | `{month}` | Ediciones y fuentes disponibles. No activa reales. |
| POST `/api/dte/prepare` | `{month, edition, force?: boolean}` | Procesa o reutiliza; puede activar reales y publicar XLSX. Responde indicadores `cached`, `applied` o `retainedII`, según el caso; puede devolver `publicationError`. |
| GET `/api/actuals` | — | `{periods: [...]}` con los datos de las ediciones activas para el tablero. |
| GET `/api/billing/catalog` | — | Períodos/ediciones incorporados y estado de procesamiento. |
| GET `/api/billing?month=AAAA-MM&edition=I` | Query | XLSX de los datos procesados; II agrega comparación. |
| GET `/api/billing/comparison?month=AAAA-MM` | Query | Comparación guardada I/II del mes, sólo cambios relevantes para el popup; no requiere conectores personales y no escribe reales. |
| GET `/api/billing/published` | — | Catálogo de XLSX publicados. |
| GET `/api/billing/saved?month=AAAA-MM&edition=II` | Query | XLSX publicado, sin invocar conectores personales. |

Las operaciones API requieren identidad de Sites. Las escrituras exigen origen coincidente y `Content-Type: application/json`. Según la ruta se requieren GitHub y/o SharePoint autorizados. La identidad es provista por la plataforma; no tratarla como un encabezado que un ERP puede autodeclarar.

Control de concurrencia: leer `revision`, enviarla al escribir y volver a leer tras un conflicto. El servidor también conserva el SHA del archivo al guardar en GitHub. Un 409 exige recargar y revisar antes de reintentar; no sobrescribir por fuerza. No cambiar contratos y generación en paralelo con la misma revisión.

Ejemplo ilustrativo de actualización de generación —no son valores comerciales reales—:

```json
{
  "revision": 12,
  "planId": "ID_DEL_PLAN",
  "month": "2027-01",
  "generation": 1200
}
```

Errores se devuelven como JSON con `error`; pueden incluir diagnóstico de conexión o ruta para iniciar sesión. Validaciones usan 400/422 según el servicio; ausencia 404; sesión 401; origen 403; conflicto 409; errores de conexión 502/503. No interpretar HTTP 200 de preparación como confirmación de publicación si contiene `publicationError`.

No existe aún endpoint HTTP de simulación, entidad maestra de clientes, webhook de SharePoint, emisión en ERP, estado de importación por el bot ni conciliación de cobros. El modelo compartido se puede reutilizar desde un servicio nuevo.

## 6. Persistencia, acceso y limitaciones para migrar

| Ruta del repo comercial | Contenido |
| --- | --- |
| `data/state.json` | Estado comercial mutable y revisión. |
| `data/dte-billing.json` | Índice, registros heredados y ediciones activas. |
| `data/dte/` | Procesamientos separados por versión. |
| `data/fnee-rates.json` | FNEE por mes, en ARS/MWh. |
| `data/billing-exports.json` | Catálogo de archivos compartidos. |
| `exports/billing/` | XLSX publicados y `Comparacion_<mes>_DTE_I_vs_II.json` con las referencias y cantidades de ambas ediciones. |

El repo comercial es público: sus archivos tienen acceso directo por GitHub. El permiso de entrada al sitio no controla ese acceso directo. La API de descarga dentro del sitio sí exige sesión, aunque no necesite conexiones personales.

Hay revisión y registro básico de operaciones, pero no roles propios de la aplicación por acción, auditoría completa antes/después, cierre contable, aprobación de facturación ni transacciones conjuntas de contratos/DTE/exportaciones. Definir esos requisitos al integrar.

## 7. Orden propuesto de integración

1. **Lectura:** importar XLSX a pruebas y conciliar totales por mes, edición, sociedad, NEMO y producto. Mantener moneda/unidad, precio, PS y FNEE.
2. **Maestros:** decidir qué sistema mantiene clientes, NEMO y contratos; asignar correspondencias estables de IDs sin usar sólo el nombre del cliente.
3. **Servicio autenticado:** exponer operaciones con autenticación propia, permisos, validación y revisión. No depender de cookies de navegador o conexiones personales para una sincronización desatendida.
4. **Persistencia:** si se migra a base de datos, separar condiciones contractuales, topes, proyección, suministros reales y versiones DTE. Conservar precisión y trazabilidad; usar transacciones para activar una nueva versión.
5. **Facturación:** agregar aprobación, identificador de importación y número/estado de factura. La clave de un envío debe incluir período, edición y sociedad, y distinguir correcciones para no duplicar emisión.
6. **Automatización:** agregar después un disparador o tarea programada para DTE, con avisos de fallo. Hoy sólo hay consulta/preparación a pedido.

Criterio de aceptación: mismos suministros, precios, comisiones, FNEE y márgenes que el modelo vigente; misma comparación I/II; repetir una importación no duplica operaciones; una edición anterior no reemplaza una posterior; los faltantes quedan visibles, sin fabricar cantidades o precios.


## Consulta de diferencias en pantalla

La publicación de DTE II guarda XLSX, JSON de comparación y catálogo en un mismo commit. El catálogo incluye `comparisonPath`, `comparisonChanges` y `comparisonTotal`. El botón de diferencias aparece en Facturación al seleccionar II y un mes con cambios relevantes publicados. El popup usa los datos guardados, exige sesión del sitio y no consulta SharePoint ni modifica el tablero. El popup muestra sociedad, cliente, NEMO, producto, cantidad de cada edición y diferencia II − I. Los PS, precios y motivo del cambio no se muestran en el popup; los PS y precios se conservan en la comparación del XLSX y en los datos guardados. La descarga de ajustes y el popup incluyen únicamente diferencias absolutas mayores a 1 MWh o 10 MWhrp; los originales completos siguen guardados para auditoría. Los meses sin cambios relevantes muestran una leyenda en lugar del botón.

## Política DTE I / DTE II y archivos detallados

Desde esta versión, las descargas DTE II son ajustes II − I: se agrupa por sociedad, NEMO y producto, y se incluyen únicamente diferencias absolutas estrictamente mayores a 1 MWh o 10 MWhrp. Los valores iguales al límite se omiten. El tablero reconstruye el mes con cantidades DTE II en esos grupos y cantidades DTE I en los restantes. Los snapshots y XLSX originales completos se conservan como fuente de auditoría; la descarga aplica el filtro sin modificarlos. Las bajas generan cantidades negativas. Si cambia el precio en un grupo significativo se emite crédito al precio original y débito al nuevo precio. El FNEE acompaña las cantidades de energía del ajuste.

`server/billing-downloads.mjs` transforma los originales archivados en ajustes, incluso para visitantes sin conectores personales. La comparación del XLSX mantiene PS y precio; el popup muestra solo cantidades y unidades.

DTE I usa `/api/billing/package`: cuando `data/billing-models.json` registra los dos modelos del mes, descarga un ZIP con el archivo para bot y los modelos detallados OESC y OECC. Los modelos revisados de octubre conservan fórmulas e histórico OESC, sin sección adicional de comisión CALSA. Solo se incluyen modelos del mes solicitado; para meses sin modelos revisados se entrega el XLSX del bot. Incorporar un nuevo modelo mensual requiere guardar sus dos XLSX y registrar sus rutas en el catálogo. No se reutiliza un modelo de octubre para otro mes.

## Módulos Contratos / Alto Valle

La portada (`app-shell.html`) reúne dos módulos locales bajo el mismo sitio y sus permisos actuales. La barra izquierda cambia entre Contratos y Alto Valle. `/contratos/` conserva el tablero comercial; `/alto-valle/` incorpora la vista operativa de CTAVAL. Cada módulo conserva su ámbito de ejecución y sus estilos para evitar interferencias entre cálculos, tablas y librerías. Las subsecciones de Alto Valle se seleccionan desde el menú común. El módulo operativo se inicializa solo al abrirlo.

`alto-valle/source.html` conserva el código de cálculo revisado de CTAVAL, excluyendo la documentación de destinos internos del reporte y el mecanismo obsoleto de tokens personales. `scripts/build-alto-valle.py` prepara la vista integrada con sus cálculos existentes; `alto-valle/integration.js` adapta navegación, carga mensual y configuración. Los datos siguen siendo `AVAL_YYYY_MM.xls` y `resumen_precios_previstos.xlsx` del repositorio CTAVAL. El catálogo se descubre por nombre, sin descargar los XLS; solo se descarga el período consultado y se conserva en memoria durante la visita. Actualizar datos vuelve a consultar el catálogo, la configuración y el mes seleccionado.

API operativa: `GET /api/alto-valle/catalog`, `GET /api/alto-valle/config` y `PUT /api/alto-valle/config`. Leer los datos públicos de CTAVAL no exige una conexión personal con GitHub. Guardar exige identidad del sitio, origen propio, JSON acotado, parámetros validados, conexión GitHub y consentimiento del visitante. Se verifica una revisión SHA-256 del contenido y se escribe con el SHA vigente del proveedor; un cambio concurrente devuelve 409. Se modifica exclusivamente `daniraggio/CTAVAL/data/config.json`, preservando los demás meses. No se guardan tokens personales en el navegador.

Se corrigió la lectura de las tarjetas de costo por máquina y se presentan GX + GA de forma consistente en el detalle de Costos. Se conserva el modelo de remuneración operativo existente; no se incorpora todavía la energía ni la potencia contratadas de SGI. El resumen comercial conserva la liquidación por DTE y la facturación mantiene sus reglas I/II y umbrales.

Tipos de cambio: facturación usa el vendedor BNA del día previo a emitir; Alto Valle mantiene el TC de cierre CAMMESA guardado para meses finalizados. El mes en curso puede refrescar la referencia mayorista utilizada por el modelo existente. Si falta el cierre histórico, se pide completarlo y no se sustituye por la cotización actual.

Los workflows, destinatarios y HTML original de CTAVAL se conservan para que GitHub Actions siga tomando y enviando su captura como hasta ahora. Las mejoras de interfaz de esta integración no reescriben ese HTML. Antes de retirarlo debe adaptarse explícitamente el proceso de captura.

La vista previa `scripts/preview.mjs` es de solo lectura y no implementa autoridad de conectores ni permite guardar. No se incluye en el Worker desplegado. Las escrituras reales se prueban mediante la API publicada con la sesión y consentimiento del visitante.

### Catálogo operativo y navegación

El catálogo mensual de CTAVAL se consulta desde `data/alto-valle-catalog.json` en SGI, con metadatos de archivos efectivamente verificados en CTAVAL. Los nuevos meses posteriores al índice se detectan mediante HEAD a la ruta mensual de CTAVAL; no se utiliza la API pública de listado de GitHub desde el Worker. Las cantidades y cálculos siguen saliendo exclusivamente del XLS operativo seleccionado.

La barra lateral y Alto Valle usan la paleta clara, verde y gris de Contratos. El menú tiene cabecera compacta, grupos desplegables y un único espacio de desplazamiento.

### Paleta SGI

`theme.css` comparte la paleta del sistema destino entre la portada, Contratos y Alto Valle: menú #183496, primario #2344b3, seleccionado #1d3fb5, fondo #f5f2eb, superficies #fcfaf6 y texto #132b46. Los colores de resultado positivo/negativo, prioridad y real/proyectado conservan su significado. Esta capa cambia la presentación sin modificar datos ni fórmulas.

## Alto Valle: contratos en el Resumen (validación septiembre y octubre de 2026)

Los Resúmenes ARS y USD incorporan las ventas de OECC de energía y potencia del último DTE disponible para cada uno de estos dos meses. Se leen las cantidades completas por NEMO del DTE guardado: `MATE_MATER.ENERGIA_TOTAL` en MWh y `MATP.POTENCIA_CONTRATADA` en MWhrp, sumadas por unidades. En meses cerrados no se reconstruye el respaldo horario ni se aplican umbrales de diferencias a esta integración. Los precios provienen de Contratos o del histórico comercial validado de las planillas, nunca de las valorizaciones declaradas ante CAMMESA. No se vuelven a sumar las reventas de OESC.

Para cada producto, el ingreso CAMMESA sustituido es la remuneración operativa original multiplicada por la cantidad asignada a contratos dividida por la cantidad operativa total del mismo producto. El ingreso contractual es la suma de cantidad DTE por precio comercial. El ingreso final es el original menos lo sustituido más las ventas a contratos. Confiabilidad y RPF se mantienen. Todos los costos originales, incluidos gas, cargos CAMMESA e impuesto débito/crédito, quedan iguales por decisión de validación; por lo tanto, la variación del resultado coincide con la variación de ingresos. Las cantidades físicas totales y los gráficos operativos no cambian. El Resumen conserva los indicadores operativos originales y separa los ingresos de energía y potencia entre spot y contratos; los detalles por comercializador se consultan en Contratos, sin duplicar allí las tablas ni la comparación con el modelo anterior.

La API de solo lectura `GET /api/alto-valle/contracts?month=YYYY-MM` valida la correspondencia de cantidades entre el DTE y el histórico comercial y solo permite estos dos meses. Usa los datos públicos ya autorizados en SGI y exige la sesión del sitio. No escribe en SharePoint, SGI ni CTAVAL. `Actualizar datos` invalida también la caché de contratos de ese mes. Si no se pueden validar los datos, se informa que la integración no se aplicó y se conserva la referencia operativa sin contratos.

Los demás meses siguen con el modelo operativo previo hasta validar esta etapa. Para la siguiente etapa de meses abiertos están preparados cálculos puros de reparto proporcional entre todos los contratos, con el tope mensual completo desde el primer día y límite de 20% de la generación hasta el 31 de marzo de 2027. El respaldo de potencia se calcula individualmente en cada hora de punta: una indisponibilidad no puede compensarse con potencia sobrante de otra hora. Estos cálculos todavía no se activan en noviembre. El tratamiento posterior a marzo debe definirse antes de extender este límite.
