<script setup lang="ts">/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DataClient } from '@db-tool/shared-types'
import { DataClientKey, Workspace } from '@db-tool/ui'
import { provide } from 'vue'

// 桌面端：把 IPC 客户端(window.api) 作为 DataClient 注入，共享 UI 据此访问数据
provide(DataClientKey, window.api as unknown as DataClient)
</script>

<template>
  <Workspace />
</template>
