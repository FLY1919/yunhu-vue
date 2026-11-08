/// <reference types="vite/client" />

/** 构建期注入的版本号（vite define，来源 package.json version） */
declare const __APP_VERSION__: string

/** .vue 单文件组件类型声明 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

/** 运行时注入的全局开关 */
interface Window {
  /** 直连时的 API 基址（默认走同源 /api 代理） */
  YUNHU_BASE?: string
  /** 资源代理前缀（默认 /res） */
  YUNHU_RES?: string
}
