// 注意：@capacitor/cli 是 CommonJS，不能 import { CapacitorConfig }（named export 不存在），
// 直接导出普通对象即可。
// ⚠️ 之前加 server.hostname 想借 WebView origin 过图片防盗链，结果导致黑屏（hostname hack 太脆）。
// 回归最简配置：默认 localhost，保证能加载；API 走 CapacitorHttp 原生层直连云湖。
export default {
  appId: 'io.fly1919.yunhu',
  appName: '云湖客户端',
  webDir: 'dist',
  server: {
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
}
