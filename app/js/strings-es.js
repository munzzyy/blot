// Spanish catalog. Keys are normalized English source strings; run
// tools/extract-strings.mjs to see what is missing or stale.

export const es = {
  "Skip to content": "Saltar al contenido",
  "Redaction that destroys what it covers.": "Redacción que destruye lo que cubre.",
  "The famous redaction failures all worked the same way: a black box drawn over text that was still there underneath. Blot cannot make that mistake, because it does not keep the text. Every page becomes a picture, your ink becomes part of the picture, and the finished file is re-checked to contain nothing extractable at all.":
    "Los fracasos famosos de redacción funcionaron todos igual: un recuadro negro dibujado sobre texto que seguía debajo. Blot no puede cometer ese error, porque no conserva el texto. Cada página se convierte en una imagen, tu tinta pasa a formar parte de la imagen, y el archivo final se reverifica para contener nada extraíble en absoluto.",
  "Choose a PDF": "Elige un PDF",
  "or drop one here": "o suelta uno aquí",
  "or share a PDF to Blot from any app": "o comparte un PDF a Blot desde cualquier app",
  "or open one from Files": "o abre uno desde Archivos",
  "Everything happens on this device. Nothing is uploaded, ever.": "Todo ocurre en este dispositivo. Nunca se sube nada.",
  "Why the output is a picture, not a document": "Por qué el resultado es una imagen, no un documento",
  "A PDF is not what it looks like: under the visible page there can be a text layer, form data, comments, attachments, and earlier versions of the document. Tools that draw rectangles over that stack keep the stack. Blot renders each page to plain pixels and builds a brand new PDF containing only those pixels, so there is no stack left to leak. The cost is honest too: the output is a picture of a document, not an editable one.":
    "Un PDF no es lo que aparenta: bajo la página visible puede haber una capa de texto, datos de formularios, comentarios, adjuntos y versiones anteriores del documento. Las herramientas que dibujan rectángulos sobre esa pila conservan la pila. Blot renderiza cada página a píxeles y construye un PDF nuevo que contiene solo esos píxeles, así que no queda pila que filtrar. El coste también es honesto: el resultado es una imagen de un documento, no uno editable.",
  "What it refuses, on purpose": "Lo que rechaza, a propósito",
  "Password-protected files. Unlock them first; guessing at partial decryption is how tools mishandle documents.":
    "Archivos con contraseña. Desbloquéalos primero; adivinar descifrados parciales es como las herramientas estropean documentos.",
  "Forms with filled-in fields, and XFA documents (a dynamic form format some government and legal PDFs use). Their content lives outside the page stream, where rendering can silently miss it. Print the form to a fresh PDF first, then bring that here.":
    "Formularios con campos rellenados, y documentos XFA (un formato de formulario dinámico que usan algunos PDF de trámites y gobierno). Su contenido vive fuera del flujo de página, donde el renderizado puede perderlo en silencio. Imprime el formulario a un PDF nuevo primero y trae ese.",
  "Digitally signed documents. Flattening destroys the signature, and a redactor should not quietly do that to the one thing the file was for.":
    "Documentos firmados digitalmente. Aplanar destruye la firma, y un redactor no debería hacerle eso en silencio a lo único para lo que existía el archivo.",
  "The Android app cannot phone home": "La app de Android no puede llamar a casa",
  "Blot for Android requests no permissions at all. Your documents cannot leave the device through this app, and the manifest proves it.":
    "Blot para Android no pide ningún permiso. Tus documentos no pueden salir del dispositivo a través de esta app, y el manifiesto lo demuestra.",
  "It is not in the Play Store, so Android will warn you that it is blocking an install from outside the store. That warning exists for apps that ask for permissions and misuse them; Blot asks for none. Settings will offer a one-time \"install anyway\"; that is the only extra step.":
    "No está en la Play Store, así que Android avisará que bloquea una instalación fuera de la tienda. Ese aviso existe para apps que piden permisos y los usan mal; Blot no pide ninguno. Ajustes ofrecerá un \"instalar de todos modos\" único; ese es el único paso extra.",
  "Download the APK": "Descargar el APK",
  "One dependency, accounted for": "Una dependencia, justificada",
  "Blot reads PDFs with Mozilla's PDF.js, the same engine Firefox uses, vendored at a pinned version whose checksum is verified against the public registry and documented in the repo. Everything else is dependency-free.":
    "Blot lee los PDF con PDF.js de Mozilla, el mismo motor que usa Firefox, incluido a una versión fijada cuya suma de verificación se comprueba contra el registro público y queda documentada en el repositorio. Todo lo demás no tiene dependencias.",
  "Privacy": "Privacidad",
  "Language": "Idioma",

  "This PDF is password protected": "Este PDF tiene contraseña",
  "Blot will not guess at partial decryption. Remove the password in your PDF viewer first, then bring the unlocked file here.":
    "Blot no va a adivinar descifrados parciales. Quita la contraseña en tu visor de PDF primero y trae el archivo desbloqueado.",
  "This PDF is a filled form": "Este PDF es un formulario relleno",
  "Form answers live outside the page image, where flattening can silently lose or miss them. Print the form to a new PDF from your viewer, check the result shows everything, then redact that file here.":
    "Las respuestas del formulario viven fuera de la imagen de página, donde el aplanado puede perderlas en silencio. Imprime el formulario a un PDF nuevo desde tu visor, comprueba que el resultado muestra todo, y redacta ese archivo aquí.",
  "On a phone: open it in your PDF viewer, use Share or the menu, choose Print, then pinch open the print preview and share or save THAT as a PDF.":
    "En el móvil: ábrelo en tu visor de PDF, usa Compartir o el menú, elige Imprimir, y luego abre con dos dedos la vista previa de impresión y comparte o guarda ESO como PDF.",
  "This PDF is digitally signed": "Este PDF está firmado digitalmente",
  "Flattening would destroy the signature, and a redactor should not quietly break the one thing this file was issued for. If you accept losing the signature, print to PDF first and bring that.":
    "Aplanar destruiría la firma, y un redactor no debería romper en silencio lo único para lo que se emitió este archivo. Si aceptas perder la firma, imprime a PDF primero y trae ese.",
  "This PDF uses XFA forms": "Este PDF usa formularios XFA",
  "XFA content renders unreliably outside Adobe tools, and redacting what you cannot fully see is how leaks happen. Print it to a regular PDF first.":
    "El contenido XFA se renderiza de forma poco fiable fuera de las herramientas de Adobe, y redactar lo que no puedes ver del todo es como ocurren las filtraciones. Imprímelo a un PDF normal primero.",
  "This PDF is too long": "Este PDF es demasiado largo",
  "Blot handles up to {max} pages at a time, because every page is held in memory as an image. Split the document and redact the parts: most PDF viewers, including the Files app on a phone, can export a page range as a new PDF.":
    "Blot maneja hasta {max} páginas a la vez, porque cada página se mantiene en memoria como imagen. Divide el documento y redacta las partes: la mayoría de los visores de PDF, incluida la app Archivos del móvil, pueden exportar un rango de páginas como un PDF nuevo.",
  "This file could not be read as a PDF": "Este archivo no se pudo leer como PDF",
  "It may be damaged, or not really a PDF. Nothing was processed.": "Puede estar dañado, o no ser realmente un PDF. No se procesó nada.",
  "Choose another file": "Elegir otro archivo",

  "Close this document": "Cerrar este documento",
  "Previous page": "Página anterior",
  "Next page": "Página siguiente",
  "Undo": "Deshacer",
  "Redo": "Rehacer",
  "Page canvas. Press B to add an ink box, arrow keys to move it, Shift and arrows to resize, Delete to remove, PageUp and PageDown to change pages.":
    "Lienzo de página. Pulsa B para añadir un recuadro de tinta, flechas para moverlo, Shift y flechas para cambiar su tamaño, Suprimir para quitarlo, RePág y AvPág para cambiar de página.",
  "Redaction tools": "Herramientas de redacción",
  "Drag to ink (draw over what to hide). Ink is permanent in the export.": "Arrastra para entintar (dibuja sobre lo que quieras ocultar). La tinta es permanente en la exportación.",
  "Remove box": "Quitar recuadro",
  "Flatten & export": "Aplanar y exportar",
  "Flattening…": "Aplanando…",
  "B adds a box. Tab cycles boxes and suggestions, Enter accepts a focused suggestion. Arrows move, Shift with arrows resizes, Delete removes, PageUp and PageDown switch pages, + and - zoom, 0 fits.":
    "B añade un recuadro. Tab recorre los recuadros y sugerencias, Enter acepta una sugerencia enfocada. Las flechas mueven, Shift con flechas cambia el tamaño, Suprimir quita, RePág y AvPág cambian de página, + y - hacen zoom, 0 ajusta.",
  "Page {n} of {total}": "Página {n} de {total}",
  "Rendering page {n} of {total}": "Renderizando página {n} de {total}",
  "Rendering failed partway; this document may be too large for this device.":
    "El renderizado falló a medias; este documento puede ser demasiado grande para este dispositivo.",
  "{total} pages rendered. Drag or press B to ink.": "{total} páginas renderizadas. Arrastra o pulsa B para entintar.",
  "{count} box(es)": "{count} recuadro(s)",
  "Your ink is not exported yet. Tap close again to discard it.": "Tu tinta aún no se exporta. Toca cerrar otra vez para descartarla.",
  "Press again to discard your ink": "Toca otra vez para descartar tu tinta",
  "Box removed. {count} on this page.": "Recuadro quitado. {count} en esta página.",
  "Box restored. {count} on this page.": "Recuadro restaurado. {count} en esta página.",

  "Checked clean": "Verificado limpio",
  "Something survived": "Algo sobrevivió",
  "The finished file was reopened and re-checked: no extractable text, no annotations, no form fields. Pixels only.":
    "El archivo final se volvió a abrir y verificar: sin texto extraíble, sin anotaciones, sin campos de formulario. Solo píxeles.",
  "The finished file was re-checked and something unexpected is in it. Do not share it; please report this.":
    "El archivo final se reverificó y contiene algo inesperado. No lo compartas; por favor repórtalo.",
  "Report it:": "Repórtalo:",
  "or": "o",
  "open a security report on GitHub": "abre un reporte de seguridad en GitHub",
  "The finished file": "El archivo final",
  "{count} page(s), images only": "{count} página(s), solo imágenes",
  "Extractable text items: {count}": "Elementos de texto extraíbles: {count}",
  "Annotations and comments: {count}": "Anotaciones y comentarios: {count}",
  "Form fields: {count}": "Campos de formulario: {count}",
  "Size: {kb} KB": "Tamaño: {kb} KB",
  "Share": "Compartir",
  "Save": "Guardar",
  "Redact another document": "Redactar otro documento",
  "Could not build the output. The document may be too large for this device.":
    "No se pudo generar el resultado. El documento puede ser demasiado grande para este dispositivo.",
  "Could not read the shared file.": "No se pudo leer el archivo compartido.",
  "Blot opens one document at a time; the first shared file was opened.":
    "Blot abre un documento a la vez; se abrió el primer archivo compartido.",
  "Sharing is not available here, so it downloaded instead.": "Compartir no está disponible aquí, así que se descargó en su lugar.",
  "Choose where to save it.": "Elige dónde guardarlo.",
  "This build of Blot cannot save or share files yet. Update the app and try again.":
    "Esta versión de Blot todavía no puede guardar ni compartir archivos. Actualiza la app e inténtalo de nuevo.",

  "Ink": "Tinta",
  "Pixelate": "Pixelar",
  "Box removed": "Recuadro quitado",
  "Selection cleared": "Selección quitada",
  "Keeping {where}": "Conservando {where}",
  "Cover box added at the center. Arrow keys move it, Shift and arrows resize, Delete removes.":
    "Recuadro de cobertura añadido al centro. Las flechas lo mueven, Shift y flechas cambian su tamaño, Suprimir lo quita.",
  "Code suggestion {n} of {total}: {where}. Press Enter to cover it.":
    "Sugerencia de código {n} de {total}: {where}. Pulsa Enter para taparla.",
  "Crop draft covers the middle {pct}% of the image. Arrows move it, Shift and arrows resize, then Apply crop.":
    "El borrador de recorte cubre el {pct}% central de la imagen. Las flechas lo mueven, Shift y flechas cambian su tamaño, luego Aplicar recorte.",
  "{tool} box added": "Recuadro de {tool} añadido",
  "{tool} box {n} of {total}: {where}": "Recuadro de {tool} {n} de {total}: {where}",
  "{x}% across, {y}% down, covering {w}% by {h}%": "{x}% a lo ancho, {y}% hacia abajo, cubriendo {w}% por {h}%",

  "Tool": "Herramienta",
  "Crop": "Recortar",
  "Apply crop": "Aplicar recorte",
  "Cancel": "Cancelar",
  "Drag, or press B, to draft a crop area.": "Arrastra, o pulsa B, para trazar un área de recorte.",
  "Drag on the page, or press B, to draft a crop area. Everything outside it is discarded on export.":
    "Arrastra sobre la página, o pulsa B, para trazar un área de recorte. Todo lo que quede fuera se descarta al exportar.",
  "Draft a crop area first: drag on the page, or press B.": "Primero traza un área de recorte: arrastra sobre la página, o pulsa B.",
  "That crop area is too small.": "Esa área de recorte es demasiado pequeña.",
  "Crop applied. Everything outside it will be discarded on export.": "Recorte aplicado. Todo lo que quede fuera se descartará al exportar.",
  "Pixelation blurs blocks of pixels together. It is weaker than ink on text: small type or a short string can sometimes be reconstructed from a heavily pixelated block. Use ink for anything you need to be sure is gone.":
    "Pixelar difumina bloques de píxeles entre sí. Es más débil que la tinta sobre texto: un tipo pequeño o una cadena corta a veces se puede reconstruir a partir de un bloque muy pixelado. Usa tinta para lo que necesites que desaparezca de verdad.",

  "Find text to cover": "Buscar texto para cubrir",
  "Find text to suggest covering it": "Busca texto para sugerir cubrirlo",
  "Search this document's text": "Buscar en el texto de este documento",
  "Search": "Buscar",
  "Clear": "Borrar",
  "Search cleared.": "Búsqueda borrada.",
  "No open suggestions.": "No hay sugerencias pendientes.",
  "{count} suggestion(s) across the document. Tab on the page to review.":
    "{count} sugerencia(s) en el documento. Usa Tab en la página para revisarlas.",
  "{count} match(es) for \"{query}\" in this document's text layer.":
    "{count} coincidencia(s) de \"{query}\" en la capa de texto de este documento.",
  "Every result comes from this file's own text layer, not what the page looks like. A scanned page with no text layer will not show results here. Suggestions are dashed outlines: nothing is inked until you accept one.":
    "Cada resultado viene de la propia capa de texto de este archivo, no de cómo se ve la página. Una página escaneada sin capa de texto no mostrará resultados aquí. Las sugerencias son contornos discontinuos: nada se entinta hasta que aceptas una.",
  "Suggestion covered": "Sugerencia cubierta",
  "Could not cover that suggestion; it was too small to place.": "No se pudo cubrir esa sugerencia; era demasiado pequeña para colocarla.",
  "{total} pages rendered. Pattern sweep found {n} possible match(es); Tab to review. Drag or press B to ink.":
    "{total} páginas renderizadas. El barrido de patrones encontró {n} posible(s) coincidencia(s); usa Tab para revisar. Arrastra o pulsa B para entintar.",
  "Page(s) {list}: no text layer, so automatic search cannot check them. They are images; cover anything there by hand.":
    "Página(s) {list}: sin capa de texto, así que la búsqueda automática no puede revisarlas. Son imágenes; cubre a mano lo que haya ahí.",

  "Repeat on every page": "Repetir en cada página",
  "Added to {applied} of {total} pages.": "Añadido a {applied} de {total} páginas.",
  "Added to {applied} of {total} pages. {clamped} had a different page size and were scaled to fit; check them.":
    "Añadido a {applied} de {total} páginas. {clamped} tenían un tamaño de página distinto y se escalaron para encajar; revísalas.",

  "Ink coverage: every covered spot re-rendered dark": "Cobertura de tinta: cada punto cubierto se renderizó oscuro al volver a abrirlo",
  "Ink coverage: a covered spot re-rendered light. Do not share this file.":
    "Cobertura de tinta: un punto cubierto se renderizó claro al volver a abrirlo. No compartas este archivo.",

  "Verification receipt": "Recibo de verificación",
  "SHA-256 of the exact file below. Not a signature: it proves these bytes were not changed after this screen, not who made them or that they are safe to send. Save it alongside the file if you want to re-check later.":
    "SHA-256 del archivo exacto de abajo. No es una firma: demuestra que estos bytes no cambiaron después de esta pantalla, no quién los hizo ni que sean seguros de enviar. Guárdalo junto al archivo si quieres reverificar más tarde.",
  "Copy hash": "Copiar hash",
  "Copied.": "Copiado.",
  "Could not copy. Select and copy the hash by hand.": "No se pudo copiar. Selecciona y copia el hash a mano.",
};
