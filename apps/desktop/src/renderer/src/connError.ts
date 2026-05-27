/**
 * 判定一条错误信息是否为「连接级」错误（连不上 / 认证失败），
 * 用于在查询/展开失败时自动弹出连接编辑框让用户改配置。
 * 排除"驱动未实现/未安装"这类改配置也修不了的错误。
 */
export function isConnectionError(message: string): boolean {
  if (/驱动未实现|驱动未安装|not implemented/i.test(message)) return false
  return /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ECONNRESET|getaddrinfo|Access denied|authentication|password|Connection (lost|terminated|refused)|connect\s|无法连接|拒绝连接/i.test(
    message,
  )
}
