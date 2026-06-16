/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest'
import { type IgnoreMatcher, parseGitignore, shouldIndexFile } from './codeScan'

describe('parseGitignore + IgnoreMatcher', () => {
  it('matches plain names and globs, ignores comments/blanks', () => {
    const m: IgnoreMatcher = parseGitignore('# comment\n\nnode_modules\n*.log\nbuild/\n')
    expect(m.ignores('node_modules')).toBe(true)
    expect(m.ignores('src/node_modules')).toBe(true)
    expect(m.ignores('app.log')).toBe(true)
    expect(m.ignores('build')).toBe(true)
    expect(m.ignores('src/app.ts')).toBe(false)
  })
})

describe('shouldIndexFile', () => {
  const ig = parseGitignore('')
  it('includes allowlisted source/sql/doc extensions', () => {
    expect(shouldIndexFile('src/User.java', 1000, ig)).toBe(true)
    expect(shouldIndexFile('db/migrate/001.sql', 1000, ig)).toBe(true)
    expect(shouldIndexFile('README.md', 1000, ig)).toBe(true)
  })
  it('excludes non-allowlisted, minified, and oversized files', () => {
    expect(shouldIndexFile('logo.png', 1000, ig)).toBe(false)
    expect(shouldIndexFile('app.min.js', 1000, ig)).toBe(false)
    expect(shouldIndexFile('big.ts', 300_000, ig)).toBe(false) // > 256 KB cap
  })
  it('excludes always-ignored dirs and gitignored paths', () => {
    expect(shouldIndexFile('node_modules/x/index.js', 10, ig)).toBe(false)
    expect(shouldIndexFile('dist/bundle.js', 10, ig)).toBe(false)
    const ig2 = parseGitignore('secret.sql\n')
    expect(shouldIndexFile('secret.sql', 10, ig2)).toBe(false)
  })
})
