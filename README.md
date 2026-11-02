# Vernier 3D

Un ESP32 lee un vernier digital Neiko 01407A y manda las medidas por USB a una app que genera la pieza en 3D.

Esta guía es para Windows. Con el ESP32 ya programado no necesitas VS Code ni PlatformIO.

> ⚠️ **El conector del vernier parece micro-USB, pero no es USB.** Nunca lo conectes a una laptop, cargador ni power bank: le entrarían 5 V a un circuito de 1.5 V. A la laptop solo se conecta el **ESP32**.

---

## Primera vez en una laptop

### 1. Instala lo necesario

| Programa | Detalle |
|---|---|
| [Git](https://git-scm.com/download/win) | Para descargar el proyecto |
| [Python 3](https://www.python.org/downloads/) | Marca **Add python.exe to PATH** al instalar |
| [Driver CH340](https://www.wch-ic.com/downloads/CH341SER_EXE.html) | Solo si Windows no reconoce el ESP32 |

### 2. Descarga el proyecto

Abre una terminal en la carpeta donde lo quieras guardar y ejecuta:

```
git clone https://github.com/heybwos/VERNIER-3D.git
```

### 3. Conecta el hardware

1. Enciende el vernier y déjalo en **mm**.
2. Revisa que el vernier esté conectado al ESP32.
3. Conecta el ESP32 a la laptop con un **cable USB de datos**.

### 4. Abre la app

Entra a la carpeta `VERNIER-3D` y haz doble clic en **`iniciar.bat`**.

La primera vez necesita internet para instalar las dependencias. Después se abre la app en el navegador, y detecta sola el ESP32 y un puerto libre.

**Deja abierta la ventana negra** mientras uses la app. Para salir, ciérrala.

### 5. Mide

1. Revisa que la fuente sea **ESP32**.
2. Presiona **Nueva medición**.
3. Mide el largo con el vernier y presiona la **barra espaciadora** para capturarlo.
4. Repite con el ancho y el alto.

Después puedes tocar una cara de la pieza para agregar agujeros o bloques.

---

## Las siguientes veces

Para bajar lo último del repo, abre una terminal en `VERNIER-3D` y ejecuta:

```
git pull
```

Luego conecta el ESP32 y haz doble clic en **`iniciar.bat`**.

---

## Si algo falla

| Síntoma | Qué hacer |
|---|---|
| "No encontré Python" | Instala Python con **Add python.exe to PATH** y abre `iniciar.bat` otra vez |
| La app no encuentra el ESP32 | Instala el driver CH340 y prueba otro cable USB; los de solo carga no sirven |
| "El puerto está ocupado" en la app | Cierra el monitor serie, SignalRGB o cualquier programa que use el puerto |
| La app se conecta, pero no llegan lecturas | Presiona **EN/RST** en el ESP32 y revisa que el vernier esté encendido y bien conectado |
| Los números del vernier se vuelven locos al conectar la tierra | Puede ser ruido del USB. Prueba con la laptop desconectada del cargador o en otro puerto |
| La medida no coincide con la pantalla | Pasa el vernier a **mm** |

---

## Solo si cambias el firmware o usas otro ESP32

Un ESP32 nuevo o un cambio en `src/` necesita subir el firmware. Para eso instala VS Code con la extensión PlatformIO, abre la carpeta del proyecto y sube el programa:

1. Cierra el monitor serie y la app.
2. Presiona **Subir** (→) en la barra de PlatformIO.
3. Cuando aparezca `Connecting...`, mantén presionado **BOOT**. Suéltalo al ver `Writing at 0x...`.
4. Al terminar, presiona **EN/RST**.

---

## Más información

- [hacer funionar.md](hacer%20funionar.md): hardware, conexiones y protocolo.
- [software/LEEME.md](software/LEEME.md): detalles de la app.
- [prueba-laptop.md](prueba-laptop.md): prueba completa en una laptop.
