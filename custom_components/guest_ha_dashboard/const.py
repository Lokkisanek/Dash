"""Constants for Guest HA Dashboard."""

DOMAIN = "guest_ha_dashboard"
VERSION = "1.4.0"
STORAGE_KEY = f"{DOMAIN}.config"
STORAGE_VERSION = 1

PANEL_ICON = "mdi:tablet-dashboard"
PANEL_TITLE = "Guest Dashboard"
PANEL_URL_PATH = "guest-dashboard"
PANEL_COMPONENT = "guest-ha-dashboard-panel"

PAGES_MAX = 4

DEFAULT_GENERAL: dict = {
    "showTime": True,
    "use24h": True,
    "showDate": True,
    "showWifi": True,
    "showTemperature": True,
    "showHumidity": True,
}

DEFAULT_CONFIG: dict = {
    "guestInfo": {
        "wifiSsid": "Guest-Home",
        "wifiPassword": "",
        "wifiSecurity": "WPA",
    },
    # Top status bar of the guest dashboard
    "general": dict(DEFAULT_GENERAL),
    # Dashboard pages (ex-rooms): cards with entities, shown via Dock (max 4)
    "pages": [],
    # Bottom dock — max 4 page shortcuts (label optional)
    "dock": [],
    "dashboardUrl": "",
    "appearance": {
        "mode": "light",  # light | dark
        "accent": "#ff6b00",
    },
}
