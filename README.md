# SGI · Energía y potencia

Tablero de OESC y OECC con histórico, proyecciones, cartera compacta y gestión persistente de contratos.

## Ejecutar

Requiere Node.js 22 o posterior. No hay dependencias npm que instalar.

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

El histórico está cerrado a septiembre de 2026. Las reglas confirmadas de precios, generación y márgenes se conservan en los archivos del modelo. Los contratos editables no reescriben facturas históricas.

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

Santa Rosa conserva octubre de 2026 en **1.080 MWh**, y Chepes **120 MWh/mes hasta enero de 2027**. El excedente de Santa Rosa se valoriza a 40,80 USD/MWh; los demás excedentes se muestran sin inventar una venta. Los importes conservan las reglas comerciales confirmadas y la precisión completa; la pantalla redondea los MWh.

`PUT /api/generation` usa la misma autenticación, validación de origen, revisión y SHA que los contratos. La auditoría registra generador, mes y valor. Una revisión obsoleta no sobrescribe cambios.
