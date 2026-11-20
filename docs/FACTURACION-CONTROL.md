# Control de facturación DTE · 20/11/2026

Se revisaron los períodos disponibles del tablero, desde febrero de 2026 hasta octubre de 2026. No se completaron precios trasladándolos desde otro mes.

- Abril a junio: precios y contratos PS de potencia OECC recuperados de las planillas originales de cada mes. Junio conserva el precio de 14 USD/MWhrp de Satus Ager; mayo conserva 13,25 USD/MWhrp.
- Se reconocen MATP MENSUAL, GUMES_MENSUAL + GUMAS-DI_MENSUAL y RESUMEN MENSUAL. Se suman únicamente cantidades mensuales, sin volver a multiplicar por horas punta.
- Se normalizan espacios en los códigos de agentes y se admiten complementos junto al Access, además de las subcarpetas.
- Un precio histórico único del mismo mes, sociedad, NEMO y producto puede aplicarse aunque el histórico tuviera pendiente identificar el generador. La energía sigue saliendo del DTE seleccionado. Si hay dos precios posibles, se mantiene el bloqueo.
- Febrero II: no se localizó el complemento mensual de potencia en la carpeta de esa edición. No se utiliza febrero I para reemplazarlo.
- Marzo I: el archivo llamado MATP contiene una única hoja con detalle horario, sin resumen mensual. El lector mensual lo rechaza; tampoco permite publicar una comparación completa de marzo II sin marzo I.
- Octubre: está disponible DTE I; DTE II aún no figura en la carpeta revisada.
- Agosto: las planillas ya guardadas conservan dos renglones de ENERGEIA (85 y 100 USD/MWh). La regeneración desde cero se bloquea si no puede determinar el reparto por precio; no se aplica un promedio ni se usa uno de los precios al azar. Las descargas guardadas siguen disponibles.

Las planillas generadas pueden tener contratos PS pendientes si el histórico no los informa. No se inventan esos identificadores. El histórico de precios recuperado tiene referencia al archivo, hoja y celdas de origen y no contiene cantidades. Su publicación en el repositorio público queda pendiente de autorización explícita; las planillas de facturación aprobadas sí se pueden guardar y descargar.

Las pruebas con archivos privados se activan con `SGI_TEST_MONTH_AUDIT_DIR` (abril a junio) y `SGI_TEST_JULY_DIR` (julio). La publicación de código y las pruebas locales no verifican por sí solas la conexión personal de cada visitante a SharePoint/GitHub.
