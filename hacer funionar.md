# Vernier 3D: lectura de un vernier digital con ESP32

El ESP32 lee la medición de un vernier digital **Neiko 01407A** (placa interna **SB-004-09AF**) a través de sus señales CLK y DATA, la convierte a milímetros y la imprime por el puerto serie.

**Estado:** probado y funcionando. Las lecturas coinciden con la pantalla del vernier: 0.00, 0.01, 10.10 y −3.95 mm.

---

## 1. Hardware

| Elemento | Detalle |
|---|---|
| Vernier | Neiko 01407A, placa SB-004-09AF |
| Microcontrolador | ESP32 DevKit (en PlatformIO: `esp32dev`, "ESP32 Dev Module") |
| Chip USB del DevKit | **CH340** (VID:PID `1A86:7523`) |
| Nivel de las señales del vernier | ~1.5 V |

### Adaptador de nivel (uno por señal)

El vernier trabaja a ~1.5 V y el ESP32 a 3.3 V. Cada señal (CLK y DATA) pasa por un transistor NPN:

```
Pad del vernier ──[10 kΩ]── Base (NPN)
                            Emisor ── GND
3V3 ──[10 kΩ]──┬── Colector
               └──────────────► GPIO del ESP32
```

**La señal llega INVERTIDA al ESP32:** cuando el vernier está en alto, el GPIO lee bajo, y al revés. El código ya lo compensa, así que no hay que quitar la inversión.

### Conexiones

| Señal del vernier | Pin del ESP32 |
|---|---|
| **CLK** | **GPIO 18** |
| **DATA** | **GPIO 19** |
| GND | GND (**tierra común obligatoria**) |

**Confirmado en las pruebas:** el pad que va a GPIO 18 es CLK y el que va a GPIO 19 es DATA. Con los jumpers intercambiados, el número de bits por trama varía (1, 3, 13, 17, 20...) y no se puede leer nada.

### Conector del vernier (huella micro-USB de la placa)

La placa trae una huella micro-USB sin conector; se le soldó un conector micro-USB B y se usa un cable micro-USB cortado. Pads numerados P1 a P5 de izquierda a derecha, con el borde de la placa hacia arriba:

| Pad | Señal | Uso |
|---|---|---|
| P1 | V+ (pila, ~1.5 V), unido a las anclas del conector | **No se conecta**; hilo aislado |
| P2 | GND (− de la pila) | GND del ESP32 |
| P3 / P4 | CLK y DATA | Entradas de los adaptadores NPN |
| P5 | Sin conexión | — |

> ⚠️ **Ese conector no es USB.** Nunca conectes el vernier a una PC, cargador, power bank ni adaptador OTG: le entrarían 5 V a un circuito de 1.5 V.
> La carcasa del conector está a V+, así que la malla del cable va cortada al ras y aislada, **nunca a GND**.

**Pines que NO se deben usar:** GPIO 0, 2, 5, 12 y 15, porque intervienen en el arranque del ESP32, y GPIO 6–11, que están conectados a la memoria flash.

---

## 2. Instalación en otra computadora

1. Instala **VS Code** y la extensión **PlatformIO IDE**.
2. Instala el **driver CH340** si Windows no reconoce la placa. Sin driver, la placa no aparece como puerto COM.
3. Usa un **cable USB de datos**. Los cables de solo carga no muestran ningún puerto.
4. Copia esta carpeta y ábrela en VS Code con **File → Open Folder**. La carpeta `.pio/` no hace falta copiarla, se regenera al compilar.
5. Busca el puerto de la placa:
   - Ícono de hormiga 🐜 → **Quick Access → Miscellaneous → PlatformIO Core CLI**, y en esa terminal escribe:
     ```
     pio device list
     ```
   - Busca la línea **`USB-SERIAL CH340 (COMx)`**. Los puertos que dicen "Bluetooth" no son la placa.
6. `platformio.ini` no fija el puerto, así que PlatformIO lo detecta solo. Si detecta otro, indícalo a mano con `--upload-port COMx` al subir y `--port COMx` en el monitor.

> **Nota:** en una terminal normal de PowerShell, `pio` puede no estar en el PATH. Usa la terminal **PlatformIO Core CLI** o la ruta completa:
> `& "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe" <comando>`

---

## 3. Archivos del proyecto

### `platformio.ini`

```ini
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino
monitor_speed = 115200
```

### `src/main.cpp`

```cpp
#include <Arduino.h>

const int PIN_CLK  = 18;
const int PIN_DATA = 19;
const uint32_t PAUSA_US = 2000;
const bool DIAGNOSTICO = false;  // true: imprime tramas y pulsos en lugar de líneas M:

volatile uint32_t pulsos = 0, ultimo = 0, bits = 0, trama = 0;
volatile uint8_t  nbits = 0, tramaBits = 0;
volatile bool lista = false;

void IRAM_ATTR onClk() {
  uint32_t ahora = micros();
  if (ahora - ultimo > PAUSA_US) {
    if (nbits > 0) { trama = bits; tramaBits = nbits; lista = true; }
    bits = 0; nbits = 0;
  }
  ultimo = ahora;
  if (nbits < 32) {
    if (!digitalRead(PIN_DATA)) bits |= (1UL << nbits);
    nbits++;
  }
  pulsos++;
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_CLK, INPUT);
  pinMode(PIN_DATA, INPUT);
  attachInterrupt(digitalPinToInterrupt(PIN_CLK), onClk, RISING);
}

void loop() {
  static uint32_t t = 0;
  if (lista) {
    noInterrupts();
    uint32_t b = trama; uint8_t n = tramaBits; lista = false;
    interrupts();
    if (DIAGNOSTICO) {
      Serial.printf("%2u bits: ", n);
      for (int i = 0; i < n; i++) Serial.print((b >> i) & 1);
      Serial.println();
    }
    // bit 0 siempre 1, bits 1-20 = valor, bit 21 = signo negativo, bits 22-23 en 0
    if (n == 24 && (b & 1) && !(b >> 22)) {
      int32_t valor = (b >> 1) & 0xFFFFF;
      if (b & (1UL << 21)) valor = -valor;
      if (!DIAGNOSTICO) Serial.printf("M:%.2f\n", valor / 100.0);
    }
  }
  if (DIAGNOSTICO && millis() - t > 2000) {
    t = millis();
    Serial.printf("pulsos totales: %lu\n", pulsos);
  }
}
```

**Cómo funciona:**
- Cada flanco `RISING` en GPIO 18 dispara la interrupción `onClk()`, que lee un bit de DATA.
- Como la señal está invertida, un `RISING` en el ESP32 corresponde a un flanco de bajada en el vernier, y `!digitalRead` deshace la inversión de DATA.
- Una pausa de más de 2 ms (`PAUSA_US`) sin pulsos marca el fin de una trama.
- `loop()` valida cada trama de 24 bits e imprime su valor como `M:<mm>`, el formato que espera la app.
- Para ver bits y pulsos, cambia `DIAGNOSTICO` a `true`, compila y sube. En ese modo la app no recibe medidas.

---

## 4. Subir el programa y ver la salida

Usa los botones de la **barra azul inferior** de VS Code (o la terminal PlatformIO Core CLI):

| Acción | Botón | Comando |
|---|---|---|
| Compilar | ✓ | `pio run` |
| Subir | → | `pio run -t upload` |
| Monitor serie | 🔌 | `pio device monitor` |

**Para subir es necesario presionar BOOT.** En este DevKit con CH340 el reinicio automático no funciona. Sin BOOT, la subida falla con:
```
A fatal error occurred: Failed to connect to ESP32: Wrong boot mode detected (0x13)!
```
Procedimiento:
1. **Cierra el monitor** (Ctrl+C). Si el puerto COM está ocupado, la subida falla.
2. Haz clic en Subir.
3. Cuando aparezca `Connecting...`, **mantén presionado BOOT**.
4. Suéltalo cuando aparezca `Writing at 0x...`.
5. Abre el monitor y presiona **EN/RST** para ver la salida desde el inicio.

Para salir del monitor: **Ctrl+C**.

### Salida esperada

```
M:0.00
M:10.10
M:-3.95
```

---

## 5. Protocolo del vernier (resultados de las pruebas)

- **24 bits por trama**, unas **7.5 tramas por segundo**. Eso da 360 pulsos cada 2 s, y el contador sube de forma constante.
- Los bits llegan del **menos significativo al más significativo**. En la salida, el bit 0 es el **primer carácter de la izquierda**.

| Bits | Significado |
|---|---|
| 0 | Siempre vale `1` (no es parte de la medida) |
| 1–20 | Valor absoluto (sin complemento a dos) |
| 21 | Signo: `1` = negativo |
| 22–23 | Siempre `0` en las pruebas |

**Unidades del valor:**
- Vernier en **mm**: el valor viene en **centésimas de mm** (1010 = 10.10 mm).
- Vernier en **pulgadas**: el valor viene en **medias milésimas de pulgada** (796 × 0.0005 = 0.3980 in).

### Tramas medidas

| Pantalla | Trama (bit 0 a la izquierda) | Valor | Bit 21 |
|---|---|---|---|
| 0.00 mm | `100000000000000000000000` | 0 | 0 |
| 0.01 mm | `110000000000000000000000` | 1 | 0 |
| 10.10 mm | `101001111110000000000000` | 1010 | 0 |
| 0.3980 in | `100111000110000000000000` | 796 | 0 |
| −0.1555 in | `111101100100000000000100` | 311 | 1 |
| −3.95 mm | `111010001100000000000100` | 395 | 1 |

### ⚠️ Limitación importante: la trama no indica la unidad

Ningún bit de la trama indica si el vernier está en mm o en pulgadas. **El código asume milímetros, así que el vernier debe quedarse siempre en mm.** En pulgadas, el ESP32 imprimirá un número incorrecto, por ejemplo 7.96 "mm" cuando la pantalla marca 0.3980 in.

---

## 6. Usar la app 3D

1. Sube el firmware y presiona **EN/RST**.
2. Cierra el monitor serie y SignalRGB, porque ocupan el puerto.
3. Instala las dependencias una sola vez y arranca el servidor desde `software/`:
   ```
   pip install -r requirements.txt
   python servidor.py --serial auto --abrir
   ```
4. En la página, inicia la medición. Captura cada cota con la **barra espaciadora**.

Más detalles en `software/LEEME.md`.

---

## 7. Solución de problemas

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| `pio device list` no muestra el CH340 | Falta el driver o el cable es de solo carga | Instala el driver CH340 y prueba otro cable |
| La subida se queda en `Connecting...` o da "Wrong boot mode" | La placa no entró en modo de descarga | Mantén BOOT presionado durante la subida |
| La subida falla con el puerto ocupado | El monitor está abierto | Cierra el monitor con Ctrl+C |
| `pio` no se reconoce en la terminal | `pio` no está en el PATH | Usa la terminal PlatformIO Core CLI o la ruta completa |
| Con `DIAGNOSTICO = true`, `pulsos totales: 0` | El vernier está apagado, no hay GND común o CLK está desconectado | Revisa la alimentación, el GND y el transistor de CLK |
| Con `DIAGNOSTICO = true`, los bits por trama varían | CLK y DATA están intercambiados | Intercambia los jumpers de GPIO 18 y 19 |
| 24 bits estables pero el valor no cambia al mover la mordaza | DATA no llega o se lee en el flanco equivocado | Revisa el transistor de DATA; si sigue igual, cambia `RISING` por `FALLING` (con este hardware no hizo falta) |
| La medida no coincide con la pantalla | El vernier está en pulgadas | Pásalo a mm |
| Al principio aparece una trama de 1 bit | La lectura empezó a mitad de una trama | Es normal, se ignora sola |
