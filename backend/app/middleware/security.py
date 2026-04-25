"""
Security middleware:
  1. Adaugă security headers la fiecare răspuns HTTP.
  2. Rate limiting simplu bazat pe IP (in-memory, suficient pentru MVP).

Pentru producție: înlocuiește rate limiting-ul cu Redis + sliding-window.
"""
import time
from collections import defaultdict
from typing import Callable

from fastapi import Request, Response, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


# ── Security Headers ──────────────────────────────────────────────────────────

SECURITY_HEADERS: dict[str, str] = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "Content-Security-Policy": "default-src 'none'",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    "Cache-Control": "no-store",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Injectează security headers OWASP la fiecare răspuns."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)
        for header, value in SECURITY_HEADERS.items():
            response.headers[header] = value
        return response


# ── Rate Limiting ─────────────────────────────────────────────────────────────

class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Rate limiter simplu: max N request-uri / fereastră de timp per IP.
    
    MVP-only — pentru producție folosește:
        pip install slowapi  # wraps limits library, Redis backend
    """

    def __init__(
        self,
        app,
        max_requests: int = 20,
        window_seconds: int = 60,
    ) -> None:
        super().__init__(app)
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        # {ip: [(timestamp, count)]}
        self._buckets: dict[str, list[float]] = defaultdict(list)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        client_ip: str = request.client.host if request.client else "unknown"
        now = time.monotonic()

        # Curăță timestamp-uri expirate
        self._buckets[client_ip] = [
            ts
            for ts in self._buckets[client_ip]
            if now - ts < self.window_seconds
        ]

        if len(self._buckets[client_ip]) >= self.max_requests:
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={"detail": "Rate limit exceeded. Retry later."},
                headers={"Retry-After": str(self.window_seconds)},
            )

        self._buckets[client_ip].append(now)
        return await call_next(request)
