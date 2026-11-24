import { useLayoutEffect, useRef, useState } from 'react'
import { layoutMasonry, masonryColumns } from './masonry.mjs'
import type { MasonryPlacement } from './masonry.mjs'
import TopicProjectCard from './TopicProjectCard'
import type { TopicRepository } from './service'
import styles from './topic-page.module.css'

/** @summary Both Topic routes share measured, shortest-column Masonry while keeping source order in the DOM. */
export default function TopicMasonry({ projects }: { projects: readonly TopicRepository[] }) {
  const root = useRef<HTMLDivElement | null>(null)
  const previous = useRef<MasonryPlacement | null>(null)
  const [placement, setPlacement] = useState<MasonryPlacement | null>(null)
  const keys = projects.map(project => String(project.id || project.full_name.toLowerCase()))
  const signature = JSON.stringify(keys)
  const ready = placement?.keys.length === keys.length &&
    placement.keys.every((key, index) => key === keys[index])

  useLayoutEffect(() => {
    const node = root.current
    if (!node || keys.length === 0) {
      previous.current = null
      setPlacement(null)
      return
    }
    let frame = 0
    let disposed = false
    const measure = () => {
      if (disposed) return
      const width = node.getBoundingClientRect().width
      if (!Number.isFinite(width) || width <= 0) return
      const columns = masonryColumns(width)
      const cardWidth = Math.max(1, (width - 13 * (columns - 1)) / columns)
      const cards = Array.from(node.querySelectorAll<HTMLElement>('[data-topic-masonry-item]'))
      if (cards.length !== keys.length) return
      // Apply the final column width before measuring wrapped text and natural cover heights.
      for (const card of cards) {
        const targetWidth = `${cardWidth}px`
        if (card.style.width !== targetWidth) card.style.width = targetWidth
      }
      const heights = cards.map(card => card.getBoundingClientRect().height)
      if (heights.some(height => !Number.isFinite(height) || height <= 0)) return
      const next = layoutMasonry({ keys, heights, width, previous: previous.current })
      previous.current = next
      setPlacement(old => old && old.columns === next.columns &&
        old.keys.length === next.keys.length && old.height === next.height &&
        old.keys.every((key, i) => key === next.keys[i]) &&
        old.positions.every((position, i) =>
          position.left === next.positions[i].left &&
          position.top === next.positions[i].top &&
          position.width === next.positions[i].width) ? old : next)
    }
    const schedule = () => {
      if (disposed || frame) return
      if (typeof window.requestAnimationFrame === 'function') {
        frame = window.requestAnimationFrame(() => { frame = 0; measure() })
      } else measure()
    }
    // A synchronous first measure avoids flashing a row-aligned substitute.
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null :
      new ResizeObserver(schedule)
    observer?.observe(node)
    node.querySelectorAll('[data-topic-masonry-item]').forEach(card => observer?.observe(card))
    node.addEventListener('load', schedule, true)
    node.addEventListener('error', schedule, true)
    window.addEventListener('resize', schedule)
    return () => {
      disposed = true
      if (frame) window.cancelAnimationFrame(frame)
      observer?.disconnect()
      node.removeEventListener('load', schedule, true)
      node.removeEventListener('error', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [signature])

  return <div ref={root} className={styles.masonry} role="list"
    aria-label="Topic 项目" data-measured={ready ? 'true' : 'false'}
    style={ready && placement ? { height: placement.height } : undefined}>
    {projects.map((project, index) =>
      <div key={keys[index]} role="listitem" className={styles.masonryItem}
        data-topic-masonry-item=""
        style={ready && placement ? placement.positions[index] : undefined}>
        <TopicProjectCard project={project}/>
      </div>)}
  </div>
}
