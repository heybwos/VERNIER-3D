# Vernier→3D · Contexto del programa de modelado

> Este archivo es para quien construya el software (persona o Claude Code). Léelo completo antes de escribir código.
> Fecha: 21 de octubre de 2026 (actualizado con agujeros).

## 1. El proyecto en dos líneas

Un vernier digital (Neiko 01407A) manda sus medidas por un ESP32 a la laptop. La laptop genera una pieza 3D con esas medidas y la muestra en vivo.

**Esta etapa construye solo la parte de la laptop.** El vernier y el ESP32 todavía no están listos, así que el programa debe funcionar primero con medidas metidas a mano y con un simulador que imite al ESP32. Cuando el hardware funcione, solo se cambia la fuente de las medidas; el resto del programa no se toca.

## 2. Qué debe hacer esta primera versión

- Modelar **una sola figura: caja sólida** (prisma rectangular) de largo × ancho × alto, en milímetros.
- Mostrarla en un **visor 3D en el navegador** (Chrome o Edge), que se pueda girar y hacer zoom con el mouse.
- Mostrar las tres cotas como texto junto al modelo.
- Recibir medidas de **dos formas**:
  1. **Campos en la página**: escribir largo, ancho y alto y ver la caja al instante.
  2. **Simulador del ESP32**: un script que manda las mismas líneas de texto que mandará el ESP32 real (sección 5).
- Dejar preparada, sin terminar, una tercera fuente: **puerto serial real** (el ESP32 por USB).
- **Segunda etapa, con la caja ya funcionando:** agujeros redondos pasantes o ciegos, perpendiculares a una cara (sección 16).

Fuera de esta versión: caja a la medida con tapa, cilindros, agujeros en ángulo, ranuras, avellanados, patrones de agujeros, exportar STL/STEP, SolidWorks, Bluetooth. Se agregan después, sin rehacer lo que ya funcione.

## 3. Arquitectura

```
 Fuente de medidas            Servidor Python                 Navegador
┌──────────────────┐        ┌───────────────────────┐       ┌────────────────────┐
│ A. Campos web     │──────▶│                       │       │ Visor 3D (Three.js)│
│ B. Simulador      │──────▶│  Estado de la medición │◀────▶│ Campos L / W / H   │
│ C. Serial (ESP32) │──────▶│  (qué cota sigue)      │  WS   │ Cotas en pantalla  │
└──────────────────┘        └───────────────────────┘       └────────────────────┘
```

- **Servidor en Python** que sirve la página en `http://localhost:8000` y se comunica con ella por **WebSocket**.
- **Todas las fuentes entregan lo mismo**: un valor en mm y si es "en vivo" o "capturado". El servidor no debe saber de qué fuente viene.
- Los **campos de la página** (fuente A) pueden actualizar el modelo directo en el navegador, sin pasar por el servidor. Las fuentes B y C sí pasan por el servidor.

### Tecnologías sugeridas

| Parte | Qué usar | Nota |
| --- | --- | --- |
| Lenguaje servidor | Python 3.11 o más nuevo | Windows |
| Servidor web + WebSocket | FastAPI + uvicorn (o Flask-SocketIO) | Escoger uno y no mezclar |
| Lectura serial (después) | pyserial | Solo para la fuente C |
| Visor | Three.js, **versión fija descargada en la carpeta del proyecto** | La feria puede no tener internet: nada se carga desde un CDN |
| Controles del visor | OrbitControls de la misma versión de Three.js | Girar, mover, zoom |

## 4. Reglas del modelo 3D

- **Unidades:** todo en milímetros, de punta a punta. No convertir a metros en esta etapa (SolidWorks sí los usará después).
- **Ejes en Three.js:** X = largo, Y = alto, Z = ancho. Es decir, `new THREE.BoxGeometry(largo, alto, ancho)`.
- **Apoyo:** la caja descansa sobre una cuadrícula en el plano del piso (su base en Y = 0), no centrada en el origen.
- **Cuadrícula de referencia** de 10 mm por cuadro, para que se note el tamaño real.
- **Cámara:** al cambiar las medidas, encuadrar la caja automáticamente para que siempre se vea completa.
- **Cotas visibles:** "Largo 50.00 mm", "Ancho 30.00 mm", "Alto 20.00 mm", siempre con dos decimales.
- **Validación:** solo valores mayores que 0 y hasta 150 mm (el rango del vernier). Un valor fuera de rango se rechaza con un mensaje claro y la caja no cambia.
- **La cota que se está midiendo** se resalta (color o flecha) en el modelo.

## 5. Protocolo de mensajes (igual al del ESP32 real)

El ESP32 mandará por USB **una línea de texto por mensaje**, terminada en salto de línea, a **115200 baudios**:

| Línea | Significado |
| --- | --- |
| `M:25.43` | Medida **en vivo**: lo que marca el vernier en este momento, en mm |
| `C:25.43` | Medida **capturada**: el usuario presionó el botón Capturar |

Reglas:
- Decimal con punto, siempre en mm. Puede ser negativo (`M:-3.10`).
- Cualquier línea que no cumpla el formato se **ignora** sin tronar el programa.
- `M:` mueve el modelo en vivo sobre la cota activa; `C:` fija esa cota y pasa a la siguiente.

**El simulador (fuente B) debe producir exactamente estas líneas**, para que al conectar el ESP32 real no cambie nada más.

## 6. Flujo guiado de medición

1. El usuario presiona "Nueva medición".
2. La pantalla pide: **"Mide el LARGO y presiona Capturar"**. La cota de largo se resalta.
3. Mientras llegan `M:`, la caja cambia de largo en vivo.
4. Al llegar `C:`, el largo queda fijo y pasa a **ANCHO**, luego a **ALTO**.
5. Con las tres cotas capturadas, muestra "Medición completa" y guarda el resultado.
6. Botón "Repetir cota" para volver a medir la última.

Con la fuente A (campos), el flujo guiado no aplica: se escriben los tres valores y la caja se actualiza.

## 7. Simulador del ESP32 (fuente B)

- Script de Python **dentro del mismo programa**, no un puerto COM virtual: en Windows eso requiere drivers extra (como com0com) y no vale la pena.
- Debe imitar una medición real:
  - mandar `M:` cada ~150 ms con valores que suben poco a poco, como cuando se abre el vernier, con pequeño ruido de ±0.01 mm;
  - después de unos segundos, mandar `C:` con el valor final;
  - repetir para ancho y alto.
- Opción para meter líneas a mano en la terminal (`M:12.5`, `C:12.5`) y probar casos raros: texto basura, negativos, fuera de rango.

## 8. Fuente serial real (fuente C, dejar lista para después)

- Abrir el puerto COM con pyserial a 115200 baudios y leer línea por línea.
- Elegir el puerto en la configuración o detectarlo por la descripción del chip USB (CP2102 o CH340).
- Si el puerto se desconecta, reintentar sin cerrar el programa.
- Recordar: **el puerto COM solo lo puede abrir un programa a la vez**; el Monitor Serie de Arduino IDE debe estar cerrado.

## 9. Guardar resultados

Cada medición completa se agrega a `mediciones/mediciones.json` con:

```json
{ "fecha": "2026-10-21T14:30:05", "figura": "caja", "fuente": "simulador",
  "largo_mm": 50.00, "ancho_mm": 30.00, "alto_mm": 20.00,
  "agujeros": [
    { "id": 1, "cara": "superior", "esquina": 1, "diametro_mm": 6.02,
      "x_pared_mm": 8.00, "y_pared_mm": 5.00, "x_centro_mm": 11.01, "y_centro_mm": 8.01,
      "tipo": "pasante", "profundidad_mm": 20.00 }
  ] }
```

Se guardan **las medidas tal como salieron del vernier** (`x_pared_mm`, `y_pared_mm`) y también el centro calculado. Así se puede revisar después si hubo un error al medir o al calcular.

Esto servirá para la tabla de pruebas del póster.

## 10. Estructura de carpetas sugerida

```
Vernier3D/
  contexto.md              ← este archivo
  bitacora.md              ← avances, problemas y soluciones (para el video final)
  evidencia/               ← fotos y clips con fecha en el nombre
  firmware/                ← programas del ESP32 (otra etapa)
  software/
    servidor.py            ← servidor web + WebSocket + estado de la medición
    fuentes.py             ← fuente simulador y fuente serial, misma interfaz
    simulador.py           ← punto de entrada para correr el simulador
    web/
      index.html
      app.js               ← visor Three.js, campos, flujo guiado
      vendor/three/        ← Three.js y OrbitControls descargados (versión fija)
    mediciones/
      mediciones.json
    requirements.txt
```

## 11. Orden de construcción

Cada paso debe funcionar antes de pasar al siguiente.

1. **Visor estático.** `index.html` con Three.js local: una caja de 50 × 30 × 20 mm, cuadrícula y control con mouse. Se abre con doble clic o con un servidor simple.
2. **Campos manuales.** Tres campos; la caja cambia al escribir y rechaza valores fuera de rango.
3. **Servidor Python.** Sirve la página en `localhost:8000` y abre el WebSocket. Prueba: un mensaje desde Python cambia la caja.
4. **Simulador.** Manda `M:`/`C:` al servidor y la caja crece en vivo.
5. **Flujo guiado.** Pide largo, ancho y alto en orden, con la cota activa resaltada.
6. **Guardado JSON.**
7. **Fuente serial.** Se deja escrita. Se prueba cuando el ESP32 mande `M:` y `C:` de verdad.
8. **Agujeros** (sección 16), en este orden: selección de cara → esquina de origen → medición Ø/X/Y/profundidad con vista previa → validaciones → dibujar el agujero → guardar en el JSON.

## 12. Cómo saber que esta etapa está terminada

- Con los campos: escribir 50, 30 y 20 da una caja que, medida con la cuadrícula, tiene esas dimensiones.
- Con el simulador: una medición completa en menos de 30 segundos, la caja creciendo en vivo y el resultado guardado en el JSON.
- Mandar texto basura o un valor de 200 mm no rompe nada y muestra un aviso.
- Cerrar y abrir la página no tumba el servidor; la página se reconecta sola.
- Todo funciona **sin internet**.
- Agujeros (segunda etapa):
  - Un agujero pasante de Ø6 con X = 8 y Y = 5 desde la esquina 1 de la cara superior queda con el centro a 11.00 / 8.00 mm de esa esquina, medido en el visor.
  - Un Ø más grande que la cara, una profundidad mayor que el grosor o dos agujeros que se enciman se rechazan con un mensaje claro.
  - El volumen baja exactamente π·r²·profundidad por agujero.

## 13. Datos del hardware (referencia, no se usan todavía)

- Vernier: Neiko 01407A, 0–150 mm, resolución 0.01 mm, exactitud ±0.02 mm.
- El ESP32 hará la lectura del vernier y la conversión a mm. **La laptop solo recibe texto `M:`/`C:`.** Ningún detalle de bits ni de voltajes debe aparecer en este programa.
- Lo del puerto del vernier (pads, formato de 24 bits) está **por verificar** y vive en la guía "Pines del vernier", no aquí.

## 14. Pendientes y decisiones abiertas

- Fecha exacta de la feria: **por confirmar**.
- Siguientes figuras: caja a la medida con tapa (holgura y pared), cilindro o buje.
- Agujeros:
  - **Ø mínimo medible:** depende de si la punta de las mordazas de interiores cabe en el agujero. Hay que comprobarlo con el Neiko.
  - **Pared mínima:** el aviso de ~1 mm es un estimado para impresión FDM. Hay que confirmarlo con la impresora que usen.
  - Posibles mejoras después: patrón de agujeros (fila o rejilla), modo preciso (medir X desde las dos orillas y comprobar el Ø), avellanado y caja para tornillo.
- Siguientes salidas: STL/STEP con CadQuery y pieza en SolidWorks con plantilla de cotas (la API de SolidWorks usa metros).
- Cada avance, problema y solución se anota en `bitacora.md` con fecha y foto o captura en `evidencia/`.

## 15. Diseño de la interfaz (aprobado como dirección, 21 oct)

Existe un prototipo funcional en HTML ("Escáner Vernier→3D") que sirve de referencia visual y de punto de partida para `web/`. Usa Three.js r128 y OrbitControls; para la versión final, descargar esos mismos archivos a `web/vendor/three/`.

**Concepto:** la pantalla imita el flujo real de la ingeniería inversa: medición → nube de puntos → malla → sólido CAD.

**Estilo:** consola de instrumento oscura. Cian para el sistema, ámbar para lo que se está midiendo en vivo, verde para lo capturado y rojo para errores. Tipografía técnica (Chakra Petch para títulos, JetBrains Mono para números).

**Distribución:** barra de estado arriba; a la izquierda la secuencia L/A/H y los controles; al centro la vista 3D; a la derecha la lectura en vivo y las métricas; abajo el registro de eventos con hora y cada línea `M:`/`C:`.

**Animaciones:**

1. **Espera:** nube de partículas girando y un barrido de radar sobre la cuadrícula.
2. **Medición progresiva 1D → 2D → 3D:** al medir el largo aparece una línea ámbar que crece en vivo; con el ancho se vuelve un plano; con el alto se extruye a volumen. Cada `C:` hace un destello verde en su paso.
3. **Reconstrucción (~4.3 s) al capturar las tres cotas:**
   - 01 Nube de puntos: ~4200 partículas viajan en arco a puntos de la superficie de la caja.
   - 02 Malla: las 12 aristas se dibujan una por una.
   - 03 Sólido: un plano de escaneo sube de abajo hacia arriba y deja la caja sólida.
   - Las partículas se desvanecen y aparecen las cotas y las métricas.
4. **Pieza lista:** las aristas pulsan suavemente y la cámara encuadra la pieza sola.

**Métricas calculadas:** volumen (cm³), área superficial (cm²), diagonal (mm), masa si fuera maciza en PLA (densidad 1.24 g/cm³) y número de agujeros. Volumen, área y masa ya descuentan los agujeros.

**Reglas:**
- La lectura en vivo nunca espera a una animación: los `M:` mueven el modelo al instante. La animación larga solo ocurre al terminar la medición.
- Con "reducir movimiento" activado en el sistema, la reconstrucción salta directo al resultado.
- Ninguna librería ni fuente desde internet en la versión de feria.

## 16. Agujeros (segunda etapa, aprobada el 21 oct)

Agujeros **redondos y perpendiculares a una cara**, pasantes o ciegos. Ya funcionan en el prototipo "Escáner Vernier→3D", que es la referencia de comportamiento.

### 16.1 Por qué se mide a la pared y no al centro

El centro de un agujero está en el aire: el vernier no tiene dónde apoyarse. Lo que sí se mide es la distancia de **la orilla de la pieza a la pared del agujero**. Se usan las mordazas de exteriores: una punta afuera de la pieza y la otra dentro del agujero.

```
 orilla de referencia
 │← X →│   ╭───╮
 │█████│  (  ●  )      centro X = X + Ø/2
 │█████│   ╰───╯
       └ pared más cercana del agujero
```

Por eso **el diámetro se mide primero**: sin él no se puede calcular el centro.

### 16.2 Flujo

1. **Elegir la cara.** Con un clic sobre el modelo, o con 6 botones: Superior, Inferior, Frontal, Trasera, Derecha, Izquierda. La cara se ilumina y aparece "＋ Agujero".
   - Distinguir clic de arrastre: si el puntero se movió más de ~6 px, fue un giro de cámara, no una selección.
2. **Elegir la esquina de origen.** Se marcan las 4 esquinas de la cara con los números 1–4.
   - De la esquina elegida salen las flechas X y Y por las orillas.
   - La cámara se acerca a esa cara.
3. **Elegir el tipo.**
   - **Pasante** (por defecto): la profundidad es el grosor completo y no se mide.
   - **Ciego:** se mide la profundidad con la varilla.
4. **Medir en orden**, con el mismo protocolo `M:`/`C:` de la sección 5:

   | Paso | Qué se mide | Herramienta del vernier |
   | --- | --- | --- |
   | Ø | Diámetro | Mordazas de interiores |
   | X | Orilla de referencia en X → pared del agujero | Mordazas de exteriores |
   | Y | Orilla de referencia en Y → pared del agujero | Mordazas de exteriores |
   | P | Profundidad (solo si es ciego) | Varilla de profundidad |

   - Cada `C:` pasa al siguiente paso.
   - Al medir X se resalta en ámbar la orilla desde la que se mide; lo mismo con Y.
5. **Vista previa.** Se muestran un cilindro fantasma ámbar con sus líneas de cota y el centro calculado ("X 11.01 · Y 8.01 mm desde la esquina 1").
6. **Confirmar.** Se perfora la pieza, se actualizan las métricas y el agujero entra a una lista donde se puede quitar.
7. "Medir de nuevo" borra las medidas del agujero actual. "Cancelar" (o Esc) lo descarta.

Las fuentes son las mismas de la caja: simulador, campos manuales (Ø, X, Y, Prof.) y, después, el ESP32.

### 16.3 Geometría y convenciones

- Cada cara tiene un sistema local: centro `c`, normal hacia afuera `N` y ejes `U` y `V` en el plano de la cara, con `U × V = N`. Tamaños: `su` × `sv`; grosor `t` (la medida de la pieza en dirección `N`).

  | Cara | N | U | V | su × sv | t |
  | --- | --- | --- | --- | --- | --- |
  | Superior | +Y | +X | −Z | L × W | H |
  | Inferior | −Y | +X | +Z | L × W | H |
  | Frontal | +Z | +X | +Y | L × H | W |
  | Trasera | −Z | −X | +Y | L × H | W |
  | Derecha | +X | −Z | +Y | W × H | L |
  | Izquierda | −X | +Z | +Y | W × H | L |

- Las esquinas 1–4 tienen signos `(su, sv)` = (−,−), (+,−), (+,+), (−,+).
- Centro en coordenadas de la cara, con `r = Ø/2` y `(cu, cv)` los signos de la esquina:
  `u = cu·(su/2 − X − r)`, `v = cv·(sv/2 − Y − r)`.
- Un agujero pasante abre también la cara opuesta, en el mismo punto proyectado.
- Si una profundidad medida queda a ±0.05 mm del grosor, se trata como pasante.

### 16.4 Validaciones

**Bloquean** (no se puede confirmar):
- Ø ≤ 0 o Ø ≥ el lado menor de la cara.
- X ≤ 0 o X + Ø ≥ `su`; Y ≤ 0 o Y + Ø ≥ `sv`. Es decir, el agujero se sale de la cara.
- Profundidad mayor que el grosor `t`.
- Choca con otro agujero:
  - En la misma cara o en la opuesta, se compara la distancia entre ejes con r₁ + r₂, y se revisa si los tramos de profundidad se enciman.
  - En caras perpendiculares, se usa una prueba conservadora con cajas envolventes. Puede marcar choque cuando por poco no lo hay.

**Avisan** (se puede confirmar):
- Pared de menos de ~1 mm hasta cualquier orilla, o fondo de un agujero ciego de menos de ~1 mm. Es un estimado para FDM.
- Menos de 1 mm entre dos agujeros.

Un `C:` que no pasa la validación de su paso se rechaza en el registro y el paso sigue activo.

### 16.5 Cómo se construye la geometría (importante)

- **Visor:** el prototipo no hace resta booleana. Dibuja cada cara de la caja como una figura con huecos circulares (`THREE.Shape` + `holes` + `ShapeGeometry`). Las paredes del agujero son cilindros abiertos y el fondo del ciego es un círculo. Esto **solo sirve para cajas**.
- **Archivos reales (STL/STEP), etapa siguiente:** la geometría verdadera la debe hacer **CadQuery en Python**, que sea la única fuente de verdad:

  ```python
  pieza = cq.Workplane("XY").box(L, W, H)          # ajustar el origen a la convención de la sección 4
  pieza = (pieza.faces(">Z").workplane(centerOption="CenterOfBoundBox")
                .center(u, v).hole(d)              # pasante
          )                                         # ciego: .hole(d, profundidad)
  ```

  - Antes de usarlo, revisar que el selector de cara y los ejes del workplane de CadQuery correspondan a la tabla de 16.3. CadQuery usa Z hacia arriba y Three.js usa Y; hay que mapear los ejes con cuidado.
  - Cuando exista la exportación, el visor puede cargar la malla que genere CadQuery, para que lo que se ve sea exactamente lo que se exporta.
- **SolidWorks (después):** con un corte extruido sobre un croquis en la cara o con el Asistente para taladro. La API usa metros.

### 16.6 Animaciones y métricas

- Mientras se mide, el cilindro fantasma ámbar y las cotas se mueven en vivo con cada `M:`.
- Al confirmar:
  - Un anillo cian baja por el agujero (~1.1 s) y saltan "virutas" ámbar.
  - La pieza se reconstruye con el hueco y hace un destello cian breve.
  - Con "reducir movimiento" no hay virutas.
- Métricas:
  - Volumen − π·r²·profundidad por agujero.
  - Área + 2π·r·profundidad (pared) − 2π·r² si es pasante (las dos bocas). En el ciego, la boca y el fondo se compensan.
- Los agujeros terminados muestran su número (#1, #2…) sobre la pieza.
- Una nueva medición de caja borra los agujeros. "Repetir reconstrucción" los conserva.
