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


def test_config_version_constant() -> None:
    assert const.CONFIG_VERSION == 2
    assert const.DEFAULT_CONFIG["configVersion"] == 2


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
    assert out["configVersion"] == 2
    assert out["rooms"] == v1["rooms"]
    assert out["guestInfo"] == {"wifiSsid": "Home"}
    assert "configVersion" not in v1  # input untouched


def test_migrate_is_idempotent() -> None:
    once = schema.migrate_config({"pages": []})
    assert schema.migrate_config(once) == once


def test_migrate_non_dict() -> None:
    assert schema.migrate_config(None) == {"configVersion": 2}


@pytest.mark.parametrize("dtype", sorted(registry.TILE_TYPES))
def test_every_style_and_size_survives(dtype: str) -> None:
    spec = registry.TILE_TYPES[dtype]
    for style, sizes in spec["styles"].items():
        for size in sizes:
            device = {"id": f"{dtype}.x", "type": dtype, "style": style, "size": size}
            device.update(dict.fromkeys(spec.get("fields") or {}, "x"))
            assert schema.normalize_device(device) == device


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
