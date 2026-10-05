// 注意：@capacitor/cli 是 CommonJS，不能 import { CapacitorConfig }（named export 不存在），
// 直接导出普通对象即可。
export default {
  appId: 'io.fly1919.yunhu',
  appName: '云湖客户端',
  webDir: 'dist',
  server: {
    // WebView origin 设成云湖白名单域名：图片/资源请求的 Referer 天然通过防盗链
    hostname: 'myapp.jwznb.com',
    allowNavigation: ['*.jwzhd.com', '*.jwznb.com'],
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
    minWebViewVersion: 55,
    permissions: ['android.permission.INTERNET', 'android.permission.RECORD_AUDIO', 'android.permission.CAMERA'],
  },
}
