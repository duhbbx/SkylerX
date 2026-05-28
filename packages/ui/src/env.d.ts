declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

// Vite worker / 资源导入（ui 不直接依赖 vite，故在此显式声明，由消费方 vite 编译）
declare module '*?worker' {
  const workerConstructor: { new (options?: { name?: string }): Worker }
  export default workerConstructor
}
declare module '*?url' {
  const src: string
  export default src
}
declare module '*?raw' {
  const src: string
  export default src
}
