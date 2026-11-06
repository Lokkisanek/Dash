import { computed } from 'vue'
import { useGuestConfig } from './useGuestConfig'
import { normalizeLang, translate } from '@/i18n/messages'

export function useI18n() {
  const { appearance } = useGuestConfig()

  const lang = computed(() => normalizeLang(appearance.value?.language))
  const locale = computed(() => (lang.value === 'en' ? 'en-US' : 'cs-CZ'))

  function t(key) {
    return translate(lang.value, key)
  }

  return { lang, locale, t }
}

export default useI18n
