"""Simulador del ESP32 en terminal.

Se conecta al servidor (que debe estar corriendo) y le manda las mismas líneas
que mandará el ESP32 real. Sirve para probar casos raros a mano.

    python simulador.py                  # modo interactivo
    python simulador.py --caja 50 30 20  # una medición completa y sale

Comandos en modo interactivo:
    M:12.5  /  C:12.5     manda la línea tal cual
    medir 25.4 [10 ...]   mide esos valores como una persona (M: subiendo y C:)
    caja L W H            igual que medir, para largo, ancho y alto
    basura                manda texto inválido (debe ignorarse)
    salir
"""
from __future__ import annotations

import argparse
import asyncio
import sys

try:
    import websockets
except ImportError:
    sys.exit("Falta la librería websockets: pip install -r requirements.txt")

from fuentes import FuenteSimulador


async def principal(url: str, caja: list[float] | None) -> None:
    async with websockets.connect(url) as ws:
        print(f"Conectado a {url}")

        async def emitir(linea: str) -> None:
            await ws.send(linea)
            print("  →", linea)

        sim = FuenteSimulador()
        await sim.iniciar(emitir)

        async def medir(valores: list[float]) -> None:
            await sim.medir(valores)
            await sim._tarea

        if caja:
            await medir(caja)
            return

        print(__doc__.split("Comandos en modo interactivo:")[1])
        while True:
            texto = (await asyncio.to_thread(input, "vernier> ")).strip()
            if not texto:
                continue
            palabra, *resto = texto.split()
            if palabra in ("salir", "exit", "q"):
                break
            if palabra in ("medir", "caja"):
                try:
                    await medir([float(x.replace(",", ".")) for x in resto])
                except ValueError:
                    print("  Escribe números: caja 50 30 20")
            elif palabra == "basura":
                await emitir("hola#%&")
            else:
                await emitir(texto)


def main() -> None:
    for flujo in (sys.stdout, sys.stderr):
        if hasattr(flujo, "reconfigure"):
            flujo.reconfigure(encoding="utf-8", errors="replace")
    ap =argparse.ArgumentParser(description="Simulador del ESP32 para Vernier→3D")
    ap.add_argument("--url", default="ws://localhost:8000/ws/fuente")
    ap.add_argument("--caja", nargs=3, type=float, metavar=("L", "W", "H"))
    args = ap.parse_args()
    try:
        asyncio.run(principal(args.url, args.caja))
    except (OSError, websockets.exceptions.WebSocketException) as exc:
        sys.exit(f"No pude hablar con el servidor ({exc}). ¿Está corriendo servidor.py?")
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
