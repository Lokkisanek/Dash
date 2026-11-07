import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { applySafeAreaOverride, listenForFrameSafeArea } from './lib/frameSafeArea'

// ?safe=top,bottom simulates iOS insets in dev and demo builds (screenshots, tests).
if (import.meta.env.DEV || import.meta.env.VITE_MODE === 'mock') applySafeAreaOverride()
listenForFrameSafeArea()
createApp(App).mount('#app')
