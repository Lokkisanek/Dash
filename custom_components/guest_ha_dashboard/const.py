"""Constants for dash (Guest HA Dashboard integration)."""

DOMAIN = "guest_ha_dashboard"
VERSION = "2.0.0"
STORAGE_KEY = f"{DOMAIN}.config"
STORAGE_VERSION = 1

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
