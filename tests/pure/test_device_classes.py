"""shared/device-classes.json and other values copied from Home Assistant or
const.py into the frontend stay in sync with their source."""

from __future__ import annotations

import json
from pathlib import Path
import re

from _loader import load
import pytest

ROOT = Path(__file__).resolve().parents[2]
const = load("const")
classes = json.loads((ROOT / "shared" / "device-classes.json").read_text("utf-8"))
catalog = {
    icon["name"]
    for icon in json.loads((ROOT / "scripts" / "icon-catalog.json").read_text("utf-8"))[
        "icons"
    ]
}


def _installed(module: str, name: str) -> list[str]:
    try:
        mod = __import__(module, fromlist=[name])
    except ImportError:  # pragma: no cover - CI installs homeassistant
        pytest.skip("homeassistant is not installed")
    return [member.value for member in getattr(mod, name)]


def test_sensor_classes_match_installed_homeassistant() -> None:
    installed = _installed("homeassistant.components.sensor", "SensorDeviceClass")
    assert list(classes["sensor"]) == installed


def test_binary_sensor_classes_match_installed_homeassistant() -> None:
    installed = _installed(
        "homeassistant.components.binary_sensor", "BinarySensorDeviceClass"
    )
    assert list(classes["binary_sensor"]) == installed


def test_icons_exist_in_the_catalog() -> None:
    icons = set(classes["sensor"].values()) | {
        v["icon"] for v in classes["binary_sensor"].values()
    }
    assert icons <= catalog, sorted(icons - catalog)


def test_binary_sensor_wording_has_both_states_in_both_languages() -> None:
    for name, spec in classes["binary_sensor"].items():
        for lang in ("cs", "en"):
            assert len(spec[lang]) == 2 and all(spec[lang]), (name, lang)


def test_guests_tab_capability_defaults_match_const() -> None:
    src = (ROOT / "custom_components/guest_ha_dashboard/www/guests.js").read_text(
        "utf-8"
    )
    match = re.search(r"const CAPABILITY_DEFAULTS = (\{.*?\});", src)
    assert match
    js = json.loads(re.sub(r"(\w+):", r'"\1":', match.group(1)))
    assert js == const.GUEST_CAPABILITY_DEFAULTS


def test_media_feature_table_matches_installed_homeassistant() -> None:
    """src/lib/mediaCaps.js hard-codes MediaPlayerEntityFeature."""
    path = ROOT / "src" / "lib" / "mediaCaps.js"
    if not path.exists():
        pytest.skip("mediaCaps.js not present yet")
    installed = {
        member.name: member.value
        for member in __import__(
            "homeassistant.components.media_player.const",
            fromlist=["MediaPlayerEntityFeature"],
        ).MediaPlayerEntityFeature
    }
    table = {
        name: int(value)
        for name, value in re.findall(
            r"^\s+([A-Z_]+): (\d+),", path.read_text("utf-8"), re.MULTILINE
        )
    }
    assert table == installed
