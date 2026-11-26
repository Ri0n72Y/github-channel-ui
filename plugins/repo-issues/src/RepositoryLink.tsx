import { Link, type LinkProps } from 'react-router'
import { repositoryLinkPath } from './target.mjs'

/** Only ordinary repository links use this adapter. Topic paths have their own namespace. */
export function RepositoryLink({to,children,className,...props}: Omit<LinkProps,'to'> & {to:string}) {
  const path=repositoryLinkPath(to)
  return path ? <Link to={path} className={className} {...props}>{children}</Link> :
    <span className={className} title="此资源与站内保留路径冲突或地址无效">{children}（站内路径不可用）</span>
}
export function UnsupportedRepositoryRoute() {
  return <section role="alert"><h1>资源路径不可用</h1>
    <p>此地址无效或与站内保留路径冲突。请在 GitHub 查看资源，或返回首页输入其他地址。</p>
    <Link to="/">返回首页</Link></section>
}
