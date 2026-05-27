<script setup lang="ts">
import type { DataClient } from '@db-tool/shared-types'
import { DataClientKey, Workspace } from '@db-tool/ui'
import { provide } from 'vue'

// 桌面端：把 IPC 客户端(window.api) 作为 DataClient 注入，共享 UI 据此访问数据
provide(DataClientKey, window.api as unknown as DataClient)
</script>

<template>
  <Workspace />
</template>
