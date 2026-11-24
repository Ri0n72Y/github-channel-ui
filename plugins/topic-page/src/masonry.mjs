/** @summary Deterministic shortest-column placement. Existing keys keep their columns on append or height changes. */
export const masonryColumns = width => width >= 1100 ? 5 : width >= 880 ? 4 :
  width >= 640 ? 3 : width >= 460 ? 2 : 1

/**
 * @param {{keys: string[], heights: number[], width: number, gap?: number, previous?: {columns:number,keys:string[],assignments:number[]}|null}} input
 */
export function layoutMasonry({ keys, heights, width, gap = 13, previous = null }) {
  if (!Number.isFinite(width) || width <= 0 || keys.length !== heights.length) {
    throw new RangeError('Topic Masonry requires a measured width and matching cards')
  }
  const columns = masonryColumns(width)
  const columnWidth = Math.max(1, (width - gap * (columns - 1)) / columns)
  const reuse = previous?.columns === columns && previous.keys.length <= keys.length &&
    previous.keys.every((key, index) => key === keys[index])
  const levels = Array(columns).fill(0)
  const assignments = []
  const positions = keys.map((key, index) => {
    const height = Number.isFinite(heights[index]) ? Math.max(0, heights[index]) : 0
    let column = reuse && index < previous.assignments.length ? previous.assignments[index] : -1
    if (!Number.isInteger(column) || column < 0 || column >= columns) {
      column = levels.indexOf(Math.min(...levels))
    }
    const top = levels[column]
    levels[column] = top + height + gap
    assignments.push(column)
    return { left: column * (columnWidth + gap), top, width: columnWidth }
  })
  return { columns, keys: [...keys], assignments, positions,
    height: keys.length ? Math.max(0, ...levels) - gap : 0 }
}
