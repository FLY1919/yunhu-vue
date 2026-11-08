import './fixture'
import { createApp } from 'vue'
import Toasts from '../../src/components/Toasts.vue'
const app = createApp(Toasts).provide('ctx', (window as any).__qa.ctx)
app.mount('#notification-app')
window.addEventListener('beforeunload', () => app.unmount())
