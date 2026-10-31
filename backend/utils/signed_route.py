"""Чат/сторис маршруттары: JSON жауаптағы /api/uploads/ сілтемелеріне қарап отырған адамның
қолтаңбасын қою (utils/media_access.py). Маршрут өзі ештеңе білмеуі керек — жауап қандай
жолмен қайтса да (хабарлама, чаттар тізімі, forward, реакция...) сілтеме қорғалады."""
import json
from typing import Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from utils.media_access import UPLOADS_PREFIX, sign_payload

_MARKER = UPLOADS_PREFIX.encode()


class SignedMediaRoute(APIRoute):
    def get_route_handler(self) -> Callable:
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            response = await original(request)
            viewer_id = getattr(request.state, "viewer_id", None)
            body = getattr(response, "body", None)
            if (
                not viewer_id
                or not isinstance(response, JSONResponse)
                or not isinstance(body, (bytes, bytearray))
                or _MARKER not in body
            ):
                return response
            try:
                data = json.loads(body)
            except ValueError:
                return response
            headers = {k: v for k, v in response.headers.items() if k.lower() not in ("content-length", "content-type")}
            return JSONResponse(
                content=sign_payload(data, viewer_id),
                status_code=response.status_code,
                headers=headers,
                background=response.background,
            )

        return handler
