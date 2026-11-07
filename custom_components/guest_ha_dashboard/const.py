"""Constants for dash (Guest HA Dashboard integration)."""

DOMAIN = "guest_ha_dashboard"
VERSION = "2.1.0-beta.1"
STORAGE_KEY = f"{DOMAIN}.config"
STORAGE_VERSION = 1
# Version of the dashboard config inside the store (see config_schema.py).
# 1 = everything stored before 2.1, 2 = configVersion + tile registry validation.
CONFIG_VERSION = 2

PANEL_ICON = "mdi:tablet-dashboard"
PANEL_TITLE = "dash"
PANEL_URL_PATH = "guest-dashboard"
PANEL_COMPONENT = "guest-ha-dashboard-panel"

DOCK_MAX = 6

# Standby photo frame: images live next to the HA config, never in the PWA host.
PHOTOS_DIR = "dash_photos"
PHOTOS_MAX = 60
PHOTO_MAX_BYTES = 3 * 1024 * 1024

DEFAULT_GENERAL: dict = {
    "showTopBar": True,
    "showWelcome": True,
    # "" = first weather.* entity, else Open-Meteo for the HA home location
    "weatherEntity": "",
    "showTime": True,
    "use24h": True,
    "showDate": True,
    "showWifi": True,
    "showTemperature": True,
    "showHumidity": True,
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
    # Top status bar of the dashboard
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
}


# ─── Guest passes ────────────────────────────────────────────────────────────
# Design and threat model: docs/GUEST_PASSES.md. Everything below is plain data
# so the policy modules stay free of Home Assistant imports and easy to test.

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

HVAC_MODES = ("off", "heat", "cool", "heat_cool", "auto", "dry", "fan_only")

# domain -> service -> {field: spec}. Anything not listed is denied.
GUEST_SERVICES: dict = {
    "light": {
        "turn_on": {
            # `brightness` (0-255) is left out on purpose: with both it and
            # brightness_pct allowed, a guest could bypass a brightness_pct limit.
            "brightness_pct": {"type": _NUM, "min": 0, "max": 100},
            "color_temp_kelvin": {"type": _INT, "min": 1000, "max": 12000},
            "rgb_color": {"type": _RGB, "min": 0, "max": 255},
            "transition": {"type": _NUM, "min": 0, "max": 60},
        },
        "turn_off": {"transition": {"type": _NUM, "min": 0, "max": 60}},
        "toggle": {},
    },
    "switch": {"turn_on": {}, "turn_off": {}, "toggle": {}},
    "input_boolean": {"turn_on": {}, "turn_off": {}, "toggle": {}},
    "fan": {
        "turn_on": {},
        "turn_off": {},
        "set_percentage": {"percentage": {"type": _INT, "min": 0, "max": 100}},
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
    "media_player": {
        "media_play": {},
        "media_pause": {},
        "media_play_pause": {},
        "media_next_track": {},
        "media_previous_track": {},
        "volume_set": {"volume_level": {"type": _NUM, "min": 0, "max": 1}},
        "volume_up": {},
        "volume_down": {},
        "turn_on": {},
        "turn_off": {},
        "select_source": {"source": {"type": _STR, "max_len": 100}},
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
