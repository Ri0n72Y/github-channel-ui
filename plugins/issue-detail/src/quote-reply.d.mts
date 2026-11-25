import type { QuoteReply } from './view-model'
export const COMMENT_LIMIT: 20000
export function commentPermalink(value: unknown, owner: string, repo: string, number: number, id: number): string | null
export function createQuoteReply(comment: { id: number; body: string; html_url: string; user?: { login: string } }, owner: string, repo: string, number: number): QuoteReply | null
export function buildCommentReply(draft: string, quote: QuoteReply | null): string
