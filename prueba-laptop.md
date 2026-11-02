# Prueba de instalación en laptop · 2026-11-02

Se instaló Vernier 3D desde cero en una laptop: se clonó el repo, se instalaron las dependencias, se compiló y subió el firmware, se leyó el puerto serie y se arrancó la app. Todo se probó con el ESP32 y el vernier reales.

**Resultado:** todo funcionó. El único problema fue que **el puerto 8000 estaba ocupado** por otra app, así que el servidor se arrancó en el **8001**.

---

## 1. Equipo y software encontrado

| Elemento | Valor |
|---|---|
| Sistema | Windows 11 |
| Git | 2.55.0 |
| Python | `python` = 3.11.1 (también está 3.13.0 con `py`) |
| PlatformIO Core | 6.2.0, instalado por la extensión de VS Code |
| Escritorio | `C:\Users\itsbw\OneDrive\Escritorio` (el Escritorio está dentro de OneDrive) |
| Repo clonado en | `C:\Users\itsbw\OneDrive\Escritorio\VERNIER-3D`, rama `main` |
| Puerto del ESP32 | **COM3**, `USB-SERIAL CH340` (VID:PID `1A86:7523`) |
| Otros puertos | COM5 y COM7 son Bluetooth, no son la placa |

No hubo que instalar nada: Git, Python, PlatformIO y el driver CH340 ya estaban.

---

## 2. Pasos y resultados

| # | Paso | Comando | Resultado |
|---|---|---|---|
| 1 | Revisar herramientas | `git --version`, `python --version`, `pio --version` | Todo instalado; `pio` **no** está en el PATH |
| 2 | Clonar | `git clone https://github.com/heybwos/VERNIER-3D.git` | ✔ |
| 3 | Dependencias | `pip install -r software/requirements.txt` | ✔ fastapi 0.162, uvicorn 0.54, websockets 17.4, pyserial 3.5 |
| 4 | Compilar | `pio run` | ✔ `[SUCCESS]` en 28 s |
| 5 | Buscar la placa | `pio device list` | ✔ `USB-SERIAL CH340 (COM3)` |
| 6 | Subir firmware | `pio run -t upload --upload-port COM3` | ✔ con BOOT presionado; 271 904 bytes, `Hash of data verified` |
| 7 | Leer el puerto serie | lectura con pyserial durante 6 s | ✔ líneas `M:` con el mismo valor que la pantalla |
| 8 | Arrancar la app | `python servidor.py --serial auto --abrir` | ✘ puerto 8000 ocupado → ✔ con `--puerto-web 8001` |
| 9 | Medir en la app | fuente ESP32 → Nueva medición → espacio | ✔ confirmado por el usuario |

---

## 3. Pruebas con el hardware real

### Subida del firmware
- Hubo que **mantener BOOT** desde `Connecting...` hasta `Writing at 0x...`, como dice la guía.
- esptool imprime `Hard resetting via RTS pin...`, pero **la placa no se reinicia sola**. Hubo que presionar **EN/RST**.

### Lectura serie
- Vernier en mm, con la pantalla en **13.60 mm**.
- En 6 s llegaron **47 líneas** (unas 7.8 por segundo), lo que coincide con las ~7.5 tramas por segundo medidas antes.
- Todas decían `M:13.60`, salvo una `M:13.61`. Es el vaivén de una centésima que ya se había visto (0.00 / 0.01); no es un error.
- No aparecieron líneas basura ni tramas incompletas: el firmware solo manda líneas `M:` válidas.
- Abrir el puerto con pyserial (con `dtr=False` y `rts=False`) **no reinicia** la placa.

### App
- Con `--serial auto`, el servidor **detectó COM3 solo**.
- Estado que manda el servidor por WebSocket (`/ws`):
  ```json
  {"tipo": "estado", "activa": "serial",
   "serial": {"puerto": "COM3", "pedido": "auto", "conectado": true, "mensaje": "Conectado a COM3"}}
  ```
- Cada lectura llega así:
  ```json
  {"tipo": "lectura", "modo": "M", "valor": 13.6, "crudo": "M:13.60", "fuente": "esp32"}
  ```
- El usuario confirmó que la página funciona y mide correctamente con el ESP32.

---

## 4. Hallazgos

### 4.1 El puerto 8000 estaba ocupado (el único problema real)

Al arrancar, el servidor falló con:
```
ERROR: [Errno 13] error while attempting to bind on address ('127.0.0.1', 8000):
intento de acceso a un socket no permitido por sus permisos de acceso
```

- **Causa:** el panel **"Comando Last Ashes"**, otro proyecto, ya escuchaba en `0.0.0.0:8000`. Es un `python.exe` (PID 12652, con proceso padre 17468) abierto desde el 27/09/2026. Windows no mostraba su ruta ni su comando, probablemente porque corre como administrador.
- **Síntoma engañoso:** `http://localhost:8000` sí respondía (HTTP 200), pero con la página de Last Ashes. Su WebSocket `/ws` respondía con error 500.
- **Otro detalle:** `--abrir` abre el navegador **antes** de comprobar que el puerto está libre. Por eso se abrió una pestaña con la página equivocada aunque el servidor ya había fallado.
- **Solución:** sin cerrar Last Ashes, se arrancó en otro puerto:
  ```
  python servidor.py --serial auto --abrir --puerto-web 8001
  ```
  La página queda en **http://localhost:8001**. Si Last Ashes no está corriendo, el comando normal usa el 8000.

Para saber qué ocupa el puerto 8000:
```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen | Select-Object OwningProcess
```

### 4.2 Monitor serie abierto → "Acceso denegado" en COM3

- Antes de subir, COM3 daba **"Se ha denegado el acceso al puerto"**.
- **Causa:** había un `pio device monitor --environment esp32dev` abierto en VS Code (PID 5280).
- **Solución:** se cerró el monitor y el puerto quedó libre. El proceso siguió vivo pero ya sin el puerto, y no estorbó la subida ni la app.
- Para encontrar el monitor que ocupa el puerto:
  ```powershell
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'device monitor' } | Select-Object ProcessId, CommandLine
  ```

### 4.3 `pio` no está en el PATH

En una terminal normal no se reconoce `pio`. Funciona con la ruta completa:
```powershell
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run
```
O desde la terminal **PlatformIO Core CLI** de VS Code (🐜 → Quick Access → Miscellaneous).

### 4.4 Otros detalles

- **El Escritorio está en OneDrive** (`...\OneDrive\Escritorio`). El repo se sincroniza con la nube; no causó problemas.
- **pip instaló en el usuario** (`AppData\Roaming\Python\Python311\site-packages`) porque Python está en `C:\Program Files`. Funciona igual.
- **`platformio.ini` no fija el puerto** y PlatformIO detectó bien COM3. Igual se usó `--upload-port COM3` para no depender de la detección.

---

## 5. Comandos para la próxima vez

```powershell
cd C:\Users\itsbw\OneDrive\Escritorio\VERNIER-3D

# Firmware (BOOT al subir, EN/RST al terminar)
& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" run -t upload --upload-port COM3

# App (cierra antes el monitor serie y SignalRGB)
cd software
python servidor.py --serial auto --abrir --puerto-web 8001
```
Abre la página en **Chrome o Edge**: http://localhost:8001

---

## 6. Pendientes sugeridos

- Agregar a `hacer funionar.md` y a `software/LEEME.md` la opción `--puerto-web` y qué hacer si el 8000 está ocupado.
- Que `servidor.py` revise que el puerto esté libre **antes** de abrir el navegador, o que avise claramente y pruebe el siguiente puerto.
