# Bitácora · Vernier→3D

## 2026-10-21 · Arquitectura del software y mejoras al prototipo

**Avance**
- Servidor Python (FastAPI + WebSocket) con tres fuentes que entregan las mismas líneas `M:`/`C:`: simulador, ESP32 por USB (pyserial, autodetección CP2102/CH340, reintento) y consola. Cuando el ESP32 funcione, solo hay que conectarlo y elegir la fuente.
- Guardado de cada medición, con sus agujeros, en `software/mediciones/mediciones.json`.
- Interfaz rediseñada a partir del prototipo (`evidencia/2026-10-21_prototipo-original.html`), siguiendo `prompt_mejoras.md`:
  - paleta grafito con blanco, naranja y verde gris;
  - cotas de plano que se estiran en vivo;
  - regla de 0 a 150 mm, gráfica de lecturas e indicador de estabilidad;
  - recorrido del dato Vernier → ESP32 → USB → Servidor → Visor;
  - tarjeta "Qué se está midiendo".
- Animaciones: se quitaron el radar y el barrido de abajo hacia arriba. Las partículas (7000, calculadas en la GPU) solo aparecen al crear el sólido: nacen en las aristas medidas y viajan a la superficie. El sólido aparece por opacidad.

**Problemas y soluciones**
- La consola de Windows (cp1252) no imprimía "→" y el servidor no arrancaba. Se forzó la salida a UTF-8.
- El navegador guardaba en caché los estilos viejos. El servidor ahora pide revalidar cada archivo.

## 2026-10-21 · Bloques sobre las caras

**Avance**
- La pieza ahora es una lista de cuerpos: la caja base y bloques apoyados en una cara de otro cuerpo (también sobre otros bloques).
- Flujo del bloque: cara → esquina de origen → largo, ancho y alto → distancias X y Y a las orillas (botón "pegado" = 0). Vista previa en vivo; al confirmar, las partículas se juntan y aparece el bloque.
- Se usa la medición de escalón del vernier para el alto y las distancias: la demostración ya enseña los cuatro usos (exteriores, interiores, profundidad, escalón).
- Validaciones: se sale de la cara, se encima con otro cuerpo, tapa un agujero; aviso si la pieza pasa de 150 mm.
- El JSON guarda `cuerpos` y cada agujero indica en qué `cuerpo` está.

**Pendiente**
- Probar la fuente serial con el ESP32 real.
- Confirmar el Ø mínimo medible y la pared mínima con la impresora.

## 2026-10-22 · Árbol del modelo y agujeros que atraviesan todo

**Avance**
- Los agujeros se comportan como un taladro real: un pasante atraviesa todo el material continuo en su eje (bloque y base), y un ciego puede pasar de un cuerpo a otro. Se abren en todas las caras que cruzan.
- Validaciones nuevas: el agujero no puede cortar a medias la orilla de un cuerpo ni rozar uno que no atraviesa; un bloque no puede tapar la boca de un agujero (en la salida de un pasante sí se puede: el agujero lo atraviesa).
- Árbol del modelo: base, bloques y agujeros con su sketch (rectángulo o círculo) y su operación (extrusión o corte). Cada cota se vuelve a medir con el vernier: `M:` cambia la pieza en vivo y `C:` la fija tras revalidar toda la pieza; si algo deja de caber, se rechaza y se conserva el valor anterior.

**Pendiente**
- Agujeros rectangulares (bolsillos), pedido el 21 oct.
