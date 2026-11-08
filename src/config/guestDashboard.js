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
  configVersion: 3,

  guestInfo: {
    wifiSsid: 'Guest-Home',
    wifiPassword: '',
    wifiSecurity: 'WPA',
  },

  /** The header (clock, greeting, weather, Wi-Fi) is a tile since config version 3. */
  general: {
    use24h: true,
    /** Installed iPhone app: dark strip behind the white status bar (off = wallpaper runs under it) */
    statusBarStrip: false,
    /** auto = pages side by side on wide screens, single = one column */
    layoutMode: 'auto',
    /** auto = right on a phone in landscape, bottom elsewhere */
    dockPosition: 'auto',
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
          id: 'header-demo',
          type: 'header',
          style: 'card',
          size: '4x2',
          showTime: true,
          showDate: true,
          showGreeting: true,
          showWeather: true,
          showTemperature: true,
          showHumidity: true,
          showWifi: true,
          entity: '',
          contrast: 'auto',
        },
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
        {
          // dash light group: one tile, one call for all three lights
          id: 'light_group-5a6b7c8d',
          type: 'light_group',
          label: 'Všechna světla',
          icon: 'LampCeiling',
          style: 'slider',
          size: '4x1',
          entities: ['light.loznice_strop', 'light.loznice_nocni_leva', 'light.loznice_nocni_prava'],
        },
        {
          id: 'fan.loznice',
          type: 'fan',
          label: 'Ventilátor',
          style: 'slider',
          size: '2x1',
        },
        {
          id: 'fan.loznice',
          type: 'fan',
          label: 'Ventilátor',
          style: 'toggle',
          size: '1x1',
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
          supportsBrightness: false,
          supportsColorTemp: false,
        },
        {
          // Home Assistant light group (domain light, members in attributes.entity_id)
          id: 'light.chodba_skupina',
          type: 'light',
          label: 'Chodba vše',
          style: 'button',
          size: '2x1',
        },
        {
          id: 'switch.kava',
          type: 'switch',
          label: 'Kávovar',
          icon: 'Coffee',
        },
      ],
    },
    {
      id: 'prehled',
      label: 'Přehled',
      icon: 'Activity',
      devices: [
        { id: 'scene.vecer', type: 'scene', label: 'Večer', icon: 'Moon', style: 'row', size: '4x1' },
        { id: 'scene.kino', type: 'scene', label: 'Kino', icon: 'Clapperboard', style: 'button', size: '1x1' },
        { id: 'sensor.obyvak_teplota', type: 'sensor', label: 'Obývák', style: 'value', size: '1x1' },
        { id: 'sensor.obyvak_vlhkost', type: 'sensor', label: 'Vlhkost', style: 'row', size: '2x1' },
        { id: 'binary_sensor.vchodove_dvere', type: 'binary_sensor', label: 'Vchodové dveře', style: 'row', size: '2x1' },
        { id: 'binary_sensor.chodba_pohyb', type: 'binary_sensor', label: 'Pohyb', style: 'status', size: '1x1' },
        { id: 'sensor.pracka', type: 'sensor', label: 'Pračka', style: 'row', size: '2x1' },
        { id: 'sun.sun', type: 'entity', label: 'Slunce', icon: 'Sun', style: 'row', size: '4x1' },
        { id: 'sun.sun', type: 'entity', label: 'Výška', icon: 'Sunrise', attribute: 'elevation', style: 'value', size: '1x1' },
        { id: 'divider-7e8f9a0b', type: 'divider', label: 'Hudba', style: 'line', size: '4x1' },
        {
          id: 'media_player.obyvak',
          type: 'media_player',
          label: 'Obývák',
          style: 'vinyl',
          size: '4x3',
          outputs: ['media_player.kuchyn'],
        },
        { id: 'media_player.kuchyn', type: 'media_player', label: 'Kuchyň', style: 'nowplaying', size: '4x3' },
        { id: 'media_player.obyvak', type: 'media_player', label: 'Obývák', style: 'vinyl', size: '2x2' },
        // dash's own player: radio in this browser (demo: a silent test tone)
        { id: 'player-radio', type: 'player', label: 'Rádio', style: 'vinyl', size: '2x2', source: 'browser' },
        { id: 'divider-videoteka', type: 'divider', label: 'Videotéka', style: 'line', size: '4x1' },
        { id: 'library-trending', type: 'library', label: 'Videotéka', style: 'trending', size: '4x2' },
        { id: 'library-activity', type: 'library', label: 'Stahování', style: 'activity', size: '4x2' },
      ],
    },
  ],
}

export default guestDashboard
