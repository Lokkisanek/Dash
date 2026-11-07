"""Fixtures for tests that run inside Home Assistant (pytest-homeassistant-custom-component).

These need a POSIX system (Home Assistant imports fcntl); CI runs them on Linux.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from pytest_homeassistant_custom_component.common import MockConfigEntry

from homeassistant.core import HomeAssistant

DOMAIN = "guest_ha_dashboard"


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations: None) -> None:
    """Load custom_components/ from this repository."""


@pytest.fixture
async def setup_integration(hass: HomeAssistant) -> MockConfigEntry:
    """Set up dash; the sidebar panel needs the frontend, so it is mocked."""
    entry = MockConfigEntry(domain=DOMAIN, unique_id=DOMAIN, title="dash")
    entry.add_to_hass(hass)
    with patch(
        "custom_components.guest_ha_dashboard.panel_custom.async_register_panel",
        AsyncMock(),
    ):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
    return entry


@pytest.fixture
def runtime(hass: HomeAssistant, setup_integration: MockConfigEntry) -> Any:
    """The guest runtime of the loaded integration."""
    return hass.data[DOMAIN]["guests"]
