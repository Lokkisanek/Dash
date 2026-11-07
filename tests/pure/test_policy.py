"""Service call validation, state sanitizing and config filtering."""

import math
import random

from _loader import load
import pytest

policy = load("guest_policy")
const = load("const")

NOW = "2026-11-07T12:00:00+00:00"


def make_profile(**entities):
    """Profile as stored; entities default to all services of their domain."""
    out = {}
    for entity_id, cfg in entities.items():
        info = policy.entity_selectability(entity_id)
        out[entity_id] = {
            "services": info["services"],
            "limits": {},
            "read_only": info["read_only"],
            **(cfg or {}),
        }
    return {"id": "p" * 32, "name": "Room", "entities": out, "show_wifi": True}


ROOM = make_profile(
    **{
        "light.room": None,
        "climate.room": None,
        "cover.blinds": None,
        "media_player.speaker": None,
        "sensor.room_temp": None,
        "switch.kettle": {"read_only": True},
        "input_boolean.dnd": {"services": ["input_boolean.toggle"]},
    }
)


def call(entity_id, service, data=None, **extra):
    msg = {
        "id": 1,
        "type": "call_service",
        "domain": entity_id.split(".")[0] if isinstance(entity_id, str) else "light",
        "service": service,
        "entity_id": entity_id,
        "data": data if data is not None else {},
    }
    msg.update(extra)
    return msg


def decide(msg, profile=ROOM, classes=()):
    return policy.validate_call(profile, msg, classes)


# ─── allowed ─────────────────────────────────────────────────────────────────


def test_allowed_calls() -> None:
    assert decide(call("light.room", "toggle")).ok
    d = decide(
        call("light.room", "turn_on", {"brightness_pct": 40, "color_temp_kelvin": 2700})
    )
    assert d.ok and d.data == {"brightness_pct": 40, "color_temp_kelvin": 2700}
    assert decide(call("climate.room", "set_temperature", {"temperature": 21.5})).ok
    assert decide(call("cover.blinds", "set_cover_position", {"position": 30})).ok
    assert decide(call("media_player.speaker", "volume_set", {"volume_level": 0.4})).ok
    assert decide(call("input_boolean.dnd", "toggle")).ok


def test_integral_float_accepted_for_int_field() -> None:
    d = decide(call("cover.blinds", "set_cover_position", {"position": 30.0}))
    assert d.ok and d.data["position"] == 30 and isinstance(d.data["position"], int)


# ─── denied ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("msg", "reason"),
    [
        (call("light.other_room", "toggle"), "entity_not_allowed"),
        (call("input_boolean.dnd", "turn_on"), "service_not_allowed"),
        (call("light.room", "set_level"), "service_not_allowed"),
        (call("sensor.room_temp", "turn_on"), "entity_read_only"),
        (call("switch.kettle", "toggle"), "entity_read_only"),
        (call("light.room", "turn_on", {"brightness": 255}), "field_not_allowed"),
        (call("light.room", "turn_on", {"entity_id": "light.x"}), "field_not_allowed"),
        (call("light.room", "turn_on", {"area_id": "kitchen"}), "field_not_allowed"),
        (call("light.room", "turn_on", {"brightness_pct": 101}), "out_of_range"),
        (call("light.room", "turn_on", {"brightness_pct": True}), "invalid_value"),
        (call("light.room", "turn_on", {"brightness_pct": math.nan}), "invalid_value"),
        (call("light.room", "turn_on", {"brightness_pct": math.inf}), "invalid_value"),
        (call("light.room", "turn_on", {"brightness_pct": "50"}), "invalid_value"),
        (call("light.room", "turn_on", {"rgb_color": [1, 2]}), "invalid_value"),
        (call("light.room", "turn_on", {"rgb_color": [1, 2, 300]}), "out_of_range"),
        (call("climate.room", "set_temperature", {"temperature": 30}), "out_of_range"),
        (call("climate.room", "set_temperature", {"temperature": 10}), "out_of_range"),
        (
            call("climate.room", "set_hvac_mode", {"hvac_mode": "boost"}),
            "invalid_value",
        ),
        (
            call("climate.room", "set_temperature", {"target_temp_high": 22}),
            "field_not_allowed",
        ),
        (call("media_player.speaker", "play_media", {}), "service_not_allowed"),
        (
            call("media_player.speaker", "select_source", {"source": "a\nb"}),
            "invalid_value",
        ),
    ],
)
def test_denied(msg, reason) -> None:
    d = decide(msg)
    assert not d.ok
    assert d.reason == reason


@pytest.mark.parametrize(
    "msg",
    [
        call(["light.room"], "toggle"),
        call("all", "toggle", domain="light"),
        call("light.room,light.other", "toggle"),
        call(None, "toggle"),
        call("light.room", "toggle", target={"area_id": "x"}),
        call("light.room", "toggle", area_id="x"),
        call("light.room", "toggle", device_id="x"),
        call("light.room", "toggle", domain="switch"),
        call("light.room", "toggle", data=["x"]),
        call("light.room", 5),
        "not a dict",
        None,
    ],
)
def test_bad_requests(msg) -> None:
    d = decide(msg)
    assert not d.ok and d.reason == "bad_request"


def test_climate_limit_from_profile_overrides_default() -> None:
    profile = make_profile(
        **{
            "climate.room": {
                "limits": {
                    "climate.set_temperature": {"temperature": {"min": 18, "max": 25}}
                }
            }
        }
    )
    ok = call("climate.room", "set_temperature", {"temperature": 25})
    high = call("climate.room", "set_temperature", {"temperature": 25.5})
    assert decide(ok, profile).ok
    assert decide(high, profile).reason == "out_of_range"


def test_profile_limit_cannot_widen_global_range() -> None:
    profile = make_profile(
        **{
            "light.room": {
                "limits": {"light.turn_on": {"brightness_pct": {"min": 0, "max": 500}}}
            }
        }
    )
    assert decide(
        call("light.room", "turn_on", {"brightness_pct": 101}), profile
    ).reason == ("out_of_range")


def test_enum_limit() -> None:
    profile = make_profile(
        **{
            "media_player.speaker": {
                "limits": {
                    "media_player.select_source": {"source": {"enum": ["Radio"]}}
                }
            }
        }
    )
    assert decide(
        call("media_player.speaker", "select_source", {"source": "Radio"}), profile
    ).ok
    assert (
        decide(
            call("media_player.speaker", "select_source", {"source": "TV"}), profile
        ).reason
        == "out_of_range"
    )


@pytest.mark.parametrize(
    ("entity_id", "service"),
    [
        ("lock.front_door", "unlock"),
        ("alarm_control_panel.home", "alarm_disarm"),
        ("camera.porch", "turn_on"),
        ("script.open_everything", "turn_on"),
        ("automation.night", "trigger"),
        ("siren.home", "turn_on"),
        ("button.restart", "press"),
        ("homeassistant.x", "restart"),
    ],
)
def test_hard_denied_even_if_tampered_into_profile(entity_id, service) -> None:
    domain = entity_id.split(".")[0]
    tampered = {
        "entities": {
            entity_id: {
                "services": [f"{domain}.{service}"],
                "limits": {},
                "read_only": False,
            }
        }
    }
    d = decide(call(entity_id, service), tampered)
    assert not d.ok and d.reason == "domain_denied"


@pytest.mark.parametrize("device_class", ["garage", "gate", "door"])
def test_garage_and_gate_covers_denied(device_class) -> None:
    d = decide(call("cover.blinds", "open_cover"), ROOM, classes={device_class})
    assert not d.ok and d.reason == "device_class_denied"
    assert decide(call("cover.blinds", "open_cover"), ROOM, classes={"blind"}).ok


def test_tampered_service_outside_table_denied() -> None:
    tampered = {
        "entities": {
            "light.room": {
                "services": ["light.turn_on", "light.set_level"],
                "read_only": False,
            }
        }
    }
    assert (
        decide(call("light.room", "set_level"), tampered).reason
        == "service_not_allowed"
    )


def test_missing_read_only_flag_is_treated_as_read_only() -> None:
    tampered = {"entities": {"light.room": {"services": ["light.toggle"]}}}
    assert decide(call("light.room", "toggle"), tampered).reason == "entity_read_only"


# ─── fuzz ────────────────────────────────────────────────────────────────────

_ATOMS = [
    None,
    True,
    False,
    0,
    -1,
    1,
    2**63,
    0.5,
    -0.0,
    math.nan,
    math.inf,
    "",
    "x",
    "light.room",
    "all",
    "light.room,light.x",
    "a" * 5000,
    [],
    {},
    ["light.room"],
    {"area_id": "x"},
    b"bytes",
    ("t",),
    {"$ne": 1},
]
_KEYS = list(policy.CALL_KEYS) + [
    "target",
    "area_id",
    "device_id",
    "label_id",
    "__proto__",
]
_FIELDS = [
    "brightness_pct",
    "brightness",
    "temperature",
    "position",
    "rgb_color",
    "entity_id",
    "area_id",
    "source",
    "volume_level",
    "hvac_mode",
    "x",
]


def _garbage(rng, depth=0):
    if depth > 2 or rng.random() < 0.5:
        return rng.choice(_ATOMS)
    if rng.random() < 0.5:
        return [_garbage(rng, depth + 1) for _ in range(rng.randint(0, 3))]
    return {
        rng.choice(_FIELDS): _garbage(rng, depth + 1) for _ in range(rng.randint(0, 3))
    }


def test_fuzz_never_raises_and_never_allows_outside_profile() -> None:
    rng = random.Random(20261107)
    tiny = make_profile(**{"light.room": None})
    for _ in range(20000):
        msg = {k: _garbage(rng) for k in rng.sample(_KEYS, rng.randint(0, len(_KEYS)))}
        if rng.random() < 0.5:
            msg.update(domain="light", service="turn_on", entity_id="light.room")
            msg["data"] = {
                rng.choice(_FIELDS): _garbage(rng) for _ in range(rng.randint(0, 2))
            }
        decision = policy.validate_call(tiny, msg)
        if decision.ok:
            # Whatever slipped through must be a fully valid, in-profile call
            assert decision.entity_id == "light.room"
            assert (
                f"{decision.domain}.{decision.service}"
                in tiny["entities"]["light.room"]["services"]
            )
            spec = const.GUEST_SERVICES["light"][decision.service]
            assert set(decision.data) <= set(spec)
            for key, value in decision.data.items():
                ok, _reason, _clean = policy.check_value(spec[key], value, None)
                assert ok


def test_fuzz_profile_garbage_never_raises() -> None:
    rng = random.Random(7)
    for _ in range(5000):
        profile = _garbage(rng)
        assert policy.validate_call(profile, call("light.room", "toggle")).ok in (
            True,
            False,
        )


# ─── states ──────────────────────────────────────────────────────────────────


def test_sanitize_removes_tokens_and_context() -> None:
    state = {
        "entity_id": "media_player.speaker",
        "state": "playing",
        "attributes": {
            "friendly_name": "Speaker",
            "entity_picture": "/api/media_player_proxy/media_player.speaker?token=SECRET&cache=1",
            "entity_picture_local": "/api/media_player_proxy/x?token=SECRET2",
            "access_token": "SECRET3",
            "nested": {"url": "https://x/?access_token=SECRET4", "ok": 1},
            "list": ["fine", "token=SECRET5"],
        },
        "last_changed": "2026-11-07T12:00:00+00:00",
        "last_updated": "2026-11-07T12:00:00+00:00",
        "context": {"id": "c", "user_id": "admin-user-id"},
    }
    clean = policy.sanitize_state(state)
    text = repr(clean)
    for secret in ("SECRET", "admin-user-id", "context"):
        assert secret not in text
    assert clean["attributes"]["dash_artwork"] is True
    assert clean["attributes"]["friendly_name"] == "Speaker"
    assert clean["attributes"]["nested"] == {"ok": 1}
    assert clean["attributes"]["list"] == ["fine"]


def test_sanitize_rejects_garbage() -> None:
    assert policy.sanitize_state(None) is None
    assert policy.sanitize_state({"entity_id": "nope"}) is None


def test_sanitize_formats_datetimes() -> None:
    from datetime import UTC, datetime

    when = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
    clean = policy.sanitize_state(
        {
            "entity_id": "light.x",
            "state": "on",
            "attributes": {"at": when},
            "last_changed": when,
        }
    )
    assert clean["last_changed"] == "2026-11-07T12:00:00+00:00"
    assert clean["attributes"]["at"] == "2026-11-07T12:00:00+00:00"


# ─── config ──────────────────────────────────────────────────────────────────

CONFIG = {
    "guestInfo": {
        "wifiSsid": "Guest",
        "wifiPassword": "hunter2",
        "wifiSecurity": "WPA",
    },
    "general": {"showWifi": True, "weatherEntity": "weather.home"},
    "standby": {"enabled": True},
    "appearance": {"mode": "light"},
    "hosting": "self",
    "dashboardUrl": "https://dash.example.com",
    "pages": [
        {"id": "living", "devices": [{"id": "light.room"}, {"id": "lock.front_door"}]},
        {"id": "garage", "devices": [{"id": "cover.garage"}]},
    ],
    "dock": [{"pageId": "living"}, {"pageId": "garage"}],
}


def test_filter_config_removes_foreign_tiles_pages_and_dock() -> None:
    out = policy.filter_config(CONFIG, make_profile(**{"light.room": None}))
    assert [p["id"] for p in out["pages"]] == ["living"]
    assert out["pages"][0]["devices"] == [{"id": "light.room"}]
    assert out["dock"] == [{"pageId": "living"}]
    assert "hosting" not in out and "dashboardUrl" not in out
    assert out["general"]["weatherEntity"] == ""
    assert out["guestInfo"]["wifiPassword"] == "hunter2"


def test_filter_config_hides_wifi() -> None:
    profile = make_profile(**{"light.room": None, "weather.home": None})
    profile["show_wifi"] = False
    out = policy.filter_config(CONFIG, profile)
    assert "hunter2" not in repr(out)
    assert out["general"]["showWifi"] is False
    assert out["general"]["weatherEntity"] == "weather.home"


# ─── profiles ────────────────────────────────────────────────────────────────


def test_normalize_profile_rejects_denied_entities() -> None:
    with pytest.raises(policy.ProfileError) as err:
        policy.normalize_profile(
            {"name": "x", "entities": {"lock.front_door": {}}}, now=NOW
        )
    assert err.value.code == "domain_denied"
    with pytest.raises(policy.ProfileError) as err:
        policy.normalize_profile(
            {"name": "x", "entities": {"cover.garage": {}}},
            now=NOW,
            device_classes_of=lambda _e: {"garage"},
        )
    assert err.value.code == "device_class_denied"


def test_normalize_profile_cleans_services_and_limits() -> None:
    profile = policy.normalize_profile(
        {
            "name": "  Pokoj 3  ",
            "entities": {
                "light.room": {
                    "services": [
                        "light.toggle",
                        "light.turn_on",
                        "light.self_destruct",
                    ],
                    "limits": {
                        "light.turn_on": {
                            "brightness_pct": {"min": -5, "max": 80},
                            "bogus": {},
                        },
                        "light.turn_off": {"transition": {"max": 2}},
                    },
                },
                "sensor.temp": {"services": ["sensor.anything"]},
            },
        },
        now=NOW,
    )
    light = profile["entities"]["light.room"]
    assert profile["name"] == "Pokoj 3"
    assert light["services"] == ["light.toggle", "light.turn_on"]
    assert light["limits"] == {
        "light.turn_on": {"brightness_pct": {"min": 0, "max": 80}}
    }
    assert profile["entities"]["sensor.temp"] == {
        "services": [],
        "limits": {},
        "read_only": True,
    }


def test_normalize_profile_rejects_inverted_limits() -> None:
    with pytest.raises(policy.ProfileError):
        policy.normalize_profile(
            {
                "name": "x",
                "entities": {
                    "climate.room": {
                        "limits": {
                            "climate.set_temperature": {
                                "temperature": {"min": 25, "max": 18}
                            }
                        }
                    }
                },
            },
            now=NOW,
        )


def test_selectability_reasons() -> None:
    assert policy.entity_selectability("lock.door")["reason"] == "domain_denied"
    assert policy.entity_selectability("tts.google")["reason"] == "domain_unsupported"
    assert (
        policy.entity_selectability("cover.g", {"garage"})["reason"]
        == "device_class_denied"
    )
    assert policy.entity_selectability("weather.home")["read_only"] is True
    assert "light.turn_on" in policy.entity_selectability("light.x")["services"]


def test_filter_config_drops_foreign_entity_references() -> None:
    config = {
        "pages": [
            {
                "id": "bath",
                "label": "Koupelna",
                "icon": "Bath",
                "haAreaId": "bathroom",
                "temperatureEntity": "sensor.bath_temp",
                "humidityEntity": "sensor.room_temp",
                "devices": [
                    {"id": "light.room", "label": "Strop", "extra": "lock.front_door"}
                ],
            }
        ]
    }
    profile = make_profile(**{"light.room": None, "sensor.room_temp": None})
    page = policy.filter_config(config, profile)["pages"][0]
    assert "haAreaId" not in page
    assert "temperatureEntity" not in page
    assert page["humidityEntity"] == "sensor.room_temp"
    assert page["label"] == "Koupelna" and page["icon"] == "Bath"
    assert page["devices"] == [{"id": "light.room", "label": "Strop"}]


# ─── section dividers ────────────────────────────────────────────────────────

DIVIDER = {"id": "divider-1a2b3c4d", "type": "divider", "label": "Večer", "size": "4x1"}


def test_divider_is_never_filtered_as_an_entity() -> None:
    """A divider has no entity, so the profile does not have to list it."""
    config = {
        "pages": [
            {
                "id": "living",
                "devices": [
                    DIVIDER,
                    {"id": "light.room", "type": "light"},
                    {"id": "lock.front_door", "type": "switch"},
                ],
            }
        ]
    }
    out = policy.filter_config(config, make_profile(**{"light.room": None}))
    assert out["pages"][0]["devices"] == [
        DIVIDER,
        {"id": "light.room", "type": "light"},
    ]


def test_profile_without_entities_keeps_dividers_but_shows_no_page() -> None:
    """Dividers survive the entity filter, but a page with nothing the guest may
    use is not sent at all, so page names and divider texts of other rooms
    never reach the guest."""
    config = {
        "pages": [
            {"id": "owner", "label": "Pracovna", "devices": [DIVIDER]},
            {
                "id": "living",
                "devices": [DIVIDER, {"id": "light.room", "type": "light"}],
            },
        ],
        "dock": [{"pageId": "owner"}, {"pageId": "living"}],
    }
    out = policy.filter_config(config, make_profile())
    assert out["pages"] == []
    assert out["dock"] == []
    assert "Pracovna" not in repr(out)
    out = policy.filter_config(config, make_profile(**{"light.room": None}))
    assert [p["id"] for p in out["pages"]] == ["living"]
    assert out["pages"][0]["devices"][0] == DIVIDER


@pytest.mark.parametrize(
    "msg",
    [
        {"domain": "light", "service": "turn_on", "entity_id": "divider-1a2b3c4d"},
        {"domain": "divider", "service": "turn_on", "entity_id": "divider.1a2b3c4d"},
    ],
)
def test_divider_cannot_be_called(msg: dict) -> None:
    profile = make_profile(**{"light.room": None})
    profile["entities"]["divider-1a2b3c4d"] = {"services": ["light.turn_on"]}
    decision = policy.validate_call(profile, msg)
    assert decision.ok is False
