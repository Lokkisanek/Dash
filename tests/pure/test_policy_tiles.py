"""Guest policy for the stage 2 tiles: scenes, fans, read-only entities, the
long-press light controls (colour, colour temperature, effects) and dash light
groups (list targets).

Service names, fields and feature bits were read from the installed
homeassistant package (2026.10.4): fan/services.py + FanEntityFeature,
scene/services.py, light/const.py (LIGHT_TURN_ON_SCHEMA, ColorMode,
LightEntityFeature).
"""

from __future__ import annotations

from _loader import load
import pytest

policy = load("guest_policy")
const = load("const")


def profile(*entity_ids: str, capabilities: dict | None = None, **limits) -> dict:
    entities = {}
    for eid in entity_ids:
        info = policy.entity_selectability(eid)
        entities[eid] = {
            "services": info["services"],
            "limits": limits.get(eid.replace(".", "__"), {}),
            "read_only": info["read_only"],
        }
    out = {"id": "p" * 32, "name": "Pokoj", "entities": entities, "show_wifi": True}
    if capabilities is not None:
        out["capabilities"] = capabilities
    return out


def call(entity_id, service, data=None, domain=None):
    if domain is None:
        domain = entity_id.split(".")[0] if isinstance(entity_id, str) else "light"
    return {
        "id": 1,
        "type": "call_service",
        "domain": domain,
        "service": service,
        "entity_id": entity_id,
        "data": data or {},
    }


# ─── scenes ──────────────────────────────────────────────────────────────────

SCENE = profile("scene.evening")


def test_scene_allowed_only_for_that_scene() -> None:
    assert policy.validate_call(SCENE, call("scene.evening", "turn_on")).ok
    d = policy.validate_call(SCENE, call("scene.party", "turn_on"))
    assert (d.ok, d.reason) == (False, "entity_not_allowed")


def test_scene_extra_fields_and_other_services_denied() -> None:
    d = policy.validate_call(SCENE, call("scene.evening", "turn_on", {"transition": 2}))
    assert (d.ok, d.reason) == (False, "field_not_allowed")
    d = policy.validate_call(
        SCENE, call("scene.evening", "turn_on", {"entity_id": "light.x"})
    )
    assert (d.ok, d.reason) == (False, "field_not_allowed")
    for service in ("apply", "create", "reload", "delete", "turn_off"):
        d = policy.validate_call(SCENE, call("scene.evening", service))
        assert (d.ok, d.reason) == (False, "service_not_allowed"), service


# ─── fans ────────────────────────────────────────────────────────────────────

FAN_ATTRS = {
    "supported_features": 1 | 2 | 8 | 16 | 32,
    "preset_modes": ["auto", "sleep"],
}
FAN = profile(
    "fan.bedroom",
    fan__bedroom={"fan.set_percentage": {"percentage": {"min": 20, "max": 60}}},
)


@pytest.mark.parametrize(
    ("service", "data"),
    [
        ("turn_on", {}),
        ("turn_off", {}),
        ("set_percentage", {"percentage": 40}),
        ("oscillate", {"oscillating": True}),
        ("set_preset_mode", {"preset_mode": "sleep"}),
    ],
)
def test_fan_allowed(service, data) -> None:
    d = policy.validate_call(
        FAN, call("fan.bedroom", service, data), attributes=FAN_ATTRS
    )
    assert d.ok, d.reason


@pytest.mark.parametrize(
    ("service", "data", "attrs", "reason"),
    [
        ("set_percentage", {"percentage": 80}, FAN_ATTRS, "out_of_range"),
        ("set_percentage", {"percentage": 10}, FAN_ATTRS, "out_of_range"),
        (
            "set_percentage",
            {"percentage": 40},
            {"supported_features": 2},
            "feature_unsupported",
        ),
        ("set_percentage", {"percentage": 40}, None, "feature_unsupported"),
        ("oscillate", {"oscillating": "yes"}, FAN_ATTRS, "invalid_value"),
        (
            "oscillate",
            {"oscillating": True},
            {"supported_features": 1},
            "feature_unsupported",
        ),
        ("set_preset_mode", {"preset_mode": "turbo"}, FAN_ATTRS, "out_of_range"),
        (
            "set_preset_mode",
            {"preset_mode": "auto"},
            {"supported_features": 9},
            "out_of_range",
        ),
        (
            "set_preset_mode",
            {"preset_mode": "auto"},
            {"supported_features": 1, "preset_modes": ["auto"]},
            "feature_unsupported",
        ),
        ("set_direction", {"direction": "reverse"}, FAN_ATTRS, "service_not_allowed"),
        ("increase_speed", {}, FAN_ATTRS, "service_not_allowed"),
    ],
)
def test_fan_denied(service, data, attrs, reason) -> None:
    d = policy.validate_call(FAN, call("fan.bedroom", service, data), attributes=attrs)
    assert (d.ok, d.reason) == (False, reason)


# ─── read-only tiles ─────────────────────────────────────────────────────────

READ = profile("sensor.temp", "binary_sensor.door", "binary_sensor.front_lock")


@pytest.mark.parametrize(
    "eid", ["sensor.temp", "binary_sensor.door", "binary_sensor.front_lock"]
)
def test_sensors_are_read_only(eid) -> None:
    for service in ("turn_on", "toggle", "update_entity"):
        d = policy.validate_call(READ, call(eid, service))
        assert (d.ok, d.reason) == (False, "entity_read_only")


def test_generic_entity_tile_cannot_read_a_denied_domain() -> None:
    """A lock can never be in a profile, so an `entity` tile showing it is dropped."""
    with pytest.raises(policy.ProfileError):
        policy.normalize_profile(
            {"name": "x", "entities": {"lock.front_door": {}}}, now="2026-11-07"
        )
    config = {
        "pages": [
            {
                "id": "p",
                "devices": [
                    {"id": "lock.front_door", "type": "entity"},
                    {"id": "alarm_control_panel.home", "type": "entity"},
                    {
                        "id": "camera.door",
                        "type": "entity",
                        "attribute": "access_token",
                    },
                    {"id": "sensor.temp", "type": "entity", "attribute": "unit"},
                ],
            }
        ]
    }
    out = policy.filter_config(config, READ)
    assert [d["id"] for d in out["pages"][0]["devices"]] == ["sensor.temp"]


# ─── long-press light controls ───────────────────────────────────────────────

FULL = {
    "supported_color_modes": ["color_temp", "hs"],
    "supported_features": 4 | 32,
    "min_color_temp_kelvin": 2200,
    "max_color_temp_kelvin": 6500,
    "effect_list": ["off", "rainbow", "candle"],
}
ALL_ON = {"allow_color": True, "allow_color_temp": True, "allow_effects": True}
LIGHT = profile(
    "light.lamp",
    capabilities=ALL_ON,
    light__lamp={"light.turn_on": {"brightness_pct": {"min": 10, "max": 80}}},
)


@pytest.mark.parametrize(
    "data",
    [
        {"brightness_pct": 50},
        {"brightness": 128},
        {"color_temp_kelvin": 3000},
        {"hs_color": [30, 80]},
        {"rgb_color": [255, 120, 0]},
        {"effect": "rainbow"},
        {"effect": "off"},
        {"brightness_pct": 40, "transition": 2},
        {"hs_color": [359.5, 100]},
    ],
)
def test_light_fields_within_limits(data) -> None:
    d = policy.validate_call(
        LIGHT, call("light.lamp", "turn_on", data), attributes=FULL
    )
    assert d.ok, d.reason


@pytest.mark.parametrize(
    ("data", "reason"),
    [
        ({"brightness_pct": 90}, "out_of_range"),
        ({"brightness_pct": 5}, "out_of_range"),
        ({"brightness": 250}, "out_of_range"),  # 98 % > 80 % limit
        ({"brightness": 10}, "out_of_range"),  # 4 % < 10 % limit
        ({"brightness": 128, "brightness_pct": 50}, "invalid_value"),
        ({"color_temp_kelvin": 1800}, "out_of_range"),  # below the light's minimum
        ({"color_temp_kelvin": 7000}, "out_of_range"),
        ({"hs_color": [400, 50]}, "out_of_range"),
        ({"hs_color": [10, 50, 1]}, "invalid_value"),
        ({"hs_color": ["10", 50]}, "invalid_value"),
        ({"effect": "strobe"}, "out_of_range"),
        ({"transition": 10}, "out_of_range"),  # profile max 5 s
        ({"hs_color": [10, 50], "color_temp_kelvin": 3000}, "invalid_value"),
        ({"kelvin": 3000}, "field_not_allowed"),
        ({"xy_color": [0.3, 0.3]}, "field_not_allowed"),
        ({"color_name": "red"}, "field_not_allowed"),
        ({"profile": "relax"}, "field_not_allowed"),
        ({"flash": "short"}, "field_not_allowed"),
        ({"white": True}, "field_not_allowed"),
    ],
)
def test_light_fields_outside_limits(data, reason) -> None:
    d = policy.validate_call(
        LIGHT, call("light.lamp", "turn_on", data), attributes=FULL
    )
    assert (d.ok, d.reason) == (False, reason)


@pytest.mark.parametrize(
    ("capability", "data"),
    [
        ("allow_color", {"hs_color": [10, 50]}),
        ("allow_color", {"rgb_color": [1, 2, 3]}),
        ("allow_color_temp", {"color_temp_kelvin": 3000}),
        ("allow_effects", {"effect": "rainbow"}),
    ],
)
def test_light_capability_switched_off(capability, data) -> None:
    caps = {**ALL_ON, capability: False}
    d = policy.validate_call(
        profile("light.lamp", capabilities=caps),
        call("light.lamp", "turn_on", data),
        attributes=FULL,
    )
    assert (d.ok, d.reason) == (False, "capability_disabled")


def test_light_defaults_for_existing_profiles() -> None:
    """Stored profiles have no `capabilities`: colour and effects are off."""
    old = profile("light.lamp")
    assert "capabilities" not in old
    caps = policy.profile_capabilities(old)
    assert caps == const.GUEST_CAPABILITY_DEFAULTS
    assert caps["allow_color"] is False and caps["allow_effects"] is False
    assert policy.validate_call(
        old, call("light.lamp", "turn_on", {"brightness_pct": 30})
    ).ok
    d = policy.validate_call(
        old, call("light.lamp", "turn_on", {"hs_color": [1, 2]}), attributes=FULL
    )
    assert d.reason == "capability_disabled"


@pytest.mark.parametrize(
    ("attrs", "data"),
    [
        ({"supported_color_modes": ["brightness"]}, {"hs_color": [1, 2]}),
        ({"supported_color_modes": ["hs"]}, {"color_temp_kelvin": 3000}),
        (
            {
                "supported_color_modes": ["hs"],
                "supported_features": 0,
                "effect_list": ["a"],
            },
            {"effect": "a"},
        ),
        (None, {"color_temp_kelvin": 3000}),
        (None, {"effect": "rainbow"}),
    ],
)
def test_light_feature_the_device_lacks(attrs, data) -> None:
    d = policy.validate_call(
        LIGHT, call("light.lamp", "turn_on", data), attributes=attrs
    )
    assert (d.ok, d.reason) == (False, "feature_unsupported")


def test_capabilities_are_normalized() -> None:
    p = policy.normalize_profile(
        {
            "name": "x",
            "entities": {},
            "capabilities": {
                "allow_color": "yes",
                "allow_effects": True,
                "max_transition": 99,
                "evil": 1,
            },
        },
        now="2026-11-07",
    )
    assert p["capabilities"] == {
        "allow_color": False,
        "allow_color_temp": True,
        "allow_effects": True,
        "max_transition": 60,
        "media_browse": False,
        "media_group": False,
        "max_volume": 0.7,
        "allow_local_player": False,
        "spotify_control": False,
        "spotify_search": False,
        "library_browse": False,
        "library_request": False,
        "library_pick_release": False,
        "library_activity": False,
        "library_max_per_day": 3,
        "library_allow_tv": True,
    }


# ─── light groups: list targets ──────────────────────────────────────────────

GROUP = profile("light.a", "light.b", "light.c", "switch.kettle")


def test_list_target_all_allowed() -> None:
    d = policy.validate_call(
        GROUP,
        call(["light.a", "light.b", "light.a"], "turn_on", {"brightness_pct": 40}),
    )
    assert d.ok
    assert d.entity_id == ["light.a", "light.b"]  # deduplicated, one call
    assert d.data == {"brightness_pct": 40}


def test_list_target_one_denied_rejects_the_whole_call() -> None:
    d = policy.validate_call(GROUP, call(["light.a", "light.other"], "toggle"))
    assert (d.ok, d.reason, d.entity_id) == (False, "entity_not_allowed", "light.other")


def test_list_target_rejects_non_lights_and_long_lists() -> None:
    d = policy.validate_call(GROUP, call(["light.a", "switch.kettle"], "toggle"))
    assert (d.ok, d.reason) == (False, "bad_request")
    long = [f"light.l{i}" for i in range(21)]
    d = policy.validate_call(profile(*long), call(long, "toggle"))
    assert (d.ok, d.reason) == (False, "bad_request")
    d = policy.validate_call(profile(*long[:20]), call(long[:20], "toggle"))
    assert d.ok
    d = policy.validate_call(GROUP, call(["switch.kettle"], "toggle", domain="switch"))
    assert (d.ok, d.reason) == (False, "bad_request")
    d = policy.validate_call(GROUP, call(["light.a", 7], "toggle"))
    assert (d.ok, d.reason) == (False, "bad_request")


def test_list_target_checks_each_light_for_device_fields() -> None:
    attrs = {"light.a": FULL, "light.b": {"supported_color_modes": ["brightness"]}}
    caps = profile("light.a", "light.b", capabilities=ALL_ON)
    d = policy.validate_call(
        caps,
        call(["light.a", "light.b"], "turn_on", {"hs_color": [10, 10]}),
        attributes_of=attrs.get,
    )
    assert (d.ok, d.reason, d.entity_id) == (False, "feature_unsupported", "light.b")


def test_single_entity_path_unchanged() -> None:
    d = policy.validate_call(GROUP, call("light.a", "toggle"))
    assert d.ok and d.entity_id == "light.a"


def test_light_group_tile_shows_only_profile_members() -> None:
    config = {
        "pages": [
            {
                "id": "p",
                "devices": [
                    {
                        "id": "light_group-1",
                        "type": "light_group",
                        "entities": ["light.a", "light.x", "light.b"],
                    },
                    {
                        "id": "light_group-2",
                        "type": "light_group",
                        "entities": ["light.x", "light.y"],
                    },
                ],
            }
        ]
    }
    out = policy.filter_config(config, GROUP)
    devices = out["pages"][0]["devices"]
    assert [d["id"] for d in devices] == ["light_group-1"]
    assert devices[0]["entities"] == ["light.a", "light.b"]
    # a page with only an unusable group is not sent
    config["pages"][0]["devices"] = config["pages"][0]["devices"][1:]
    assert policy.filter_config(config, GROUP)["pages"] == []


# ─── media (stage 3) ─────────────────────────────────────────────────────────

ALL_MEDIA = 0x7FFFFF  # every MediaPlayerEntityFeature bit of HA 2026.10.4
SPK = {
    "supported_features": ALL_MEDIA,
    "source_list": ["Radio", "TV"],
    "volume_level": 0.5,
}
MEDIA_ON = {"media_browse": True, "media_group": True, "max_volume": 0.7}
MEDIA = profile("media_player.speaker", "media_player.kitchen", capabilities=MEDIA_ON)


def media(service, data=None, attrs=SPK, prof=MEDIA, issued=None):
    return policy.validate_call(
        prof,
        call("media_player.speaker", service, data),
        attributes=attrs,
        issued=issued,
    )


@pytest.mark.parametrize(
    ("service", "bit"),
    [
        ("media_play", 16384),
        ("media_pause", 1),
        ("media_stop", 4096),
        ("media_next_track", 32),
        ("media_previous_track", 16),
        ("turn_on", 128),
        ("turn_off", 256),
        ("unjoin", 524288),
    ],
)
def test_media_service_needs_its_feature(service, bit) -> None:
    assert media(service, attrs={"supported_features": bit}).ok
    d = media(service, attrs={"supported_features": ALL_MEDIA & ~bit})
    assert (d.ok, d.reason) == (False, "feature_unsupported")
    assert media(service, attrs=None).reason == "feature_unsupported"


def test_play_pause_needs_play_or_pause() -> None:
    assert media("media_play_pause", attrs={"supported_features": 1}).ok
    assert media("media_play_pause", attrs={"supported_features": 16384}).ok
    assert media("media_play_pause", attrs={"supported_features": 32}).reason == (
        "feature_unsupported"
    )


def test_volume_is_clamped_to_the_profile_maximum() -> None:
    d = media("volume_set", {"volume_level": 0.95})
    assert d.ok and d.data == {"volume_level": 0.7}
    d = media("volume_set", {"volume_level": 0.3})
    assert d.ok and d.data == {"volume_level": 0.3}
    loud = {**SPK, "volume_level": 0.7}
    assert media("volume_up", attrs=loud).reason == "out_of_range"
    assert media("volume_up").ok
    assert media("volume_down", attrs=loud).ok


def test_mute_and_seek() -> None:
    assert media("volume_mute", {"is_volume_muted": True}).ok
    assert media("volume_mute", {"is_volume_muted": "yes"}).reason == "invalid_value"
    assert media("media_seek", {"seek_position": 42.5}).ok
    assert media("media_seek", {"seek_position": -1}).reason == "out_of_range"
    no_seek = {**SPK, "supported_features": ALL_MEDIA & ~2}
    assert media("media_seek", {"seek_position": 1}, attrs=no_seek).reason == (
        "feature_unsupported"
    )


def test_source_must_be_in_the_source_list() -> None:
    assert media("select_source", {"source": "TV"}).ok
    assert media("select_source", {"source": "Garage"}).reason == "out_of_range"
    empty = {**SPK, "source_list": []}
    assert (
        media("select_source", {"source": "TV"}, attrs=empty).reason == "out_of_range"
    )


def test_join_needs_media_group_and_members_in_the_profile() -> None:
    ok = media("join", {"group_members": ["media_player.kitchen"]})
    assert ok.ok and ok.data == {"group_members": ["media_player.kitchen"]}
    d = media("join", {"group_members": ["media_player.bedroom"]})
    assert (d.ok, d.reason) == (False, "entity_not_allowed")
    d = media("join", {"group_members": ["light.lamp"]})
    assert (d.ok, d.reason) == (False, "invalid_value")
    off = profile(
        "media_player.speaker",
        "media_player.kitchen",
        capabilities={**MEDIA_ON, "media_group": False},
    )
    d = media("join", {"group_members": ["media_player.kitchen"]}, prof=off)
    assert (d.ok, d.reason) == (False, "capability_disabled")
    assert media("unjoin", prof=off).reason == "capability_disabled"


def test_play_media_only_for_issued_ids() -> None:
    issued = {"library://track/42", "media-source://radio_browser/abc"}.__contains__
    data = {"media_content_type": "music", "media_content_id": "library://track/42"}
    assert media("play_media", data, issued=issued).ok
    assert media("play_media", {**data, "enqueue": "next"}, issued=issued).ok
    d = media(
        "play_media", {**data, "media_content_id": "library://track/43"}, issued=issued
    )
    assert (d.ok, d.reason) == (False, "entity_not_allowed")
    assert media("play_media", data, issued=None).reason == "entity_not_allowed"
    d = media("play_media", {**data, "enqueue": "later"}, issued=issued)
    assert d.reason == "invalid_value"
    off = profile(
        "media_player.speaker", capabilities={**MEDIA_ON, "media_browse": False}
    )
    assert (
        media("play_media", data, prof=off, issued=issued).reason
        == "capability_disabled"
    )


@pytest.mark.parametrize(
    "content_id",
    [
        "http://evil.example/stream.mp3",
        "HTTPS://evil.example/a",
        "file:///etc/passwd",
        "data:audio/mp3;base64,AAAA",
        "rtsp://cam/1",
        "/api/media_player_proxy/x?token=abc",
        "library://track/1?access_token=x",
    ],
)
def test_url_like_content_ids_are_never_played(content_id) -> None:
    always = lambda _cid: True
    data = {"media_content_type": "music", "media_content_id": content_id}
    d = media("play_media", data, issued=always)
    assert (d.ok, d.reason) == (False, "invalid_value")


def test_old_profiles_get_no_media_browse_or_grouping() -> None:
    caps = policy.profile_capabilities({"entities": {}})
    assert (caps["media_browse"], caps["media_group"], caps["max_volume"]) == (
        False,
        False,
        0.7,
    )


def test_sanitize_browse_strips_and_limits() -> None:
    payload = {
        "title": "Knihovna",
        "media_class": "directory",
        "media_content_type": "library",
        "media_content_id": "library://",
        "can_play": False,
        "can_expand": True,
        "thumbnail": "/api/media_player_proxy/x?token=SECRET",
        "not_shown": 3,
        "children": [
            {
                "title": f"Track {i}",
                "media_class": "track",
                "media_content_type": "music",
                "media_content_id": f"library://track/{i}",
                "can_play": True,
                "can_expand": False,
                "thumbnail": "https://cdn/x.jpg",
                "secret": "x",
            }
            for i in range(130)
        ]
        + [
            {"title": "Stream", "media_content_id": "http://radio/x", "can_play": True},
            {
                "title": "Tok",
                "media_content_id": "library://a",
                "media_class": "track?token=1",
            },
        ],
    }
    out = policy.sanitize_browse(payload)
    assert out["title"] == "Knihovna" and out["truncated"] is True
    assert len(out["children"]) == 100
    child = out["children"][0]
    assert set(child) <= {
        "title",
        "media_class",
        "media_content_type",
        "media_content_id",
        "children_media_class",
        "can_play",
        "can_expand",
    }
    assert "SECRET" not in repr(out) and "thumbnail" not in repr(out)
    assert all(not c["media_content_id"].startswith("http") for c in out["children"])
    search = policy.sanitize_browse({"result": payload["children"][:3]})
    assert [c["title"] for c in search["children"]] == ["Track 0", "Track 1", "Track 2"]
