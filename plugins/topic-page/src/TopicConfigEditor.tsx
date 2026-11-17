import type { TopicConfigResult, TopicSnapshot } from './service'
import styles from './topic-page.module.css'

/** @summary Keep missing Topic YAML editable but never write before user confirmation. */
export default function TopicConfigEditor({snapshot, draft, authenticated, pending,
  uncertain, error, result, loginUrl, onChange, onSave, onConfirmUnknown}:{
  readonly snapshot:TopicSnapshot;readonly draft:string;readonly authenticated:boolean
  readonly pending:boolean;readonly uncertain:boolean;readonly error:string
  readonly result:TopicConfigResult|null;readonly loginUrl:string
  readonly onChange:(value:string)=>void;readonly onSave:()=>void
  readonly onConfirmUnknown:()=>void
}){
  return <section className={styles.configPanel} aria-labelledby="topic-config-heading">
    <div className={styles.sectionHeading}>
      <h2 id="topic-config-heading">Topic 配置</h2>
      <span className={styles.note}>{snapshot.defaultBranch} ·
        {snapshot.configState==='missing'?'尚未初始化':'已读取生效配置'}</span>
    </div>
    <p className={styles.note}>仅维护仓库根目录的 topics.config.yaml。字段：topic、whitelist（默认 true）。
      配置在 GitHub 合并后才生效，项目来源清单仍由 projects/*.yaml 管理。</p>
    <label className={styles.configLabel} htmlFor="topic-config-yaml">编辑 Topic YAML</label>
    <textarea id="topic-config-yaml" className={styles.configEditor}
      spellCheck={false} rows={5} value={draft}
      onChange={event=>onChange(event.target.value)} disabled={pending}/>
    <div className={styles.configActions}>
      {authenticated?<button type="button" disabled={pending||uncertain}
        onClick={onSave}>{pending?'正在提交…':'确认提交配置'}</button>:
        <a href={loginUrl}>登录 GitHub 后提交配置</a>}
      {uncertain&&<button type="button" onClick={onConfirmUnknown}>
        我已在 GitHub 核查，允许再次提交</button>}
    </div>
    {error&&<p className={styles.errorText} role="alert">{error}</p>}
    {result?.state==='committed'&&<p role="status">配置已提交并从默认分支回读。</p>}
    {result?.state==='unchanged'&&<p role="status">配置没有变化。</p>}
    {result?.state==='pending_pr'&&<p role="status">
      已创建维护 PR；合并前继续使用默认分支原配置。
      {result.prUrl&&<a href={result.prUrl} target="_blank" rel="noopener noreferrer">
        查看维护 PR</a>}</p>}
    {result?.state==='partial_failure'&&<p className={styles.errorText} role="alert">
      配置写入尚未完整完成，请先检查 GitHub：{result.error}
      {result.branchUrl&&<a href={result.branchUrl} target="_blank"
        rel="noopener noreferrer">查看维护分支</a>}</p>}
  </section>
}
