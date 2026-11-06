import { computed } from 'vue'
import { normalizeLang, translate } from '@/i18n/messages'

/** Resolve UI language from Home Assistant / browser locale (cs | en). */
export function detectUiLang() {
  try {
    const params = new URLSearchParams(window.location.search)
    const forced = params.get('lang')
    if (forced === 'en' || forced === 'cs') return forced
  } catch {
    /* ignore */
  }

  const candidates = [
    typeof document !== 'undefined' ? document.documentElement.lang : null,
    typeof navigator !== 'undefined' ? navigator.language : null,
    typeof navigator !== 'undefined' ? navigator.languages?.[0] : null,
  ].filter(Boolean)

  for (const raw of candidates) {
    const low = String(raw).toLowerCase()
    if (low.startsWith('en')) return 'en'
    if (low.startsWith('cs') || low.startsWith('sk')) return 'cs'
  }
  return 'cs'
}

export function useI18n() {
  const lang = computed(() => normalizeLang(detectUiLang()))
  const locale = computed(() => (lang.value === 'en' ? 'en-US' : 'cs-CZ'))

  function t(key) {
    return translate(lang.value, key)
  }

  return { lang, locale, t }
}

export default useI18n
