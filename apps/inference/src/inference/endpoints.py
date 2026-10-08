"""Validated service origins and the manifest that pairs clients with a backend."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    HttpUrl,
    PlainSerializer,
    StringConstraints,
    UrlConstraints,
)


def origin_text(url: HttpUrl) -> str:
    """Serialize an origin as browsers send it in the Origin header."""
    return str(url).removesuffix("/")


def _origin(url: HttpUrl) -> HttpUrl:
    # Pydantic normalizes an empty path to "/" and reports a bare "?" or "#" as "".
    if (
        url.username
        or url.password
        or url.path != "/"
        or url.query is not None
        or url.fragment is not None
    ):
        raise ValueError("expected an origin without credentials, path, query, or fragment")
    return url


def _default_port(url: HttpUrl) -> HttpUrl:
    if url.port != 443:
        raise ValueError("expected the default HTTPS port")
    return url


HttpOrigin = Annotated[
    HttpUrl,
    UrlConstraints(host_required=True),
    AfterValidator(_origin),
    PlainSerializer(origin_text, return_type=str),
]
HttpsOrigin = Annotated[
    HttpUrl,
    UrlConstraints(allowed_schemes=["https"], host_required=True),
    AfterValidator(_origin),
    AfterValidator(_default_port),
    PlainSerializer(origin_text, return_type=str),
]
DeploymentId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class BackendManifest(BaseModel):
    """A verified backend; the Fastfile and E2E runner read the same JSON keys."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    url: HttpsOrigin
    deployment_id: DeploymentId
    environment: Literal["dev", "main"]
