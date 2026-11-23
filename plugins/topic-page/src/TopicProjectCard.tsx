import { useState } from 'react'
import type { TopicRepository } from './service'
import styles from './topic-page.module.css'

/** @summary Show only GitHub-provided project imagery and a truthful no-cover fallback. */
export default function TopicProjectCard({ project }: { project: TopicRepository }) {
  const [coverFailed, setCoverFailed] = useState(false)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const owner = project.owner || 'GitHub'
  const avatarInitial = owner.slice(0, 1).toUpperCase()

  return <article className={styles.projectCard}>
    <div className={styles.projectCover}
      data-cover-state={project.cover_url && !coverFailed ? 'image' : 'missing'}>
      {project.cover_url && !coverFailed
        ? <img src={project.cover_url} alt={project.full_name + ' 项目封面'}
          loading="lazy" onError={() => setCoverFailed(true)}/>
        : <span>暂无可用项目封面</span>}
    </div>
    <div className={styles.projectContent}>
      <div className={styles.projectIdentity}>
        <span className={styles.ownerAvatar}>
          {project.owner_avatar_url && !avatarFailed
            ? <img src={project.owner_avatar_url} alt={owner + ' 的 GitHub 头像'}
              loading="lazy" onError={() => setAvatarFailed(true)}/>
            : avatarInitial}
        </span>
        <div>
          <p className={styles.cardMeta}>{project.full_name}</p>
          <h3>{project.name}</h3>
        </div>
      </div>
      <p className={styles.projectDescription} title={project.description || undefined}>
        {project.description || '暂无项目简介'}
      </p>
      <p className={styles.cardMeta}>{project.language || 'GitHub 项目'}
        <span>★ {project.stargazers_count}</span></p>
      <a href={project.html_url} target="_blank" rel="noopener noreferrer">打开 GitHub</a>
    </div>
  </article>
}
