#!/usr/bin/env node
/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
// 把 git tag 解析出来的 semver 写回 apps/desktop/package.json 的 version 字段。
// CI 在 build/package 前调用，确保产物文件名（${productName}-${version}-…）跟 tag 对齐。
// 非 tag push（或本地手工 run）下 GITHUB_REF 不是 refs/tags/v*，直接 noop。
//
// 仅依赖 node 内置模块（node:fs / node:path / node:url），无外部依赖。

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// scripts/ 在仓库根下，package.json 在 apps/desktop/ 下
const PKG_PATH = resolve(__dirname, '..', 'apps', 'desktop', 'package.json');

const ref = process.env.GITHUB_REF ?? '';
const TAG_PREFIX = 'refs/tags/';

if (!ref.startsWith(TAG_PREFIX)) {
  console.log(`[sync-version] GITHUB_REF=${ref || '(unset)'} not a tag push, skip.`);
  process.exit(0);
}

const tag = ref.slice(TAG_PREFIX.length);
// 接受 v1.2.3 / v1.2.3-beta.1 / 1.2.3 等；剥掉前导 v
const raw = tag.startsWith('v') ? tag.slice(1) : tag;

// semver 宽松匹配：MAJOR.MINOR.PATCH(-prerelease)?(+build)?
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
if (!SEMVER_RE.test(raw)) {
  console.error(`[sync-version] tag "${tag}" is not a valid semver, abort.`);
  process.exit(1);
}

const pkgText = readFileSync(PKG_PATH, 'utf8');
const pkg = JSON.parse(pkgText);
const prev = pkg.version;

if (prev === raw) {
  console.log(`[sync-version] version already ${raw}, no change.`);
  process.exit(0);
}

pkg.version = raw;

// 保留原文件尾换行（npm/pnpm 写出的 package.json 通常以 \n 结尾）
const trailingNewline = pkgText.endsWith('\n') ? '\n' : '';
writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}${trailingNewline}`);

console.log(`[sync-version] ${PKG_PATH}: version ${prev} -> ${raw}`);
