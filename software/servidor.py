"""Servidor de Vernier→3D.

    python servidor.py                 # abre http://localhost:8000
    python servidor.py --serial auto   # arranca leyendo el ESP32 por USB
    python servidor.py --serial COM5

Sirve la página `web/` y la comunica por WebSocket:
  /ws         navegador: recibe lecturas ya interpretadas y manda comandos
  /ws/fuente  fuentes externas (simulador.py en terminal): mandan líneas crudas

La máquina de estados de la medición vive en el navegador; aquí solo se
transportan las líneas, se informa el estado de las fuentes y se guarda el JSON.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import webbrowser
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from fuentes import FuenteSerial, FuenteSimulador, interpretar, listar_puertos

AQUI = Path(__file__).resolve().parent
WEB = AQUI / "web"
ARCHIVO = AQUI / "mediciones" / "mediciones.json"

app = FastAPI(title="Vernier→3D")


@app.middleware("http")
async def sin_cache(request, call_next):
    # El navegador revalida cada archivo: así un cambio en web/ se ve con solo recargar.
    respuesta = await call_next(request)
    respuesta.headers["Cache-Control"] = "no-cache"
    return respuesta


class Central:
    """Estado compartido: navegadores conectados y fuentes de medidas."""

    def __init__(self) -> None:
        self.navegadores: set[WebSocket] = set()
        self.externas = 0
        self.simulador = FuenteSimulador()
        self.serial: Optional[FuenteSerial] = None
        self.activa = "simulador"
        self.paquetes = 0
        self._candado = asyncio.Lock()

    # -- difusión ----------------------------------------------------------
    async def enviar(self, ws: WebSocket, datos: dict) -> None:
        try:
            await ws.send_text(json.dumps(datos, ensure_ascii=False))
        except Exception:
            self.navegadores.discard(ws)

    async def difundir(self, datos: dict) -> None:
        for ws in list(self.navegadores):
            await self.enviar(ws, datos)

    async def linea(self, linea: str, fuente: str) -> None:
        """Punto único de entrada de TODAS las fuentes."""
        self.paquetes += 1
        lectura = interpretar(linea)
        base = {"crudo": linea[:80], "fuente": fuente, "t": time.time()}
        if lectura is None:
            await self.difundir({"tipo": "ignorada", **base})
        else:
            await self.difundir({"tipo": "lectura", "modo": lectura.modo, "valor": lectura.valor, **base})

    def estado(self) -> dict:
        return {
            "tipo": "estado",
            "activa": self.activa,
            "simulador": self.simulador.estado(),
            "serial": self.serial.estado() if self.serial else {"conectado": False, "mensaje": "Apagado"},
            "externas": self.externas,
        }

    async def avisar_estado(self) -> None:
        await self.difundir(self.estado())

    # -- fuentes -----------------------------------------------------------
    async def usar(self, nombre: str, puerto: str = "auto") -> None:
        async with self._candado:
            if nombre == "serial":
                await self.simulador.cancelar()
                if self.serial and self.serial.puerto_pedido != puerto:
                    await self.serial.detener()
                    self.serial = None
                if not self.serial:
                    self.serial = FuenteSerial(puerto)
                    self.serial.al_cambiar(self.avisar_estado)
                    await self.serial.iniciar(lambda l: self.linea(l, "esp32"))
            else:
                if self.serial:
                    await self.serial.detener()
                    self.serial = None
            self.activa = nombre
        await self.avisar_estado()


central = Central()


@asynccontextmanager
async def ciclo(_app: FastAPI):
    await central.simulador.iniciar(lambda l: central.linea(l, "simulador"))
    if os.environ.get("VERNIER_SERIAL"):
        await central.usar("serial", os.environ["VERNIER_SERIAL"])
    yield
    await central.simulador.detener()
    if central.serial:
        await central.serial.detener()


app.router.lifespan_context = ciclo


# ---------------------------------------------------------------------------
# Guardado de mediciones
# ---------------------------------------------------------------------------
def guardar(medicion: dict) -> int:
    """Inserta o actualiza por `id` en mediciones/mediciones.json. Devuelve el total."""
    ARCHIVO.parent.mkdir(parents=True, exist_ok=True)
    try:
        datos = json.loads(ARCHIVO.read_text(encoding="utf-8")) if ARCHIVO.exists() else []
        if not isinstance(datos, list):
            datos = []
    except json.JSONDecodeError:
        respaldo = ARCHIVO.with_suffix(f".daniado-{datetime.now():%Y%m%d-%H%M%S}.json")
        ARCHIVO.replace(respaldo)
        datos = []
    medicion.setdefault("fecha", datetime.now().isoformat(timespec="seconds"))
    medicion.setdefault("id", medicion["fecha"])
    for i, m in enumerate(datos):
        if m.get("id") == medicion["id"]:
            datos[i] = medicion
            break
    else:
        datos.append(medicion)
    tmp = ARCHIVO.with_suffix(".tmp")
    tmp.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(ARCHIVO)
    return len(datos)


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------
def _numero(v) -> Optional[float]:
    try:
        f = float(v)
        return f if f == f else None
    except (TypeError, ValueError):
        return None


async def atender(ws: WebSocket, msg: dict) -> None:
    cmd = msg.get("cmd")
    if cmd == "simular":
        valores = [v for v in (_numero(x) for x in msg.get("valores", [])) if v is not None]
        if valores:
            await central.simulador.medir(valores[:8], float(msg.get("pausa", 0.6)))
            await central.avisar_estado()
    elif cmd == "detener":
        await central.simulador.cancelar()
        await central.avisar_estado()
    elif cmd == "linea":
        await central.linea(str(msg.get("linea", "")), "consola")
    elif cmd == "fuente":
        nombre = msg.get("nombre")
        if nombre in ("simulador", "serial", "manual"):
            await central.usar(nombre, str(msg.get("puerto") or "auto"))
    elif cmd == "puertos":
        await central.enviar(ws, {"tipo": "puertos", "puertos": listar_puertos()})
    elif cmd == "guardar" and isinstance(msg.get("medicion"), dict):
        try:
            total = await asyncio.to_thread(guardar, msg["medicion"])
            await central.enviar(ws, {"tipo": "guardado", "id": msg["medicion"].get("id"), "total": total})
        except OSError as exc:
            await central.enviar(ws, {"tipo": "error", "mensaje": f"No se pudo guardar: {exc}"})
    elif cmd == "hola":
        await central.enviar(ws, central.estado())


@app.websocket("/ws")
async def ws_navegador(ws: WebSocket) -> None:
    await ws.accept()
    central.navegadores.add(ws)
    await central.enviar(ws, central.estado())
    try:
        while True:
            texto = await ws.receive_text()
            try:
                msg = json.loads(texto)
            except json.JSONDecodeError:
                continue
            if isinstance(msg, dict):
                await atender(ws, msg)
    except WebSocketDisconnect:
        pass
    finally:
        central.navegadores.discard(ws)


@app.websocket("/ws/fuente")
async def ws_fuente(ws: WebSocket) -> None:
    """Fuente externa: cada mensaje de texto es una o varias líneas M:/C:."""
    await ws.accept()
    central.externas += 1
    await central.avisar_estado()
    try:
        while True:
            for linea in (await ws.receive_text()).splitlines():
                if linea.strip():
                    await central.linea(linea, "terminal")
    except WebSocketDisconnect:
        pass
    finally:
        central.externas -= 1
        await central.avisar_estado()


@app.get("/")
async def inicio() -> FileResponse:
    return FileResponse(WEB / "index.html", headers={"Cache-Control": "no-store"})


app.mount("/", StaticFiles(directory=WEB), name="web")


def main() -> None:
    # La consola de Windows usa cp1252 y no imprime "→" ni acentos raros.
    for flujo in (sys.stdout, sys.stderr):
        if hasattr(flujo, "reconfigure"):
            flujo.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description="Servidor Vernier→3D")
    ap.add_argument("--puerto-web", type=int, default=int(os.environ.get("PORT", 8000)))
    ap.add_argument("--serial", metavar="COMx|auto", help="arrancar leyendo el ESP32 por USB")
    ap.add_argument("--abrir", action="store_true", help="abrir el navegador al iniciar")
    args = ap.parse_args()
    if args.serial:
        os.environ["VERNIER_SERIAL"] = args.serial
    url = f"http://localhost:{args.puerto_web}"
    print(f"Vernier→3D en {url}  (Ctrl+C para salir)")
    if args.abrir:
        webbrowser.open(url)
    uvicorn.run(app, host="127.0.0.1", port=args.puerto_web, log_level="warning")


if __name__ == "__main__":
    main()
