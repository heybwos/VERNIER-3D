# Vernier 3D

Un ESP32 DevKit con chip USB CH340 lee un vernier Neiko 01407A y manda líneas `M:<mm>` a 115200 baudios. `src/` es el firmware (PlatformIO). `software/` es la app: servidor FastAPI y web con Three.js.

Para instalar y correr, sigue `README.md`. Para hardware y protocolo, consulta `hacer funionar.md`.

## Seguridad del hardware

- El conector del vernier parece micro-USB, pero no es USB. Nunca indiques conectarlo a una PC, cargador, power bank ni adaptador OTG: le entrarían 5 V a un circuito de 1.5 V.
- La carcasa del conector y la malla del cable están a V+. Nunca indiques conectarlas a GND.
- No uses GPIO 0, 2, 5, 12 ni 15, que intervienen en el arranque, ni GPIO 6 a 11, conectados a la flash. CLK va a GPIO 18 y DATA a GPIO 19.

## Antes de actuar

- Pregunta si el ESP32 ya tiene el firmware. Si ya lo tiene y `src/` no cambió, no lo subas: la app solo necesita Git y Python.
- Para arrancar la app, usa `iniciar.bat`. Instala dependencias, detecta el ESP32 y busca un puerto web libre.
- No hagas commit ni push sin que el usuario lo pida.

## Subir el firmware

- En una terminal normal, `pio` puede no estar en el PATH. Usa `%USERPROFILE%\.platformio\penv\Scripts\pio.exe`.
- Cierra antes el monitor serie y la app.
- Avisa antes de subir y espera a que el usuario confirme que está junto a la placa. Debe mantener BOOT presionado desde `Connecting...` hasta `Writing at 0x...`.
- La placa no se reinicia sola. Al terminar, pide presionar EN/RST.

## Protocolo

- El firmware manda solo `M:<mm>`. La captura se hace en la página con la barra espaciadora o el botón.
- La trama no indica la unidad: el vernier debe estar en mm.
- Si no llegan lecturas, no cambies la lógica a ciegas. Pide permiso para poner `DIAGNOSTICO = true` en `src/main.cpp`, revisa pulsos y bits, y regrésalo a `false`. En ese modo la app no recibe medidas.

## Problemas conocidos

- "Acceso denegado" en el COM significa que otro programa lo ocupa, como un monitor serie o SignalRGB. Pide permiso antes de cerrar cualquier programa.
- Si la pantalla del vernier se altera al conectar GND, sospecha primero de un corto contra V+ y después de ruido del USB. En una PC de escritorio ya pasó por ruido, y en una laptop funcionó.
