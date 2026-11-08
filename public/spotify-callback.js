// Spotify redirect target (docs/PLAYER_ENGINES.md). Hands code + state to the
// panel that opened this window; if it is gone, shows them to paste by hand.
;(function () {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code') || ''
  const state = params.get('state') || ''
  const error = params.get('error') || ''
  // drop the code from the address bar and history
  window.history.replaceState(null, '', window.location.pathname)
  const msg = document.getElementById('msg')
  const title = document.getElementById('title')
  if (error || !code || !state) {
    title.textContent = 'Spotify se nepřipojil'
    msg.textContent = error === 'access_denied' ? 'Přístup byl zamítnut. Zkus to v panelu znovu.' : 'Spotify nevrátil kód. Zkus to v panelu znovu.'
    return
  }
  const pair = `${state}:${code}`
  let sent = false
  try {
    if (window.opener && !window.opener.closed) {
      // the code is useless without the verifier held by Home Assistant
      window.opener.postMessage({ type: 'dash-spotify-callback', code, state }, '*')
      sent = true
    }
  } catch {
    sent = false
  }
  if (sent) {
    msg.textContent = 'Hotovo. Okno se zavře.'
    setTimeout(() => window.close(), 600)
    return
  }
  title.textContent = 'Vlož kód do panelu'
  msg.textContent = 'Okno se nemohlo vrátit do Home Assistantu. Zkopíruj kód a vlož ho v panelu do pole „Vložit kód“.'
  const box = document.getElementById('code')
  box.textContent = pair
  box.hidden = false
  const copy = document.getElementById('copy')
  copy.hidden = false
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pair)
      copy.textContent = 'Zkopírováno'
    } catch {
      copy.textContent = 'Označ kód a zkopíruj ho'
    }
  })
})()
