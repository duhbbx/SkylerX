/*
 * Copyright 2026 武汉斯凯勒网络科技有限公司 (Wuhan Skyler Network Technology Co., Ltd.)
 * SPDX-License-Identifier: Apache-2.0
 */

type SelectFile = (req?: {
  filters?: { name: string; extensions: string[] }[]
  allowCreate?: boolean
  defaultPath?: string
  directory?: boolean
  showHidden?: boolean
}) => Promise<string | null>

type ReadText = (path: string) => Promise<string>

export type ConnectionSecretFileKind =
  | 'dbPassword'
  | 'sshPrivateKey'
  | 'sslCertificate'
  | 'sslPrivateKey'

export interface ConnectionSecretFileClient {
  selectFile?: SelectFile
  readText?: ReadText
}

const FILE_FILTERS: Record<ConnectionSecretFileKind, { name: string; extensions: string[] }[]> = {
  dbPassword: [
    { name: 'All files', extensions: ['*'] },
    { name: 'Password text', extensions: ['txt', 'password', 'pwd', 'env', 'conf'] },
  ],
  sshPrivateKey: [
    { name: 'All files', extensions: ['*'] },
    { name: 'SSH private key', extensions: ['pem', 'key', 'p8', 'ppk', 'txt'] },
  ],
  sslCertificate: [
    { name: 'All files', extensions: ['*'] },
    { name: 'Certificate / PEM', extensions: ['pem', 'crt', 'cer', 'cert', 'txt'] },
  ],
  sslPrivateKey: [
    { name: 'All files', extensions: ['*'] },
    { name: 'Private key / PEM', extensions: ['pem', 'key', 'p8', 'txt'] },
  ],
}

export async function readConnectionSecretFile(
  files: ConnectionSecretFileClient,
  kind: ConnectionSecretFileKind,
): Promise<string | null> {
  if (!files.selectFile || !files.readText) {
    throw new Error('当前环境不支持读取本地文件')
  }
  const path = await files.selectFile({ filters: FILE_FILTERS[kind], showHidden: true })
  if (!path) return null
  const content = await files.readText(path)
  return kind === 'dbPassword' ? content.replace(/(?:\r?\n)+$/, '') : content
}
