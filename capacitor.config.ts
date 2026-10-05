import { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'io.fly1919.yunhu',
  appName: '云湖客户端',
  webDir: 'dist',
  server: {
    allowNavigation: ['*.jwzhd.com', '*.jwznb.com'],
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
    minWebViewVersion: 55,
    permissions: ['android.permission.INTERNET', 'android.permission.RECORD_AUDIO', 'android.permission.CAMERA'],
  },
}

export default config