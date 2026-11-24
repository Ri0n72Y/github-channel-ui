import { useState } from 'react'
import { readmeFields, safeTopicCoverUrl } from './domain.mjs'
import type { TopicSnapshot } from './service'
import styles from './topic-page.module.css'

/** @summary Render plain README text and a validated, configured raster image. */
export default function TopicPageHead({ snapshot }: { snapshot: TopicSnapshot }) {
  const { title, description, email, datetime } = readmeFields(snapshot.readme)
  const [expanded, setExpanded] = useState(false)
  const [failedUrl, setFailedUrl] = useState<string|null>(null)
  const cover = safeTopicCoverUrl(snapshot.config?.cover)
  const showCover = cover !== null && failedUrl !== cover
  const longDescription = description.length > 110 || description.includes('\n')
  return <header className={styles.headCard}>
    {showCover && <img key={cover} className={styles.headImage} src={cover}
      alt="" referrerPolicy="no-referrer" decoding="async"
      onError={() => setFailedUrl(cover)}/>}
    <div className={styles.headCopy}>
      <span className={styles.eyebrow}>TOPIC / {snapshot.config?.topic || '尚未初始化'}</span>
      <h1>{title}</h1>
      {description && <p className={styles.description}
        data-collapsed={longDescription && !expanded}>{description}</p>}
      <div className={styles.headActions}>
        {longDescription && <button type="button" className={styles.readmeToggle}
          aria-expanded={expanded} onClick={() => setExpanded(open => !open)}>
          {expanded ? '收起活动简介' : '展开完整活动简介'}
        </button>}
        <p className={styles.sourceHint}>{snapshot.config ? (snapshot.config.whitelist ? '仅展示符合 Topic 且已登记的公开仓库。' : '展示符合 Topic 的公开仓库。') : '尚未配置 Topic，不查询项目。'}</p>
        <a href={snapshot.repository.html_url} target="_blank" rel="noopener noreferrer">查看官方仓库</a>
      </div>
      {(email || datetime) && <footer className={styles.headMeta}>
        {email && <span>邮箱：{email}</span>}
        {datetime && <span>时间：{datetime}</span>}
      </footer>}
    </div>
  </header>
}
