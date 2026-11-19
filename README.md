# SGI · Energía y potencia

Tablero de OESC y OECC con histórico, proyecciones, cartera compacta y gestión persistente de contratos.

## Ejecutar

Requiere Node.js 22 o posterior. Instalá las dependencias con `npm ci`; incluyen el lector Access y el empaquetador del Worker.

```bash
SGI_PASSWORD="tu_clave_privada" npm start
```

Abrir http://127.0.0.1:4173 y autenticarse con usuario `sgi` y la clave definida en `SGI_PASSWORD`. El servidor Node rechaza todo acceso sin autenticación, y no inicia el acceso a datos si falta esa configuración. Para reconstruir el HTML desde las fuentes:

```bash
python3 build.py
npm test
```

## Datos y guardado

- `source_data/`: datos de origen extraídos de las planillas. Se conservan como fuente.
- `data.json`: histórico y proyecciones del tablero anterior, con sus ajustes confirmados.
- `data/state.json`: contratos editables, generación mensual, revisión y registro de modificaciones.
- `migrate_contracts.py`: migración inicial reproducible de 59 filas de contratos. No ejecutarla sobre una base editada: reemplaza `data/state.json`.

En modo local, las altas y modificaciones se escriben de forma atómica en `data/state.json`, dentro de esta copia del repositorio. No se guardan solamente en el navegador. Para subir cambios locales a GitHub se usa Git.

Para guardado directo en GitHub desde un servidor, configurar `GITHUB_TOKEN` como secreto del servidor, con permiso Contents de lectura/escritura limitado a este repositorio. Configurar también `GITHUB_REPOSITORY=daniraggio/sgi` y opcionalmente `GITHUB_BRANCH=main`. Cada guardado crea un commit; la revisión y el SHA evitan sobrescribir cambios simultáneos. La conexión de GitHub en ChatGPT permite mantener este repositorio, pero no entrega una credencial al servidor de la aplicación.

Los secretos nunca se incluyen en HTML ni en el repositorio. La API no expone rutas arbitrarias de archivos. El servidor escucha en 127.0.0.1 por defecto y exige autenticación HTTP con `SGI_PASSWORD` en todas las rutas. Para publicarlo, colocarlo detrás de HTTPS y un control de acceso de usuarios; no exponer directamente una instancia sin autenticación. `HOST` y `PORT` se pueden configurar desde el servidor.

## Uso

En **Clientes y contratos** se presentan dos grillas separadas: Energía (MWh) y Potencia (MW-hrp). Cada contrato ocupa una fila con NEMO, prioridad de venta, precio y volumen por mes. Las filas se agrupan por sociedad, generador y prioridad, con subtotales por prioridad y generador. Los meses, el NEMO, la prioridad y el precio quedan visibles al desplazarse. Se puede filtrar por período y prioridad, y exportar la grilla a CSV.

El alta permite definir sociedad, producto, NEMO, proveedor, prioridad de venta, inicio/fin, volumen mensual y venta fija o por temporada. Se permiten excepciones mensuales y archivo reversible. Los meses inicial y final se incluyen, sin renovación automática.

En **Cartera · energía mensual**:

- **Entregas reales y previstas** conserva el histórico y usa la misma asignación simulada que la grilla de contratos para octubre de 2026 en adelante.
- **Volumen contratado** usa la base editable y refleja inmediatamente las altas y modificaciones. La venta nominal es volumen por precio, sin interpretarla como facturación o margen.
- Las filas son compactas; la primera columna y los encabezados quedan fijos. El NEMO se puede mostrar, y el botón **12 meses** reduce el período visible.

Un contrato nuevo no implica entrega garantizada. No se inventa generación ni se agregan ventas reales al ingresarlo. La asignación comercial prevista se calcula por generador con la generación estimada, y no representa un despacho físico confirmado. Las cantidades de potencia están en MW-hrp, separadas de MWh y MW. Las filas de potencia importadas usan los MW-hrp previstos en MATP, no los MW nominales contratados. Las prioridades se recuperan de la columna G de la hoja de origen; una prioridad no definida se muestra como tal, sin asignarla por defecto. Cambiar una prioridad en la ficha no reescribe las facturas ni recalcula la asignación física del histórico.

El histórico está cerrado a octubre de 2026 (DTE I para octubre). Las reglas confirmadas de precios, generación y márgenes se conservan en los archivos del modelo. Los contratos editables no reescriben facturas históricas.

## Publicación

Este proyecto tiene backend Node.js: GitHub Pages por sí solo no ejecuta las altas y modificaciones. Se puede ejecutar en un servidor compatible con Node y volumen persistente, o con guardado remoto en GitHub.

El repositorio contiene información comercial. Su visibilidad en GitHub determina quién puede consultar los archivos.

## Versión online en Sites

`build_worker.py` prepara el Worker que sirve el tablero y guarda contratos directamente en GitHub con la conexión del visitante. Requiere la declaración del plugin GitHub en el alojamiento y una sesión de ChatGPT con permiso de escritura sobre el repositorio. No usa ni copia tokens del visitante. La versión online conserva el acceso privado del tablero anterior. El repositorio y su visibilidad son independientes del acceso al tablero.

El guardado requiere el clic explícito en Guardar/Archivar. Las peticiones sin sesión, de otro origen o con una revisión obsoleta se rechazan. Los errores de autorización no se reintentan automáticamente.

## Generación y asignación de energía

La pestaña Energía de Clientes y contratos permite alternar **Asignación prevista** y **Topes contratados**. Muestra la generación por mes, la disponibilidad comercializable de OECC y el excedente sin asignar. **Editar generación** guarda el nuevo valor en GitHub y recalcula la grilla, la cartera, los ingresos y márgenes proyectados. Potencia e históricos permanecen separados.

Para cada generador y mes se calcula sobre todos los contratos activos, antes de aplicar filtros:

1. La primera prioridad recibe `tope individual × min(1, disponible / suma de topes de prioridad 1)`.
2. El remanente pasa a la siguiente prioridad con la misma regla. Ningún contrato supera su tope.
3. Los contratos sin prioridad no reciben asignación; la falta de generación se distingue de generación cero.

La regla reproduce MATE-OESC filas 45–57 y MATE-OECC filas 30–38 del archivo original. En OECC se conserva el porcentaje comercializable mensual de la fila 9 respecto de la fila 8; editar generación escala esa disponibilidad. El contrato OECC → OESC tiene `linkedDemand`: su tope se obtiene de los contratos OESC abastecidos por Alto Valle, como la referencia original a MATE-OESC fila 82. La entrega de OECC limita el abastecimiento de OESC para repartirlo entre sus clientes. No se suman ambas sociedades como una venta consolidada.

Santa Rosa conserva **1.080 MWh** en el plan original de octubre; el suministro real de octubre es **1.013,382 MWh**, según DTE I, y Chepes **120 MWh/mes hasta enero de 2027**. El excedente de Santa Rosa se valoriza a 40,80 USD/MWh; los demás excedentes se muestran sin inventar una venta. Los importes conservan las reglas comerciales confirmadas y la precisión completa; la pantalla redondea los MWh.

`PUT /api/generation` usa la misma autenticación, validación de origen, revisión y SHA que los contratos. La auditoría registra generador, mes y valor. Una revisión obsoleta no sobrescribe cambios.

## Referencias de energía suministrada en DTE

En **Histórico real → Fuentes DTE de energía suministrada** se indica la parte del DTE utilizada para contrastar los volúmenes, con enlaces a los archivos originales de SharePoint. Se mantienen los precios y volúmenes de la planilla de facturación. El tablero no muestra alertas ni listas de diferencias.

- OESC hasta julio: `MATRenov.ENERGIA_CONT`, filtro `AGENTE_COM=DUKECOMO`, agrupado por generador, conjunto y demandante.
- OECC julio: `ANEXO_MAT_CONTRATOS.TOTAL_MWH`, filtros `AGENTE_G=CTALVALG`, `CONJUNTO=CTALV003`, cruce por comercializador y demandante.
- Agosto: complemento DTE II `Contratos_R400_2026-08_V2.xlsx`, hoja `MATE-MATER MENSUAL`, columna P (Energía Total, MWh). Se toma el complemento como fuente del detalle, sin sumarlo al Access.
- Septiembre: `MATE_MATER.ENERGIA_TOTAL`. Se suman registros de contratos y unidades; las facturas a comercializadoras se contrastan agrupando `COMERCIA`.

`source_data/dte_sources.json` contiene solo referencias y versiones de los archivos usados, con sus hashes; no contiene registros de entregas extraídos de los DTE. No se usan importes del DTE para modificar precios de la planilla. El histórico contrastado llega a octubre de 2026: DTE I para octubre. Las proyecciones visibles comienzan en noviembre.

## Edición puntual de celdas

En Clientes y contratos, pasar el cursor por un volumen muestra el acceso al precio mensual; el volumen se edita haciendo clic sobre su número. La columna de precios también permite elegir y editar un mes. Con teclado se accede con Tab y Enter.

El editor guarda una excepción del campo y mes elegidos, sin alterar el resto del contrato. Energía modifica el tope contratado y recalcula la asignación por prioridad, cartera e importes. La asignación mostrada puede ser menor al tope si falta generación. Potencia actualiza el volumen o precio mensual y la correspondiente transferencia OECC → OESC. Los topes intercompañía vinculados se siguen calculando a partir de los contratos de OESC.

Guardar usa la misma API protegida, revisión y control de concurrencia que la ficha completa. Cancelar o Escape cierra la edición sin guardarla. No hay guardado automático al pasar el cursor. Se admiten coma y punto decimal; no se admiten separadores de miles.

## Cuadros por generador

Clientes y contratos presenta un cuadro separado por sociedad y generador. En energía de OESC, cada cuadro contiene dos tablas simultáneas: primero topes contratados, editables por mes; después energía suministrada/prevista, calculada por prioridades y disponibilidad de generación. Las dos tablas conservan las mismas filas, columnas mensuales y subtotales por prioridad para compararlas. La segunda incluye un bloque real por NEMO del DTE I para octubre, sin atribuirlo a prioridades; desde noviembre muestra proyecciones con el mismo cálculo que la cartera. El CSV identifica a qué vista pertenece cada fila.


Octubre 2026 incorporado como real según DTE I y facturación OESC/OECC verificada por NEMO. Base trazable: `source_data/october_2026_actuals.json`. CALSA: factura 64 USD/MWh, comisión 6 USD/MWh y neto comercial 58 USD/MWh; contratos conservan precio neto. Proyecciones visibles desde noviembre, sin duplicar octubre al recalcular. Para regenerar los archivos distribuidos: `python build.py` y `python build_worker.py`.


## Actualizar DTE desde SharePoint y aplicar reales

En Clientes y contratos, elegir mes y DTE I o DTE II:

- **Buscar DTE en SharePoint** consulta únicamente las versiones disponibles del mes seleccionado dentro de `Comercial y Regulatorio/Energía Eléctrica/01 - Transacciones Economicas/04 - DTE`. Esta consulta no cambia los reales.
- **Descargar facturación XLSX** usa el DTE seleccionado. La primera generación lee el Access, completa precios y PS con los contratos, guarda el resultado y reemplaza las operaciones del mes como reales para OESC/OECC. Descargas siguientes reutilizan exactamente el resultado procesado, sin releer SharePoint ni escribir reales. Octubre DTE I ya incorporado se reconoce como procesado.
- **Forzar actualización** vuelve a leer y procesar la edición elegida. No descarga automáticamente un XLSX; después se puede descargar la copia actualizada. Un DTE I no desplaza un DTE II ya aplicado.
- DTE II agrega la hoja de comparación contra DTE I del mismo mes. DTE I debe estar incorporado para esa comparación.

`POST /api/dte/discover` y `POST /api/dte/prepare` requieren identidad autenticada, origen propio y clic explícito. `GET /api/billing` nunca escribe. SharePoint se declara de solo lectura; GitHub conserva las escrituras autorizadas de contratos y datos. El servidor usa la conexión del visitante, sin guardar tokens ni URLs temporales. Los nuevos extractos se guardan como archivos inmutables en `data/dte/`; un cambio con SHA en `data/dte-billing.json` activa la versión elegida. Fallar antes de activar el índice conserva los reales anteriores. Una nueva carga del tablero recupera los reales aplicados desde GitHub.

Fuentes soportadas para el importador Access: `MATE_MATER.ENERGIA_TOTAL` (MWh), `MATP.POTENCIA_CONTRATADA` (MWhrp, sumando unidades sin volver a multiplicar por horas punta), y `GenR400.GENERACION_TOTAL` (MWh). Se filtra OESC por DUKECOMO y OECC por CTALVALG; las ventas de OECC a intermediarios se agrupan por COMERCIA. Un formato sin esas tablas falla explícitamente y no reemplaza datos. Importes DTE no se usan como precios. Si falta precio de un NEMO, se informa para completar Clientes y contratos antes de aplicar el mes. CALSA conserva la comisión de 6 USD/MWh. OECC conserva referencias de 40/60 USD/MWh y 12 USD/MWhrp. La disponibilidad comercializable usa el porcentaje mensual acordado sobre la generación real.

Para construir la versión online: `npm ci`, `python build.py`, `python build_worker.py`. El servidor Node local no dispone de la conexión delegada de SharePoint de Sites; la importación en línea se implementa en el Worker.


## AET · Aconcagua Energia Trading · ACONENEO

Sociedad incorporada desde noviembre de 2026. Fuente: `source_data/aet_contract.json`, hoja MATE-AET fila 13 de la planilla de seguimiento. Único contrato inicial: NOVA / NOENCRUN, prioridad 1, tope 100 MWh/mes, noviembre 2026–octubre 2027 inclusive, venta 64 USD/MWh. Acuerdo 1542; la planilla no informa Contrato PS ni MEMnet. No se confunde el acuerdo con el PS. La unidad de negocio de facturación de AET también queda pendiente de definir.

`projectAet` usa la misma asignación de OECC→ACONENEO para abastecer los topes de AET. La compra conserva 45 USD/MWh en verano (octubre–abril) y 62 en invierno (mayo–septiembre). El margen es ingreso de venta menos compra. La planilla entrega 100 por referencia directa al tope; el tablero limita la previsión al abastecimiento asignado por OECC, para que ambas sociedades coincidan. El flujo intercompañía se muestra por separado y no se presenta como resultado consolidado.

AET tiene ventas, cartera mensual compacta, histórico real vacío hasta la incorporación de su primer DTE, y gestión de clientes/contratos. El importador reconoce COMERCIA=ACONENEO en MATE_MATER desde noviembre, agrupa por NEMO del demandante y mantiene OECC→AET como otra operación de OECC. No agrega transacciones AET anteriores. Los nuevos snapshots conservan los reales de AET y sus meses aplicados; DTE II sustituye su mes sin duplicar registros. El XLSX agrega hoja AET únicamente si hay transacciones; PS y unidad de negocio faltantes se señalan como pendientes. Las exportaciones históricas de octubre conservan dos hojas.
