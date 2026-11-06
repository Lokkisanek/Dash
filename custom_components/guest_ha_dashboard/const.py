"""Constants for Guest HA Dashboard."""

DOMAIN = "guest_ha_dashboard"
VERSION = "1.3.1"
STORAGE_KEY = f"{DOMAIN}.config"
STORAGE_VERSION = 1

PANEL_ICON = "mdi:tablet-dashboard"
PANEL_TITLE = "Guest Dashboard"
PANEL_URL_PATH = "guest-dashboard"
PANEL_COMPONENT = "guest-ha-dashboard-panel"

DEFAULT_CONFIG: dict = {
    "guestInfo": {
        "welcomeTitle": "Vítejte u nás",
        "welcomeSubtitle": "Ovládejte dům jako doma",
        "wifiSsid": "Guest-Home",
        "wifiPassword": "",
        "wifiSecurity": "WPA",
    },
    # Dashboard pages (ex-rooms): cards with entities, shown via Dock
    "pages": [],
    # Bottom dock — max 4 page shortcuts (label optional)
    "dock": [],
    "dashboardUrl": "",
    "appearance": {
        "mode": "light",  # light | dark
        "accent": "#ff6b00",
    },
}
