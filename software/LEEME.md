# Vernier→3D · cómo correrlo

## Una sola vez

```
pip install -r requirements.txt
```

## Para la demostración

```
python servidor.py --abrir
```

Abre `http://localhost:8000` en Chrome o Edge. Si ese puerto está ocupado, el servidor usa el siguiente libre y lo indica en la terminal. Todo funciona sin internet, porque Three.js y las fuentes están en `web/vendor/`.

- **Simulador:** presiona "Nueva medición" y el simulador mide largo, ancho y alto como lo haría una persona.
- **Manual:** escribe las tres medidas y presiona "Generar".
- **ESP32:** conéctalo por USB y elige la fuente ESP32. El puerto se detecta solo (CP2102 o CH340), o se puede elegir en la lista. También se puede arrancar ya leyendo el ESP32:

  ```
  python servidor.py --serial auto
  python servidor.py --serial COM5
  ```

  El puerto COM solo lo puede abrir un programa a la vez: **cierra el monitor serie y SignalRGB.**

  El ESP32 manda solo líneas `M:`. La lectura se captura con la **barra espaciadora** o el botón de la página.

Atajos de la página: **espacio** captura la lectura actual y **Esc** cancela el agujero en curso.

## Simulador en terminal (casos raros)

Con el servidor corriendo, en otra terminal:

```
python simulador.py
```

Escribe `M:12.5`, `C:12.5`, `caja 50 30 20`, `basura` o `salir`. La consola que está debajo del registro en la página hace lo mismo.

## Qué hace cada archivo

| Archivo | Para qué |
| --- | --- |
| `servidor.py` | Sirve la página, reparte las líneas `M:`/`C:` por WebSocket y guarda `mediciones/mediciones.json` |
| `fuentes.py` | `interpretar()` de líneas, simulador y lectura serial (misma interfaz) |
| `simulador.py` | Simulador del ESP32 desde la terminal |
| `web/app.js` | Visor 3D, flujo guiado, agujeros, validaciones y animaciones |
| `web/estilos.css` | Paleta grafito y diseño |

## Protocolo del ESP32

El ESP32 manda una línea por mensaje a 115200 baudios, en mm y con punto decimal:

- `M:25.43` es una medida en vivo.
- `C:25.43` es una medida capturada (botón Capturar).

Cualquier otra línea se ignora y queda marcada en el registro.
