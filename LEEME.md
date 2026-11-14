# Mi Economía: aplicación de economía personal

Es una aplicación web instalable (PWA) que funciona en el escritorio, el móvil y la tablet. Tus datos se guardan en el dispositivo (IndexedDB) y se sincronizan entre dispositivos a través de tu Google Drive.

## Contenido de la carpeta

| Ruta | Qué es |
|---|---|
| `index.html`, `css/`, `js/`, `icons/`, `manifest.webmanifest`, `sw.js` | Código de la aplicación. No contiene datos personales. |
| `datos/datos_iniciales.json` | Tus datos convertidos desde `AACuadromandos.xlsx` (maestros), `Mov-2025.xlsx` (3.084 movimientos de enero de 2025 a agosto de 2026) y `Ptmos.xlsx` (capital pendiente de los préstamos a 30/09/2026). **No lo publiques.** |
| `servidor.ps1` | Servidor local para usar la app en este ordenador. |

## 1. Usarla en el ordenador

1. Haz clic derecho en `servidor.ps1` y elige **Ejecutar con PowerShell**. Se abrirá `http://localhost:8080`.
2. Ve a **Ajustes y Drive › Cargar archivo JSON** y elige `datos/datos_iniciales.json`.
3. Para instalarla como aplicación, pulsa el icono de instalar en la barra de direcciones de Chrome o Edge.

## 2. Conectar Google Drive (carpeta Facturas y sincronización)

1. Crea un *Client ID* de Google siguiendo los pasos que se explican en **Ajustes y Drive**. Son unos 5 minutos y solo hay que hacerlo una vez.
2. En los *Orígenes de JavaScript autorizados* añade `http://localhost:8080` y, si la publicas, la dirección de GitHub Pages.
3. Pega el Client ID en la app y pulsa **Conectar con Google**.
   - Los tickets y facturas escaneados se suben a la carpeta **MiEconomia/Facturas**. Si ya existe en tu Drive, se usa esa; si no, se crea. El nombre de cada archivo sigue tu convención `Tipo-Bloque-Bien-Categoría-Subcategoría-Proveedor-Fecha`.
   - La base de datos se guarda en `MiEconomia/economia_datos.json`. Cada dispositivo la descarga al abrir la app y la sube cuando guardas cambios.

## 3. Usarla en el móvil y la tablet

El móvil necesita abrir la app desde una dirección HTTPS. La forma más sencilla y gratuita es GitHub Pages:

1. Crea un repositorio en GitHub y sube **todo excepto la carpeta `datos/`**.
2. En el repositorio ve a *Settings › Pages* y publica la rama `main`. Obtendrás una dirección como `https://tuusuario.github.io/mi-economia/`.
3. Añade esa dirección a los orígenes autorizados del Client ID de Google.
4. En el móvil, abre la dirección, conecta con Google (se descargarán tus datos de Drive) y elige **Añadir a pantalla de inicio**.

El código publicado no contiene datos personales: los datos solo están en tus dispositivos y en tu Drive.

## Funciones

- **Dashboard mensual**: ingresos, gastos, ahorro y tasa de ahorro; saldo disponible por cuenta; inversión; deuda de tarjetas y de préstamos; evolución de los últimos 12 meses; gastos por categoría; resumen por área; resultado por activo; préstamos. Se puede filtrar por área y exportar a Excel o PDF.
- **Movimientos**: filtros por mes, fechas, cuenta, área, tipo, categoría y texto; alta y edición; exportación a Excel con las mismas columnas que tus libros X-*.
- **Escanear / Importar**:
  - *Factura o ticket*: haz una foto o sube una imagen o un PDF. El OCR se ejecuta en el propio dispositivo y extrae la fecha, el total, el NIF y el proveedor; propone la categoría según tu histórico y detecta si el ticket ya está registrado en el banco para vincularlo. El documento se guarda en Drive › Facturas.
  - *Extracto bancario*: acepta Excel, CSV, PDF o foto. Detecta la cuenta por el nombre del archivo (las mismas reglas que tu macro CodificadorExtractos), identifica las columnas, descarta duplicados (cuenta + fecha + importe + concepto) y codifica cada movimiento por similitud con el histórico. Los codificados automáticamente aparecen en verde y los dudosos en amarillo. Acepta también tus libros X-*.xlsx y Mov-2025.xlsx, conservando su clasificación.
- **Informes**: ingresos y gastos por categoría y mes; área › categoría › subcategoría; resultado por activo y mes; saldos de cuentas a fin de mes; cuadro de amortización de préstamos. Cada informe se exporta a Excel o PDF, y también hay un libro Excel completo.
- **Proyección**: parte de la media de los últimos N meses de cada partida (con casillas para incluir o excluir), aplica inflación y subida de ingresos, calcula las cuotas reales de los préstamos con el sistema francés (incluida la carencia de HipFra) y añade los eventos futuros que indiques. Muestra la liquidez, la deuda y el patrimonio neto a 1–20 años y permite simular escenarios (por ejemplo, ingresos un 10 % más bajos o gastos un 10 % más bajos).
- **Maestro**: áreas, tipos, categorías y subcategorías, bienes (con valor estimado), cuentas (con saldo inicial) y préstamos (con los datos para la proyección). Si cambias un código, se actualizan también los movimientos que lo usan.
- **Entrada de Drive** (*Escanear / Importar › 📥 Entrada de Drive*): deja en `MiEconomia/Entrada` los archivos que descargues del banco, en Excel o PDF (también ZIP). Al abrir la app te avisa de que hay archivos nuevos. Con un clic:
  - Reconoce cada extracto y su cuenta:
    - por el IBAN (Caixa y Santander);
    - por el número de tarjeta (tarjetas BBVA y Santander);
    - por la continuidad del saldo (BBVA, cuyo Excel no indica la cuenta; si no puede deducirla te pregunta una vez y lo recuerda);
    - Trade Republic, solo en PDF, se lee calculando cada importe por la diferencia de saldos.
  - Importa los movimientos sin duplicados: compara cuenta, fecha e importe, aunque el concepto esté escrito distinto o tú lo tuvieras desglosado en varias líneas.
  - Aplica plantillas y reglas.
  - Archiva cada extracto como `Extracto-<cuenta>-<desde>_<hasta>` en `MiEconomia/Extractos/<cuenta>/<año>/`.
  - **Recibos, justificantes y facturas**: los PDF que no son extractos se vinculan a su movimiento y se guardan en `MiEconomia/Facturas` con tu convención `Tipo-Bloque-Bien-Categoría-Subcategoría-Proveedor-Fecha`.
    - El movimiento se busca por cuenta (IBAN, IBAN enmascarado o tarjeta), importe y fecha de cargo.
    - Los recibos que juntos forman un cargo agrupado (MyBox) se vinculan cada uno a su partida.
    - Los informativos (plan de pensiones, costes de Trade Republic) se guardan renombrados, sin vincular.
    - **Nombres repetidos**: si el nombre que le toca a un documento ya existe, se queda en Entrada para revisión. Puedes cambiarlo o pulsar "＋ importe".
  - **Si corriges un movimiento** (tipo, área, activo, categoría, fecha…), sus PDF se renombran solos en Drive. Si el nombre nuevo choca con otro documento, aparece en Revisar › *Documentos con nombre repetido*.
- **Revisar (bandeja)**: muestra solo lo que la app no ha podido resolver sola. Al importar un extracto, cada movimiento se clasifica primero por **plantilla de desglose**, después por **regla** y, si no hay ninguna, por parecido con el histórico. Los desgloses que cuadran se aplican solos, igual que en tus hojas de Desglose: el cargo queda en AR, se añade un apunte AR que lo anula y las partidas van en R.
  - *Préstamos*: interés = capital pendiente × tipo / 12. Si cambia la cuota, la app te pide el nuevo tipo de interés. El capital pendiente se actualiza solo con cada cuota.
  - *Importes fijos (Plan Estar Seguro)*: cada póliza tiene su fecha de renovación. Si el cargo cambia el mes en que renueva una póliza, la diferencia se le asigna sola y la fecha avanza un año. Revisar avisa 45 días antes. Si cambia otro mes, te pide corregir la póliza que corresponda.
  - *Comisión % (Alquiler Seguro)*: renta bruta = neto / (1 − 8,47 %).
  - *Reglas*: se crean al confirmar un movimiento en Revisar, o al marcar "Crear regla" al editar uno. Se gestionan en Maestro › Reglas.
- **Calidad de datos**: detecta incongruencias automáticamente y permite corregirlas con un clic (crear el código en el maestro, unificar mayúsculas o quitar duplicados). El informe se exporta a Excel.
