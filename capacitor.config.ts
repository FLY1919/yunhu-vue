// 注意：@capacitor/cli 是 CommonJS，不能 import { CapacitorConfig }（named export 不存在），
// 直接导出普通对象即可。
export default {
  appId: 'io.fly1919.yunhu',
  appName: '云湖客户端',
  webDir: 'dist',
  server: {
    // WebView origin 设成云湖白名单域名：图片/资源请求的 Referer 天然通过防盗链
    hostname: 'myapp.jwznb.com',
    // ⚠️ 关键：Capacitor 默认用 https 加载自定义 hostname，本地 server 是自签证书
    //   会导致 TLS 失败 → 整个 WebView 加载不出来 → 黑屏。必须显式改 http。
    androidScheme: 'http',
    allowNavigation: ['*.jwzhd.com', '*.jwznb.com'],
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
    minWebViewVersion: 55,
    permissions: ['android.permission.INTERNET', 'android.permission.RECORD_AUDIO', 'android.permission.CAMERA'],
  },
}
