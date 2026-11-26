export interface GitHubRepositoryTarget {
  readonly owner: string
  readonly name: string
  readonly full_name: string
  readonly url: string
}
export declare function parseGitHubRepositoryUrl(input: unknown): GitHubRepositoryTarget | null
export declare function resourcePath(owner: string, repo: string, kind?: string, number?: number): string | null
export declare function parseGitHubResourceUrl(input: unknown): (GitHubRepositoryTarget & {kind:string; number?:number; path:string}) | null
export declare function validLoginReturnPath(path: unknown): string
export declare function repositoryLinkPath(path: unknown): string | null
