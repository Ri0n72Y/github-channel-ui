export interface GitHubRepositoryTarget {
  readonly owner: string
  readonly name: string
  readonly full_name: string
  readonly url: string
}
export declare function parseGitHubRepositoryUrl(input: unknown): GitHubRepositoryTarget | null
