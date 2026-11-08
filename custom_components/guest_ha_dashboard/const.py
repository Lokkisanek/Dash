"""Constants for dash (Guest HA Dashboard integration)."""

DOMAIN = "guest_ha_dashboard"
VERSION = "2.1.0"
STORAGE_KEY = f"{DOMAIN}.config"
STORAGE_VERSION = 1
# Version of the dashboard config inside the store (see config_schema.py).
# 1 = everything stored before 2.1, 2 = configVersion + tile registry validation,
# 3 = header switches in `general` became a `header` tile.
CONFIG_VERSION = 3

PANEL_ICON = "mdi:tablet-dashboard"
PANEL_TITLE = "dash"
PANEL_URL_PATH = "guest-dashboard"
PANEL_COMPONENT = "guest-ha-dashboard-panel"

DOCK_MAX = 6

# Standby photo frame: images live next to the HA config, never in the PWA host.
PHOTOS_DIR = "dash_photos"
PHOTOS_MAX = 60
PHOTO_MAX_BYTES = 3 * 1024 * 1024

# Since config version 3 the clock, greeting, weather and Wi-Fi button are tiles
# (header, clock, greeting, weather, wifi); their options live on the tile.
DEFAULT_GENERAL: dict = {
    "use24h": True,
    # Installed iPhone app: solid dark strip behind the white status bar (opt-in)
    "statusBarStrip": False,
    # auto = several pages side by side on wide screens; single = one column
    "layoutMode": "auto",
    # auto = on the right on a phone in landscape, at the bottom elsewhere
    "dockPosition": "auto",
}

# `general` keys that take one of a fixed set of values (first = default)
GENERAL_ENUMS: dict[str, tuple[str, ...]] = {
    "layoutMode": ("auto", "single"),
    "dockPosition": ("auto", "bottom", "right", "left"),
}

DEFAULT_STANDBY: dict = {
    "enabled": False,
    "idleMinutes": 2,
    "mode": "clock",  # clock | photos
    "clockStyle": "bold",  # bold | minimal
    "photoSeconds": 8,
}

DEFAULT_CONFIG: dict = {
    "configVersion": CONFIG_VERSION,
    "guestInfo": {
        "wifiSsid": "Guest-Home",
        "wifiPassword": "",
        "wifiSecurity": "WPA",
    },
    # Clock format and iPhone status bar; the header itself is a tile
    "general": dict(DEFAULT_GENERAL),
    "standby": dict(DEFAULT_STANDBY),
    # Dashboard pages: grid of entity tiles
    "pages": [],
    # Bottom dock — max 6 page shortcuts (label optional)
    "dock": [],
    # "hosted" = dash.matyas.online/<ha-host>, "self" = dashboardUrl
    "hosting": "hosted",
    "dashboardUrl": "",
    "appearance": {
        "mode": "light",  # light | dark
        "accent": "#ff6b00",
    },
    # browser radio stations, HA media folder, optional station directory (music.py)
    "radio": {"stations": [], "mediaLibrary": False, "directory": False},
    # opt-in Spotify engine: switches only, secrets live in the vault
    "spotify": {"enabled": False, "webPlayer": False},
    # Videotéka switches and default pickers; service credentials live in the vault
    "library": {
        "enabled": False,
        "movieProfileId": None,
        "movieRootFolder": "",
        "tvProfileId": None,
        "tvRootFolder": "",
        "interval": 3,
    },
}


# ─── Guest passes ────────────────────────────────────────────────────────────
# Design and threat model: docs/GUEST_PASSES.md. Everything below is plain data
# so the policy modules stay free of Home Assistant imports and easy to test.

# Secrets (Spotify tokens, library credentials): never in the config (vault.py)
VAULT_STORAGE_KEY = f"{DOMAIN}.vault"
VAULT_STORAGE_VERSION = 1

GUEST_STORAGE_KEY = f"{DOMAIN}.guests"
GUEST_STORAGE_VERSION = 1

# Pairing codes: 12 symbols, no 0/O/1/I/L (31 symbols, ~2^59 combinations)
PAIR_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
PAIR_CODE_LENGTH = 12
PAIR_CODE_TTL_SECONDS = 15 * 60

PASS_KINDS = ("phone", "tablet")
PASS_MAX_SOCKETS = 3
PASS_LABEL_MAX = 80
PROFILE_NAME_MAX = 80
PROFILE_MAX_ENTITIES = 200
LAST_SEEN_INTERVAL_SECONDS = 5 * 60
AUDIT_MAX_ENTRIES = 200

# Defaults the panel offers when creating a pass (local time of the HA instance)
PASS_DEFAULT_CHECKIN = "14:00"
PASS_DEFAULT_CHECKOUT = "11:00"
PASS_DEFAULT_NIGHTS = 1

# Rate limits for failed pairing / guest auth attempts
FAIL_LIMIT_PER_IP = 5
FAIL_WINDOW_SECONDS = 60
FAIL_LOCKOUT_BASE_SECONDS = 60
FAIL_LOCKOUT_MAX_SECONDS = 60 * 60
FAIL_LIMIT_GLOBAL = 50
FAIL_GLOBAL_LOCK_SECONDS = 60
FAIL_TRACKED_IPS_MAX = 10_000

# Guest websocket
WS_MAX_MESSAGE_BYTES = 16 * 1024
WS_AUTH_TIMEOUT_SECONDS = 10
WS_IDLE_TIMEOUT_SECONDS = 180
WS_HEARTBEAT_SECONDS = 55
CALL_BUCKET_BURST = 20
CALL_BUCKET_PER_SECOND = 5
SERVICE_CALL_TIMEOUT_SECONDS = 10
MEDIA_IMAGE_MAX_BYTES = 2 * 1024 * 1024

# Close codes of the guest websocket
CLOSE_INVALID_AUTH = 4000
CLOSE_PROFILE_CHANGED = 4001
CLOSE_EXPIRED = 4002
CLOSE_REVOKED = 4003
CLOSE_TOO_MANY = 4004
CLOSE_IDLE = 4008

# Field specs: type + global bounds. Profile limits can only narrow these.
_INT = "int"
_NUM = "number"
_STR = "string"
_ENUM = "enum"
_RGB = "rgb"
_HS = "hs"
_BOOL = "bool"
_ENTITIES = "entities"

HVAC_MODES = ("off", "heat", "cool", "heat_cool", "auto", "dry", "fan_only")

# domain -> service -> {field: spec}. Anything not listed is denied.
GUEST_SERVICES: dict = {
    # Fields and ranges as in light.turn_on of HA 2026.10.4 (light/const.py,
    # LIGHT_TURN_ON_SCHEMA). `brightness` is checked against the brightness_pct
    # limit after conversion; colour, colour temperature and effects also need
    # the profile capability and the light's own support (guest_policy.py).
    "light": {
        "turn_on": {
            "brightness": {"type": _INT, "min": 0, "max": 255},
            "brightness_pct": {"type": _NUM, "min": 0, "max": 100},
            "color_temp_kelvin": {"type": _INT, "min": 1000, "max": 12000},
            "hs_color": {"type": _HS},
            "rgb_color": {"type": _RGB, "min": 0, "max": 255},
            "effect": {"type": _STR, "max_len": 100},
            "transition": {"type": _NUM, "min": 0, "max": 60},
        },
        "turn_off": {"transition": {"type": _NUM, "min": 0, "max": 60}},
        "toggle": {},
    },
    "switch": {"turn_on": {}, "turn_off": {}, "toggle": {}},
    "input_boolean": {"turn_on": {}, "turn_off": {}, "toggle": {}},
    # fan services of HA 2026.10.4 (fan/services.py)
    "fan": {
        "turn_on": {},
        "turn_off": {},
        "set_percentage": {"percentage": {"type": _INT, "min": 0, "max": 100}},
        "oscillate": {"oscillating": {"type": _BOOL}},
        "set_preset_mode": {"preset_mode": {"type": _STR, "max_len": 100}},
    },
    "cover": {
        "open_cover": {},
        "close_cover": {},
        "stop_cover": {},
        "set_cover_position": {"position": {"type": _INT, "min": 0, "max": 100}},
    },
    "climate": {
        "set_temperature": {"temperature": {"type": _NUM, "min": 0, "max": 40}},
        "set_hvac_mode": {"hvac_mode": {"type": _ENUM, "enum": list(HVAC_MODES)}},
        "turn_on": {},
        "turn_off": {},
    },
    # media_player services of HA 2026.10.4 (media_player/services.py). The
    # feature bit each one needs is in GUEST_SERVICE_FEATURES; join needs the
    # profile capability media_group, play_media media_browse plus a content id
    # this pass got from browse/search (guest_policy.py).
    "media_player": {
        "media_play": {},
        "media_pause": {},
        "media_play_pause": {},
        "media_stop": {},
        "media_next_track": {},
        "media_previous_track": {},
        "media_seek": {"seek_position": {"type": _NUM, "min": 0, "max": 86400}},
        "volume_set": {"volume_level": {"type": _NUM, "min": 0, "max": 1}},
        "volume_mute": {"is_volume_muted": {"type": _BOOL}},
        "volume_up": {},
        "volume_down": {},
        "turn_on": {},
        "turn_off": {},
        "select_source": {"source": {"type": _STR, "max_len": 100}},
        "join": {
            "group_members": {"type": _ENTITIES, "domain": "media_player", "max": 10}
        },
        "unjoin": {},
        "play_media": {
            "media_content_type": {"type": _STR, "max_len": 100},
            "media_content_id": {"type": _STR, "max_len": 1000},
            "enqueue": {"type": _ENUM, "enum": ["add", "next", "play", "replace"]},
        },
    },
    "scene": {"turn_on": {}},
    "humidifier": {
        "turn_on": {},
        "turn_off": {},
        "set_humidity": {"humidity": {"type": _INT, "min": 0, "max": 100}},
    },
    "vacuum": {"start": {}, "pause": {}, "return_to_base": {}},
}

GUEST_READ_ONLY_DOMAINS = ("sensor", "binary_sensor", "weather", "sun")

# Profile-wide switches, edited in the Guests tab. Missing in a stored profile =
# these defaults: what profiles could do before stays (colour temperature), new
# capabilities start switched off (colour, effects).
GUEST_CAPABILITY_DEFAULTS: dict = {
    "allow_color": False,
    "allow_color_temp": True,
    "allow_effects": False,
    "max_transition": 5,
    # music: browse/search and play what was found, group speakers, volume cap
    "media_browse": False,
    "media_group": False,
    "max_volume": 0.7,
    # browser radio / HA media files on the guest's own device (read-only stations)
    "allow_local_player": False,
    # Spotify through the integration (never a token): playback control, search
    "spotify_control": False,
    "spotify_search": False,
    # Videotéka (docs/LIBRARY.md): browse, request, pick a release, watch downloads
    "library_browse": False,
    "library_request": False,
    "library_pick_release": False,
    "library_activity": False,
    "library_max_per_day": 3,
    "library_allow_tv": True,
}

# supported_features bit an entity must have for a guest call (HA 2026.10.4:
# FanEntityFeature SET_SPEED=1, OSCILLATE=2, PRESET_MODE=8).
# A mask means "any of these bits" (media_play_pause: PLAY or PAUSE).
# MediaPlayerEntityFeature of HA 2026.10.4: PAUSE=1 SEEK=2 VOLUME_SET=4
# VOLUME_MUTE=8 PREVIOUS_TRACK=16 NEXT_TRACK=32 TURN_ON=128 TURN_OFF=256
# PLAY_MEDIA=512 VOLUME_STEP=1024 SELECT_SOURCE=2048 STOP=4096 PLAY=16384
# BROWSE_MEDIA=131072 GROUPING=524288 SEARCH_MEDIA=4194304.
GUEST_SERVICE_FEATURES: dict = {
    "fan.set_percentage": 1,
    "fan.oscillate": 2,
    "fan.set_preset_mode": 8,
    "media_player.media_play": 16384,
    "media_player.media_pause": 1,
    "media_player.media_play_pause": 16384 | 1,
    "media_player.media_stop": 4096,
    "media_player.media_next_track": 32,
    "media_player.media_previous_track": 16,
    "media_player.media_seek": 2,
    "media_player.volume_set": 4,
    "media_player.volume_mute": 8,
    "media_player.volume_up": 4 | 1024,
    "media_player.volume_down": 4 | 1024,
    "media_player.turn_on": 128,
    "media_player.turn_off": 256,
    "media_player.select_source": 2048,
    "media_player.join": 524288,
    "media_player.unjoin": 524288,
    "media_player.play_media": 512,
}
MEDIA_FEATURE_BROWSE = 131072
MEDIA_FEATURE_SEARCH = 4194304

# Browse/search for guests: what is sent, how much, how long a found id stays playable
MEDIA_BROWSE_MAX_CHILDREN = 100
# HA media files played in a guest's browser: signed path lifetime
LOCAL_MEDIA_SIGN_SECONDS = 5 * 60
MEDIA_ISSUED_TTL_SECONDS = 10 * 60
MEDIA_ISSUED_MAX = 500
MEDIA_SEARCH_MAX_LEN = 100
# Content ids that point straight at a stream or a file are never played for a guest
MEDIA_URL_SCHEMES = (
    "http",
    "https",
    "ftp",
    "file",
    "data",
    "rtsp",
    "rtmp",
    "ws",
    "wss",
)

# LightEntityFeature.EFFECT and ColorMode groups (HA 2026.10.4, light/const.py)
LIGHT_FEATURE_EFFECT = 4
LIGHT_COLOR_MODES = ("hs", "rgb", "rgbw", "rgbww", "xy")
LIGHT_COLOR_TEMP_MODE = "color_temp"

# A guest call may target a list of lights (dash light groups); every one is checked.
LIST_TARGET_DOMAINS = ("light",)
LIST_TARGET_MAX = 20

GUEST_DENIED_DOMAINS = (
    "lock",
    "alarm_control_panel",
    "camera",
    "siren",
    "script",
    "automation",
    "button",
    "input_button",
    "person",
    "device_tracker",
    "update",
    "shell_command",
    "command_line",
    "homeassistant",
    "persistent_notification",
)

# Covers that open the house to the outside are never allowed
GUEST_DENIED_COVER_CLASSES = ("door", "garage", "gate")

# Limits that always apply, even when the owner leaves them empty
GUEST_REQUIRED_LIMITS: dict = {
    "climate.set_temperature": {"temperature": {"min": 16, "max": 26}},
}
