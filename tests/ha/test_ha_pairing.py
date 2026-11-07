"""POST /api/guest_ha_dashboard/pair."""

from __future__ import annotations

from datetime import timedelta
import json
import logging
from typing import Any

from freezegun.api import FrozenDateTimeFactory
from ha_helpers import DOMAIN, PAIR_URL, new_code
import pytest

from homeassistant.core import HomeAssistant

GENERIC = {"error": "invalid_code"}


async def _pair(client: Any, code: str, **extra: Any) -> tuple[int, dict]:
    resp = await client.post(PAIR_URL, json={"code": code, **extra})
    return resp.status, await resp.json()


async def test_pair_success_returns_token_once(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any, hass_storage: dict
) -> None:
    code, pass_id = await new_code(runtime)
    client = await hass_client_no_auth()

    status, body = await _pair(client, code, device_name="iPhone")
    assert status == 200
    assert body["pass"]["id"] == pass_id
    assert body["pass"]["kind"] == "phone"
    assert body["profile"] == {"name": "Pokoj 3"}
    token = body["token"]
    assert len(token) >= 40

    # stored hashed only
    stored = json.dumps(hass_storage[f"{DOMAIN}.guests"])
    assert token not in stored
    assert code.replace("-", "") not in stored and code not in stored
    assert runtime.store.model.find_by_token(token)["id"] == pass_id

    # single use
    status, body = await _pair(client, code)
    assert (status, body) == (400, GENERIC)


async def test_failures_are_indistinguishable(
    hass: HomeAssistant,
    runtime: Any,
    hass_client_no_auth: Any,
    freezer: FrozenDateTimeFactory,
) -> None:
    client = await hass_client_no_auth()
    results = []

    # wrong code
    results.append(await _pair(client, "ZZZZ-ZZZZ-ZZZZ"))

    # revoked pass
    code, pass_id = await new_code(runtime)
    runtime.store.model.pass_revoke(pass_id, runtime.now())
    results.append(await _pair(client, code))

    # expired code (TTL 15 min)
    code, _pass_id = await new_code(runtime)
    freezer.tick(timedelta(minutes=16))
    results.append(await _pair(client, code))

    assert all(r == (400, GENERIC) for r in results)


async def test_rate_limit_and_backoff(
    hass: HomeAssistant,
    runtime: Any,
    hass_client_no_auth: Any,
    freezer: FrozenDateTimeFactory,
) -> None:
    client = await hass_client_no_auth()
    code, _pass_id = await new_code(runtime)
    for _ in range(5):
        assert (await _pair(client, "ZZZZ-ZZZZ-ZZZZ"))[0] == 400

    resp = await client.post(PAIR_URL, json={"code": code})
    assert resp.status == 429
    body = await resp.json()
    assert body["error"] == "rate_limited"
    assert body["retry_after"] > 0
    assert resp.headers["Retry-After"] == str(body["retry_after"])
    # even the right code is refused while locked
    assert "token" not in body


async def test_bad_requests(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    client = await hass_client_no_auth()
    resp = await client.post(PAIR_URL, data=b"not json")
    assert resp.status == 400
    assert await resp.json() == {"error": "bad_request"}
    resp = await client.post(PAIR_URL, json={"code": 123})
    assert resp.status == 400
    resp = await client.post(PAIR_URL, data=b"x" * 5000)
    assert resp.status == 413


async def test_codes_and_tokens_never_logged(
    hass: HomeAssistant,
    runtime: Any,
    hass_client_no_auth: Any,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    client = await hass_client_no_auth()
    code, _pass_id = await new_code(runtime)
    await _pair(client, "ZZZZ-ZZZZ-ZZZZ")
    _status, body = await _pair(client, code)
    assert code not in caplog.text
    assert code.replace("-", "") not in caplog.text
    assert "ZZZZ" not in caplog.text
    assert body["token"] not in caplog.text


async def test_cors_preflight_allows_hosted_origin(
    hass: HomeAssistant, runtime: Any, hass_client_no_auth: Any
) -> None:
    client = await hass_client_no_auth()
    resp = await client.options(
        PAIR_URL,
        headers={
            "Origin": "https://dash.matyas.online",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert resp.status == 200
    assert resp.headers.get("Access-Control-Allow-Origin") in (
        "*",
        "https://dash.matyas.online",
    )
    assert resp.headers.get("Access-Control-Allow-Credentials") is None


async def test_unloaded_integration_answers_503(
    hass: HomeAssistant, setup_integration: Any, hass_client_no_auth: Any
) -> None:
    from unittest.mock import patch

    with patch("custom_components.guest_ha_dashboard.frontend.async_remove_panel"):
        assert await hass.config_entries.async_unload(setup_integration.entry_id)
    client = await hass_client_no_auth()
    resp = await client.post(PAIR_URL, json={"code": "ZZZZ-ZZZZ-ZZZZ"})
    assert resp.status == 503
