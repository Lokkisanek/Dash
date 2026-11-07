"""Config versioning and tile registry validation (config_schema.py)."""

from __future__ import annotations

import json
from pathlib import Path

from _loader import load
import pytest

schema = load("config_schema")
const = load("const")
registry = load("tile_registry")

ROOT = Path(__file__).resolve().parents[2]


def test_registry_matches_shared_json() -> None:
    """tile_registry.py is generated from shared/tiles.json (npm run gen:tiles)."""
    shared = json.loads((ROOT / "shared" / "tiles.json").read_text("utf-8"))
    assert registry.GRID_COLS == shared["gridCols"]
    assert set(registry.TILE_TYPES) == set(shared["types"])
    for name, spec in shared["types"].items():
        assert registry.TILE_TYPES[name]["styles"] == spec["styles"]
        assert registry.TILE_TYPES[name]["needsEntity"] == spec["needsEntity"]


def test_generic_entity_tile_excludes_every_denied_domain() -> None:
    """The panel never offers a hard-denied domain for the generic `entity` tile."""
    spec = registry.TILE_TYPES["entity"]
    assert spec["domains"] == ["*"]
    assert set(const.GUEST_DENIED_DOMAINS) <= set(spec["excludeDomains"])


def test_config_version_constant() -> None:
    assert const.CONFIG_VERSION == 3
    assert const.DEFAULT_CONFIG["configVersion"] == 3
    # the header switches left `general` with version 3
    assert set(const.DEFAULT_GENERAL) == {"use24h", "statusBarStrip"}


@pytest.mark.parametrize(
    ("data", "version"),
    [
        ({}, 1),
        ({"configVersion": None}, 1),
        ({"configVersion": "2"}, 1),
        ({"configVersion": True}, 1),
        ({"configVersion": 0}, 1),
        ({"configVersion": 1}, 1),
        ({"configVersion": 2}, 2),
        ({"configVersion": 7}, 7),
        (None, 1),
    ],
)
def test_config_version(data, version) -> None:
    assert schema.config_version(data) == version


def test_migrate_v1_adds_version_and_keeps_data() -> None:
    v1 = {
        "rooms": [{"id": "obyvak", "devices": [{"id": "light.a", "type": "light"}]}],
        "guestInfo": {"wifiSsid": "Home"},
    }
    out = schema.migrate_config(v1)
    assert out["configVersion"] == 3
    # no `general` at all: the old defaults showed the header, so it becomes a tile
    devices = out["rooms"][0]["devices"]
    assert [d["type"] for d in devices] == ["header", "light"]
    assert devices[1:] == v1["rooms"][0]["devices"]
    assert out["guestInfo"] == {"wifiSsid": "Home"}
    assert "configVersion" not in v1  # input untouched
    assert len(v1["rooms"][0]["devices"]) == 1


def test_migrate_is_idempotent() -> None:
    once = schema.migrate_config({"pages": []})
    assert schema.migrate_config(once) == once


OLD_TOGGLES = (
    "showTopBar",
    "showWelcome",
    "showTime",
    "showDate",
    "showWifi",
    "showTemperature",
    "showHumidity",
)


def _v2(general: dict, devices: list | None = None) -> dict:
    return {
        "configVersion": 2,
        "general": {"use24h": False, **general},
        "pages": [
            {"id": "p1", "devices": devices or [{"id": "light.a", "type": "light"}]},
            {"id": "p2", "devices": [{"id": "switch.b", "type": "switch"}]},
        ],
    }


@pytest.mark.parametrize("bits", range(2 ** len(OLD_TOGGLES)))
@pytest.mark.parametrize("weather", ["", "weather.home"])
def test_header_switches_become_one_tile(bits: int, weather: str) -> None:
    old = {name: bool(bits >> i & 1) for i, name in enumerate(OLD_TOGGLES)}
    out = schema.migrate_config(_v2({**old, "weatherEntity": weather}))
    assert out["configVersion"] == 3
    # obsolete keys are gone, the rest of `general` is kept
    assert out["general"] == {"use24h": False}
    first = out["pages"][0]["devices"]
    assert out["pages"][1]["devices"] == [{"id": "switch.b", "type": "switch"}]
    if not old["showTopBar"] and not old["showWelcome"]:
        assert first == [{"id": "light.a", "type": "light"}]
        return
    header, rest = first[0], first[1:]
    assert rest == [{"id": "light.a", "type": "light"}]
    header_id = header.pop("id")
    assert header_id.startswith("header-")
    top, welcome = old["showTopBar"], old["showWelcome"]
    assert header == {
        "type": "header",
        "style": "card",
        "size": "4x2",
        "showTime": top and old["showTime"],
        "showDate": top and old["showDate"],
        "showWifi": top and old["showWifi"],
        "showGreeting": welcome,
        "showWeather": welcome,
        "showTemperature": old["showTemperature"],
        "showHumidity": old["showHumidity"],
        "entity": weather,
        "contrast": "auto",
    }
    # the result survives tile validation unchanged
    assert schema.normalize_device({**header, "id": header_id}) == {
        **header,
        "id": header_id,
    }
    # idempotent: a second run changes nothing
    again = schema.migrate_config(out)
    assert again == out


@pytest.mark.parametrize("existing", ["header", "clock", "greeting", "weather"])
def test_no_second_header_when_a_page_has_one(existing: str) -> None:
    config = _v2({"showTopBar": True, "showWelcome": True})
    config["pages"][1]["devices"].append({"type": existing, "id": f"{existing}-1"})
    out = schema.migrate_config(config)
    assert [d["type"] for d in out["pages"][0]["devices"]] == ["light"]
    assert "showTopBar" not in out["general"]


def test_v3_config_is_not_migrated_again() -> None:
    """A v3 config without header tiles stays without one (the owner removed it)."""
    config = {**_v2({"showTopBar": True}), "configVersion": 3}
    out = schema.migrate_config(config)
    assert [d["type"] for d in out["pages"][0]["devices"]] == ["light"]
    assert out["general"] == {"use24h": False}


def test_migration_without_pages_inserts_nothing() -> None:
    out = schema.migrate_config({"configVersion": 2, "general": {"showTopBar": True}})
    assert out == {"configVersion": 3, "general": {}}


def test_migration_fixture_shared_with_the_app() -> None:
    """tests/fixtures/header-migration.json is also checked by tests/js (configMigrate.js)."""
    cases = json.loads(
        (ROOT / "tests" / "fixtures" / "header-migration.json").read_text("utf-8")
    )
    assert cases
    for case in cases:
        out = schema.migrate_config(case["input"])
        for page in out.get("pages", []):
            for device in page.get("devices", []):
                if device.get("type") == "header":
                    device["id"] = "header-*"
        assert out == case["output"], case["name"]


def test_migrate_non_dict() -> None:
    assert schema.migrate_config(None) == {"configVersion": 3}


@pytest.mark.parametrize("dtype", sorted(registry.TILE_TYPES))
def test_every_style_and_size_survives(dtype: str) -> None:
    spec = registry.TILE_TYPES[dtype]
    for style, sizes in spec["styles"].items():
        for size in sizes:
            device = {"id": f"{dtype}.x", "type": dtype, "style": style, "size": size}
            device.update(
                {
                    name: _valid_value(f)
                    for name, f in (spec.get("fields") or {}).items()
                }
            )
            assert schema.normalize_device(device) == device


def _valid_value(spec: dict):
    kind = spec["type"]
    if kind == "bool":
        return not spec["default"]
    if kind == "enum":
        return spec["values"][-1]
    if kind == "entity":
        return f"{spec['domains'][0]}.x"
    if kind == "entities":
        return [f"{spec['domains'][0]}.a", f"{spec['domains'][0]}.b"]
    return "x"


@pytest.mark.parametrize(
    ("spec", "value", "expected"),
    [
        ({"type": "bool", "default": True}, False, False),
        ({"type": "bool", "default": True}, "false", True),
        ({"type": "bool", "default": False}, None, False),
        ({"type": "enum", "values": ["a", "b"], "default": "a"}, "b", "b"),
        ({"type": "enum", "values": ["a", "b"], "default": "a"}, "c", "a"),
        ({"type": "entity", "domains": ["weather"]}, "weather.home", "weather.home"),
        ({"type": "entity", "domains": ["weather"]}, "sensor.temp", ""),
        ({"type": "entity", "domains": ["weather"]}, "weather.Home", ""),
        ({"type": "entity", "domains": ["weather"]}, ["weather.home"], ""),
        (
            {"type": "entities", "domains": ["light"], "min": 2, "max": 3},
            ["light.a", "light.a", "switch.b", 7, "light.b", "light.c", "light.d"],
            ["light.a", "light.b", "light.c"],
        ),
        ({"type": "entities", "domains": ["light"], "min": 2, "max": 3}, "light.a", []),
        ({"type": "string", "max": 3}, "abcdef", "abc"),
        ({"type": "string", "max": 3}, None, ""),
    ],
)
def test_normalize_field(spec, value, expected) -> None:
    assert schema.normalize_field(spec, value) == expected


def test_header_tile_options_are_typed() -> None:
    d = schema.normalize_device(
        {"type": "header", "showTime": "yes", "contrast": "neon", "entity": "light.x"}
    )
    assert d["id"].startswith("header-")
    assert (d["style"], d["size"]) == ("card", "4x2")
    assert d["showTime"] is True  # not a bool -> default
    assert d["showWifi"] is False  # missing -> default
    assert d["contrast"] == "auto"
    assert d["entity"] == ""


def test_divider_gets_a_unique_id_and_a_short_label() -> None:
    used: set[str] = set()
    a = schema.normalize_device({"type": "divider", "label": "Obývák " * 20}, used)
    assert a["id"].startswith("divider-")
    assert len(a["id"]) == len("divider-") + 8
    assert a["style"] == "line"
    assert a["size"] == "4x1"
    assert len(a["label"]) == 60
    # an id that is already taken in the config is replaced
    b = schema.normalize_device({"type": "divider", "id": a["id"]}, used)
    assert b["id"] != a["id"]
    assert b["label"] == ""
    # a stored id is kept, it never has to look like an entity id
    c = schema.normalize_device({"type": "divider", "id": "sekce-1"}, set())
    assert c["id"] == "sekce-1"


def test_divider_ids_unique_across_pages() -> None:
    used: set[str] = set()
    first, _ = schema.normalize_devices([{"type": "divider", "id": "d"}], used)
    second, _ = schema.normalize_devices([{"type": "divider", "id": "d"}], used)
    assert first[0]["id"] == "d"
    assert second[0]["id"] != "d"


def test_needs_entity() -> None:
    assert schema.needs_entity("light") is True
    assert schema.needs_entity("divider") is False
    assert schema.needs_entity("toaster") is False


def test_missing_type_comes_from_the_entity_domain() -> None:
    """Configs written by hand or by old versions may lack `type`."""
    kept, dropped = schema.normalize_devices(
        [{"id": "light.room"}, {"id": "lock.front_door"}, {"label": "no id"}]
    )
    assert kept == [
        {"id": "light.room", "type": "light", "style": "tile", "size": "2x2"}
    ]
    assert dropped == [None, None]


def test_unknown_type_is_dropped() -> None:
    kept, dropped = schema.normalize_devices(
        [
            {"id": "light.a", "type": "light"},
            {"id": "lock.door", "type": "lock"},
            {"id": "x"},
            "garbage",
        ]
    )
    assert [d["id"] for d in kept] == ["light.a"]
    assert dropped == ["lock", None, "garbage"]


def test_bad_style_and_size_fall_back_to_defaults() -> None:
    # unknown style -> first style and its first size
    d = schema.normalize_device({"id": "light.a", "type": "light", "style": "nope"})
    assert (d["style"], d["size"]) == ("tile", "2x2")
    # valid style, size of another style -> that style's first size
    d = schema.normalize_device(
        {"id": "light.a", "type": "light", "style": "slider", "size": "2x2"}
    )
    assert (d["style"], d["size"]) == ("slider", "4x1")
    d = schema.normalize_device({"id": "m.a", "type": "media_player", "size": "9x9"})
    assert (d["style"], d["size"]) == ("tile", "4x2")


def test_extra_keys_and_empty_ids_are_kept() -> None:
    """Stored tiles may have no entity yet; they must not disappear."""
    d = schema.normalize_device(
        {"type": "switch", "label": "Otevřít dveře", "supportsBrightness": False}
    )
    assert d["id"] == ""
    assert d["label"] == "Otevřít dveře"
    assert d["supportsBrightness"] is False


def test_normalize_devices_tolerates_missing_list() -> None:
    assert schema.normalize_devices(None) == ([], [])
    assert schema.normalize_devices({"a": 1}) == ([], [])
