// 注意：@capacitor/cli 是 CommonJS，不能 import { CapacitorConfig }（named export 不存在），
// 直接导出普通对象即可。
// ⚠️ 黑屏根因（两个坑，分开看）：
//   1) hostname：设成自定义域名会让 WebView 去解析它 → 已去掉，用默认 localhost
//   2) androidScheme：Capacitor 默认 https，但本地 server 是自签证书 → TLS 失败黑屏，
//      必须显式设 http
export default {
  appId: 'io.fly1919.yunhu',
  appName: '云湖客户端',
  webDir: 'dist',
  server: {
    androidScheme: 'http',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
}
