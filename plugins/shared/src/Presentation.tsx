/** Presentation-only icons and dates; no resource or API policy. */
export function ExternalIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M13 5h6v6m0-6-9 9M19 14v5H5V5h5"/></svg>
}
export function ReplyIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m9 6-6 6 6 6m-6-6h12a5 5 0 0 1 5 5v1"/></svg>
}
/** Keep the original timestamp available, including malformed values. */
export function LocalTime({ value, label }: { value: string; label?: string }) {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed)
    ? <time dateTime={value} title={label ? label + '：' + value : value}>{new Date(parsed).toLocaleString('zh-CN')}</time>
    : <span title={value}>{value || '未知'}</span>
}
