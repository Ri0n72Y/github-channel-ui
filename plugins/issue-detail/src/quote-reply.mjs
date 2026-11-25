/** @summary Build a bounded GitHub Markdown reply from an already loaded comment. */
export const COMMENT_LIMIT = 20000
export function commentPermalink(value, owner, repo, number, id) {
  if (typeof value !== 'string' || !Number.isSafeInteger(number) || number <= 0 ||
      !Number.isSafeInteger(id) || id <= 0 || /[\s\\%]/u.test(value)) return null
  const match = /^https:\/\/github\.com\/([a-z\d-]+)\/([a-z\d._-]+)\/issues\/([1-9]\d*)#issuecomment-([1-9]\d*)$/i.exec(value)
  if (!match || match[1].toLowerCase() !== owner.toLowerCase() ||
      match[2].toLowerCase() !== repo.toLowerCase() ||
      match[3] !== String(number) || match[4] !== String(id)) return null
  return 'https://github.com/' + owner + '/' + repo + '/issues/' + number + '#issuecomment-' + id
}
export function createQuoteReply(comment, owner, repo, number) {
  if (!Number.isSafeInteger(comment?.id) || comment.id <= 0) return null
  const author = (typeof comment.user?.login === 'string' ? comment.user.login : '未知')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').trim().slice(0, 100) || '未知'
  const raw = (typeof comment.body === 'string' ? comment.body : '').replace(/\r\n?|\u2028|\u2029/g, '\n')
  // Bound the source excerpt by code points and lines; preserve the original line structure.
  const bounded = Array.from(raw).slice(0, 1000).join('')
  const text = bounded.split('\n').slice(0, 12).join('\n')
  return { id: comment.id, author, sourceUrl: commentPermalink(comment.html_url, owner, repo, number, comment.id),
    excerpt: text || '（空评论）', truncated: text !== raw }
}
export function buildCommentReply(draft, quote) {
  if (!quote) return draft
  // Normal GitHub logins are safe link labels; nonstandard labels (e.g. bots)
  // are escaped as text and use a constant link label understood by the shared renderer.
  const label = quote.author.replace(/[\\[\]<>@*_~\x60!()&#]/g, '\\$&')
  const normal = /^[a-z\d-]{1,39}$/i.test(quote.author)
  const heading = quote.sourceUrl
    ? normal ? '回复 [' + label + '](' + quote.sourceUrl + ')'
      : '回复 ' + label + ' · [原评论](' + quote.sourceUrl + ')'
    : '回复 ' + label
  // Every physical line is quoted, including empty/fenced lines. Escape raw HTML
  // and @ in quoted content; do not synthesize mentions or unquoted labour blocks.
  const lines = quote.excerpt.replace(/\r\n?|\u2028|\u2029/g, '\n').split('\n')
    .map(line => '> ' + line.replace(/[\\<@]/g, '\\$&'))
  if (quote.truncated) lines.push('> …（引用已截取）')
  return heading + '\n\n' + lines.join('\n') + '\n\n' + draft
}
