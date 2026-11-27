import { useState } from 'react'
import type { TopicRepository } from './service'
import styles from './topic-page.module.css'

/** @summary Preserve one real repository link and show an explicit fallback when imagery is unavailable. */
export default function TopicProjectCard({ project }: { project: TopicRepository }) {
  const [failedCover, setFailedCover] = useState<string|null>(null)
  const [loadedCover, setLoadedCover] = useState<string|null>(null)
  const [failedAvatar, setFailedAvatar] = useState<string|null>(null)
  const owner = project.owner || 'GitHub'
  const cover = project.cover_url
  const avatar = project.owner_avatar_url
  const hasCover = Boolean(cover && failedCover !== cover)
  return <article className={styles.projectCard}>
    <a className={styles.projectLink} href={project.html_url} target="_blank"
      rel="noopener noreferrer" aria-label={project.full_name + ' — ' +
        (project.description || '暂无项目简介') +
        (hasCover ? '' : ' — 暂无可用项目封面') + ' — 打开 GitHub'}>
      {hasCover ? <div className={styles.projectCover}
        data-cover-state={loadedCover===cover?'image':'loading'}>
        <img key={cover} src={cover} alt={project.full_name + ' 项目封面'}
          loading="lazy" decoding="async" referrerPolicy="no-referrer"
          onLoad={() => setLoadedCover(cover ?? null)}
          onError={() => setFailedCover(cover ?? null)}/>
      </div> : <div className={styles.coverFallback}>暂无可用项目封面</div>}
      <div className={styles.projectContent}>
        <div className={styles.projectTitle}>
          <div className={styles.projectSummary}>
            <h3 title={project.name}>{project.name}</h3>
            <p className={styles.projectDescription} title={project.description || undefined}>
              {project.description || '暂无项目简介'}
            </p>
          </div>
        </div>
        <div className={styles.projectIdentity}>
          <span className={styles.ownerAvatar}>
            {avatar && failedAvatar!==avatar
              ? <img key={avatar} src={avatar} alt={owner + ' 的 GitHub 头像'}
                loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedAvatar(avatar)}/>
              : owner.slice(0,1).toUpperCase()}
          </span>
          <span className={styles.repositoryName} title={project.full_name}>{project.full_name}</span>
        </div>
        <p className={styles.cardMeta}><span>{project.language || 'GitHub 项目'}</span>
          <span>★ {project.stargazers_count}</span></p>
      </div>
    </a>
  </article>
}
