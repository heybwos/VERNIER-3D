"""Fuentes de medidas para Vernier→3D.

Todas las fuentes entregan lo mismo: líneas de texto `M:<mm>` (en vivo) o `C:<mm>`
(capturada), exactamente como las manda el ESP32 por USB. El servidor no sabe de
qué fuente viene cada línea; solo la interpreta con `interpretar()`.

Interfaz común de una fuente:
    fuente.nombre        -> "simulador" | "serial"
    await fuente.iniciar(emitir)   # emitir(linea: str) es una corrutina
    await fuente.detener()
    fuente.estado()      -> dict con lo que la interfaz necesita mostrar
"""
from __future__ import annotations

import asyncio
import random
import re
import threading
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional

Emitir = Callable[[str], Awaitable[None]]

RANGO_MAX_MM = 150.0
_PATRON = re.compile(r"^([MC]):(-?\d+(?:\.\d+)?)$")


@dataclass
class Lectura:
    modo: str      # "M" en vivo, "C" capturada
    valor: float   # mm, puede ser negativo


def interpretar(linea: str) -> Optional[Lectura]:
    """Devuelve la lectura o None si la línea no cumple el formato. Nunca truena."""
    m = _PATRON.match(linea.strip())
    if not m:
        return None
    try:
        return Lectura(m.group(1), float(m.group(2)))
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Fuente B · simulador del ESP32
# ---------------------------------------------------------------------------
class FuenteSimulador:
    """Imita a una persona usando el vernier: abre las mordazas poco a poco,
    la lectura se asienta con ruido de ±0.01 mm y luego presiona Capturar."""

    nombre = "simulador"
    PERIODO_S = 0.15

    def __init__(self) -> None:
        self._emitir: Optional[Emitir] = None
        self._tarea: Optional[asyncio.Task] = None

    async def iniciar(self, emitir: Emitir) -> None:
        self._emitir = emitir

    async def detener(self) -> None:
        await self.cancelar()

    def estado(self) -> dict:
        return {"ocupado": self.ocupado}

    @property
    def ocupado(self) -> bool:
        return self._tarea is not None and not self._tarea.done()

    async def cancelar(self) -> None:
        if self.ocupado:
            self._tarea.cancel()
            try:
                await self._tarea
            except asyncio.CancelledError:
                pass
        self._tarea = None

    async def medir(self, valores: list[float], pausa_s: float = 0.6) -> None:
        """Mide en orden cada valor objetivo (M: subiendo, luego C:)."""
        await self.cancelar()
        self._tarea = asyncio.create_task(self._secuencia(valores, pausa_s))

    async def _secuencia(self, valores: list[float], pausa_s: float) -> None:
        for objetivo in valores:
            await self._una_cota(float(objetivo))
            await asyncio.sleep(pausa_s)

    async def _una_cota(self, objetivo: float) -> None:
        assert self._emitir is not None
        # Apertura de las mordazas: curva que frena al final, como la mano al llegar a la pieza.
        duracion = 1.6 + min(abs(objetivo), RANGO_MAX_MM) / RANGO_MAX_MM * 1.4
        pasos = max(6, int(duracion / self.PERIODO_S))
        rebase = objetivo + random.uniform(0.15, 0.6)   # se pasa un poco y regresa
        for i in range(1, pasos + 1):
            p = i / pasos
            e = 1 - (1 - p) ** 3
            valor = rebase * e if p < 0.82 else rebase + (objetivo - rebase) * ((p - 0.82) / 0.18)
            await self._emitir(f"M:{valor + random.uniform(-0.01, 0.01):.2f}")
            await asyncio.sleep(self.PERIODO_S)
        # Lectura asentada: unos paquetes casi quietos antes de capturar.
        for _ in range(6):
            await self._emitir(f"M:{objetivo + random.choice((-0.01, 0, 0, 0.01)):.2f}")
            await asyncio.sleep(self.PERIODO_S)
        await self._emitir(f"C:{objetivo:.2f}")


# ---------------------------------------------------------------------------
# Fuente C · puerto serial real (ESP32 por USB)
# ---------------------------------------------------------------------------
CHIPS_USB = ("CP210", "CH340", "CH910", "USB-SERIAL", "SILICON LABS", "WCH")


def listar_puertos() -> list[dict]:
    try:
        from serial.tools import list_ports
    except ImportError:
        return []
    return [{"puerto": p.device, "descripcion": p.description or ""} for p in list_ports.comports()]


def detectar_puerto() -> Optional[str]:
    """Busca el puerto del ESP32 por la descripción del chip USB (CP2102 o CH340)."""
    for p in listar_puertos():
        if any(chip in p["descripcion"].upper() for chip in CHIPS_USB):
            return p["puerto"]
    return None


class FuenteSerial:
    """Lee línea por línea a 115200 baudios en un hilo y reintenta si se desconecta.

    Recordatorio: el puerto COM solo lo puede abrir un programa a la vez;
    el Monitor Serie de Arduino IDE debe estar cerrado.
    """

    nombre = "serial"
    BAUDIOS = 115200
    REINTENTO_S = 2.0

    def __init__(self, puerto: str = "auto") -> None:
        self.puerto_pedido = puerto
        self.puerto: Optional[str] = None
        self.conectado = False
        self.mensaje = "Sin iniciar"
        self._emitir: Optional[Emitir] = None
        self._bucle: Optional[asyncio.AbstractEventLoop] = None
        self._hilo: Optional[threading.Thread] = None
        self._parar = threading.Event()
        self._al_cambiar: Optional[Callable[[], Awaitable[None]]] = None

    def al_cambiar(self, fn: Callable[[], Awaitable[None]]) -> None:
        """Registra una corrutina que se llama cuando cambia el estado de la conexión."""
        self._al_cambiar = fn

    async def iniciar(self, emitir: Emitir) -> None:
        self._emitir = emitir
        self._bucle = asyncio.get_running_loop()
        self._parar.clear()
        self._hilo = threading.Thread(target=self._leer, name="fuente-serial", daemon=True)
        self._hilo.start()

    async def detener(self) -> None:
        self._parar.set()
        if self._hilo:
            await asyncio.to_thread(self._hilo.join, 3)
        self._hilo = None
        self._cambiar(False, "Detenido")

    def estado(self) -> dict:
        return {"puerto": self.puerto, "pedido": self.puerto_pedido,
                "conectado": self.conectado, "mensaje": self.mensaje}

    # -- hilo de lectura ----------------------------------------------------
    def _cambiar(self, conectado: bool, mensaje: str) -> None:
        if (conectado, mensaje) == (self.conectado, self.mensaje):
            return
        self.conectado, self.mensaje = conectado, mensaje
        if self._al_cambiar and self._bucle and not self._bucle.is_closed():
            asyncio.run_coroutine_threadsafe(self._al_cambiar(), self._bucle)

    def _leer(self) -> None:
        try:
            import serial
        except ImportError:
            self._cambiar(False, "Falta pyserial: pip install pyserial")
            return
        while not self._parar.is_set():
            puerto = detectar_puerto() if self.puerto_pedido == "auto" else self.puerto_pedido
            self.puerto = puerto
            if not puerto:
                self._cambiar(False, "No encuentro el ESP32 (CP2102/CH340). Conéctalo por USB.")
                self._parar.wait(self.REINTENTO_S)
                continue
            try:
                with serial.Serial(puerto, self.BAUDIOS, timeout=0.5) as sp:
                    self._cambiar(True, f"Conectado a {puerto}")
                    pendiente = b""
                    while not self._parar.is_set():
                        pendiente += sp.read(sp.in_waiting or 1)
                        while b"\n" in pendiente:
                            crudo, pendiente = pendiente.split(b"\n", 1)
                            linea = crudo.decode("ascii", errors="replace").strip()
                            if linea and self._emitir and self._bucle:
                                asyncio.run_coroutine_threadsafe(self._emitir(linea), self._bucle)
                        if len(pendiente) > 256:   # basura sin salto de línea
                            pendiente = b""
            except serial.SerialException as exc:
                texto = str(exc)
                if "PermissionError" in texto or "Acceso denegado" in texto or "Access is denied" in texto:
                    self._cambiar(False, f"{puerto} está ocupado: cierra el monitor serie y SignalRGB.")
                else:
                    self._cambiar(False, f"Se perdió {puerto}; reintentando…")
                self._parar.wait(self.REINTENTO_S)
