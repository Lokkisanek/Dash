/**
 * AI-FRIENDLY CENTRAL CONFIG
 * ─────────────────────────────────────────────────────────────
 * Edit pages / lights here. Entity IDs must match
 * Home Assistant (Zigbee2MQTT naming conventions work great).
 *
 * Device types: light | switch | cover | climate | media_player
 * Grid: 4 square columns; `style` + `size` ("<cols>x<rows>") per device,
 * see shared/tiles.json for the allowed combinations.
 * ─────────────────────────────────────────────────────────────
 */

export const guestDashboard = {
  configVersion: 2,

  guestInfo: {
    wifiSsid: 'Guest-Home',
    wifiPassword: '',
    wifiSecurity: 'WPA',
  },

  general: {
    /** Whole top status bar */
    showTopBar: true,
    /** "Good evening, <HA user>" + outside weather */
    showWelcome: true,
    /** '' = first weather.* entity, else Open-Meteo at the HA home location */
    weatherEntity: '',
    showTime: true,
    use24h: true,
    showDate: true,
    showWifi: true,
    showTemperature: true,
    showHumidity: true,
  },

  /** Idle screen: big clock or a cross-fading photo frame */
  standby: {
    enabled: false,
    idleMinutes: 2,
    mode: 'clock', // clock | photos
    clockStyle: 'bold', // bold | minimal
    photoSeconds: 8,
  },

  appearance: {
    mode: 'light', // light | dark
    accent: '#ff6b00',
  },

  /** Bottom dock — max 6 page shortcuts. Empty = first 6 pages. */
  dock: [],

  pages: [
    {
      id: 'obyvak',
      label: 'Obývák',
      icon: 'Sofa',
      devices: [
        {
          id: 'light.obyvak_strop',
          type: 'light',
          label: 'Strop',
          style: 'slider',
          size: '4x1',
          supportsBrightness: true,
        },
        {
          id: 'light.obyvak_lampa',
          type: 'light',
          label: 'Lampa',
          icon: 'LampFloor',
          style: 'vertical',
          size: '1x2',
          supportsBrightness: true,
        },
        {
          id: 'light.obyvak_led_pas',
          type: 'light',
          label: 'LED pás',
          icon: 'Sparkles',
          style: 'button',
          size: '1x1',
        },
        {
          id: 'cover.obyvak_zaluzie',
          type: 'cover',
          label: 'Žaluzie',
          style: 'vertical',
          size: '1x2',
        },
        {
          id: 'switch.kava',
          type: 'switch',
          label: 'Kávovar',
          icon: 'Coffee',
          style: 'button',
          size: '1x1',
        },
        {
          id: 'divider-0b1c2d3e',
          type: 'divider',
          label: 'Hudba a teplo',
          style: 'line',
          size: '4x1',
        },
        {
          id: 'media_player.obyvak',
          type: 'media_player',
          label: 'Reproduktor',
          style: 'tile',
          size: '4x2',
        },
        {
          id: 'climate.obyvak',
          type: 'climate',
          label: 'Topení',
          style: 'dial',
          size: '4x3',
        },
        {
          id: 'switch.obyvak_tv',
          type: 'switch',
          label: 'TV',
          icon: 'Tv',
          style: 'row',
          size: '4x1',
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
