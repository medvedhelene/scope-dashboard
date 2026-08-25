import { createApp } from 'vue'
import App from './App.vue'
import Onboarding from './Onboarding.vue'
import './styles.css'

const isOnboardingPage = window.location.pathname.endsWith('/onboarding.html')
const rootComponent = isOnboardingPage ? Onboarding : App

document.title = isOnboardingPage
  ? 'Scope360 — Onboarding'
  : 'Scope360 — живой userflow'

createApp(rootComponent).mount('#app')
