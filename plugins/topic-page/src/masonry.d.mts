export interface MasonryPlacement {
  readonly columns: number
  readonly keys: readonly string[]
  readonly assignments: readonly number[]
  readonly positions: readonly { left: number; top: number; width: number }[]
  readonly height: number
}
export function masonryColumns(width: number): number
export function layoutMasonry(input: {
  keys: readonly string[]
  heights: readonly number[]
  width: number
  gap?: number
  previous?: MasonryPlacement | null
}): MasonryPlacement
