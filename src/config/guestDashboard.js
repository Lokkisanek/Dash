/**
 * AI-FRIENDLY CENTRAL CONFIG
 * ─────────────────────────────────────────────────────────────
 * Edit pages / lights here. Entity IDs must match
 * Home Assistant (Zigbee2MQTT naming conventions work great).
 *
 * Device types: light | switch | cover | climate | media_player
 * ─────────────────────────────────────────────────────────────
 */

export const guestDashboard = {
  guestInfo: {
    wifiSsid: 'Guest-Home',
    wifiPassword: 'vitejte2024',
    wifiSecurity: 'WPA',
  },

  /** Top status bar */
  general: {
    showTime: true,
    use24h: true,
    showDate: true,
    showWifi: true,
    showTemperature: true,
    showHumidity: true,
  },

  appearance: {
    mode: 'light', // light | dark
    accent: '#ff6b00',
  },

  /** Bottom dock — max 4 page shortcuts. Empty = first 4 pages. */
  dock: [],

  pages: [
    {
      id: 'obyvak',
      label: 'Obývák',
      icon: 'Sofa',
      temperatureEntity: 'sensor.obyvak_teplota',
      humidityEntity: 'sensor.obyvak_vlhkost',
      devices: [
        {
          id: 'light.obyvak_strop',
          type: 'light',
          label: 'Strop',
          supportsBrightness: true,
          supportsColorTemp: true,
        },
        {
          id: 'light.obyvak_lampa',
          type: 'light',
          label: 'Stojací lampa',
          supportsBrightness: true,
          supportsColorTemp: true,
        },
        {
          id: 'light.obyvak_led_pas',
          type: 'light',
          label: 'LED pás',
          supportsBrightness: true,
          supportsColorTemp: false,
        },
        {
          id: 'switch.obyvak_tv',
          type: 'switch',
          label: 'TV zásuvka',
          icon: 'Tv',
        },
        {
          id: 'cover.obyvak_zaluzie',
          type: 'cover',
          label: 'Žaluzie',
        },
        {
          id: 'climate.obyvak',
          type: 'climate',
          label: 'Topení',
        },
      ],
    },
    {
      id: 'loznice',
      label: 'Ložnice',
      icon: 'BedDouble',
      temperatureEntity: 'sensor.loznice_teplota',
      humidityEntity: 'sensor.loznice_vlhkost',
      devices: [
        {
          id: 'light.loznice_strop',
          type: 'light',
          label: 'Strop',
          supportsBrightness: true,
          supportsColorTemp: true,
        },
        {
          id: 'light.loznice_nocni_leva',
          type: 'light',
          label: 'Noční L',
          supportsBrightness: true,
          supportsColorTemp: true,
        },
        {
          id: 'light.loznice_nocni_prava',
          type: 'light',
          label: 'Noční P',
          supportsBrightness: true,
          supportsColorTemp: true,
        },
        {
          id: 'cover.loznice_roleta',
          type: 'cover',
          label: 'Roleta',
        },
        {
          id: 'climate.loznice',
          type: 'climate',
          label: 'Topení',
        },
      ],
    },
    {
      id: 'koupelna',
      label: 'Koupelna',
      icon: 'Bath',
      temperatureEntity: 'sensor.koupelna_teplota',
      humidityEntity: 'sensor.koupelna_vlhkost',
      devices: [
        {
          id: 'light.koupelna_strop',
          type: 'light',
          label: 'Strop',
          supportsBrightness: true,
          supportsColorTemp: true,
        },
        {
          id: 'light.koupelna_zrcadlo',
          type: 'light',
          label: 'Zrcadlo',
          supportsBrightness: true,
          supportsColorTemp: false,
        },
        {
          id: 'switch.koupelna_ventilator',
          type: 'switch',
          label: 'Ventilátor',
          icon: 'Fan',
        },
        {
          id: 'switch.koupelna_boiler',
          type: 'switch',
          label: 'Bojler',
          icon: 'Flame',
        },
      ],
    },
    {
      id: 'chodba',
      label: 'Chodba',
      icon: 'DoorOpen',
      temperatureEntity: 'sensor.chodba_teplota',
      humidityEntity: 'sensor.chodba_vlhkost',
      devices: [
        {
          id: 'light.chodba_strop',
          type: 'light',
          label: 'Strop',
          supportsBrightness: true,
          supportsColorTemp: true,
        },
        {
          id: 'light.chodba_vstup',
          type: 'light',
          label: 'Vstup',
          supportsBrightness: true,
          supportsColorTemp: false,
        },
        {
          id: 'switch.kava',
          type: 'switch',
          label: 'Kávovar',
          icon: 'Coffee',
        },
      ],
    },
  ],
}

export default guestDashboard
