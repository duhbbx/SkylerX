import { defineConfig } from 'vitest/config'

// 单元测试聚焦纯逻辑（SQL 生成、执行计划解析等），不依赖真实数据库 / 浏览器。
// 工作区包通过 exports 指向 TS 源码，vitest(esbuild) 直接编译，无需预先构建。
export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts'],
    environment: 'node',
  },
})
