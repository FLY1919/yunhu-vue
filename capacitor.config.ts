// 注意：@capacitor/cli 是 CommonJS，不能 import { CapacitorConfig }（named export 不存在），
// 直接导出普通对象即可。
// ⚠️ 黑屏根因（两个坑，分开看）：
//   1) hostname：设成自定义域名会让 WebView 去解析它 → 已去掉，用默认 localhost
//   2) androidScheme：Capacitor 默认 https，但本地 server 是自签证书 → TLS 失败黑屏，
//      必须显式设 http
export default {
  appId: 'com.richkobe.yhchat',
  appName: 'yhchat kobe',
  webDir: 'dist',
  // WebView 底色与深色主题一致，避免冷启动白/黑闪
  backgroundColor: '#17181f',
  server: {
    androidScheme: 'http',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
}
