import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { listenForFrameSafeArea } from './lib/frameSafeArea'

listenForFrameSafeArea()
createApp(App).mount('#app')
