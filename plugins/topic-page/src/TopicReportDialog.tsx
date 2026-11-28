import { useEffect, useRef, type FormEvent, type RefObject } from 'react'
import styles from './topic-page.module.css'

export type TopicReportDialogProps = {
  title: string; body: string; pending: boolean; checking: boolean;
  returnFocusRef?: RefObject<HTMLElement|null>;
  uncertain: boolean; message: string;
  writeEnabled: boolean; githubNewIssueUrl: string; githubIssuesUrl: string; loginUrl: string;
  onTitleChange(value: string): void; onBodyChange(value: string): void;
  onCancel(): void; onConfirmUnknown(): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}

/** @summary Keep draft and submission failures visible inside the accessible report editor. */
export default function TopicReportDialog(props: TopicReportDialogProps) {
  const dialogRef=useRef<HTMLElement>(null)
  const previousFocus=useRef<HTMLElement|null>(null)
  const closeRef=useRef(props.onCancel)
  closeRef.current=props.onCancel
  const pendingRef=useRef(props.pending)
  pendingRef.current=props.pending
  useEffect(()=>{
    const dialog=dialogRef.current
    if(!dialog)return
    previousFocus.current=props.returnFocusRef?.current||(document.activeElement instanceof HTMLElement?document.activeElement:null)
    const focusable=()=>Array.from(dialog.querySelectorAll<HTMLElement>('a[href],button,input,textarea,select,[tabindex]'))
      .filter(el=>!el.hasAttribute('disabled')&&el.tabIndex>=0&&!el.closest('[hidden]'))
    const focusFirst=()=> (focusable()[0]||dialog).focus()
    focusFirst()
    function key(event:KeyboardEvent){
      if(event.key==='Escape'){
        event.preventDefault()
        if(!pendingRef.current)closeRef.current()
      }else if(event.key==='Tab'){
        const items=focusable(),first=items[0],last=items.at(-1)
        if(!first||!last){event.preventDefault();dialog?.focus();return}
        if(event.shiftKey&&(document.activeElement===first||!dialog?.contains(document.activeElement))){
          event.preventDefault();last.focus()
        }else if(!event.shiftKey&&(document.activeElement===last||!dialog?.contains(document.activeElement))){
          event.preventDefault();first.focus()
        }
      }
    }
    function focus(event:FocusEvent){if(event.target instanceof Node&&!dialog?.contains(event.target))focusFirst()}
    document.addEventListener('keydown',key)
    document.addEventListener('focusin',focus)
    return ()=>{
      document.removeEventListener('keydown',key);document.removeEventListener('focusin',focus)
      if(previousFocus.current?.isConnected)previousFocus.current.focus()
    }
  },[])
  return <div className={styles.dialogBackdrop}>
    <section ref={dialogRef} tabIndex={-1} className={styles.dialog} role="dialog" aria-modal="true"
      aria-labelledby="topic-report-heading">
      <h2 id="topic-report-heading">向当前仓库提交错误报告</h2>
      <form onSubmit={props.onSubmit}>
        <label>标题
          <input required maxLength={256} value={props.title} readOnly={props.pending}
            onChange={e => { if (!props.pending) props.onTitleChange(e.target.value) }}/>
        </label>
        <label>正文
          <textarea required rows={8} maxLength={20000} value={props.body} readOnly={props.pending}
            onChange={e => { if (!props.pending) props.onBodyChange(e.target.value) }}/>
        </label>
        {props.message && <p role="alert" className={styles.errorText}>{props.message}</p>}
        {props.checking && <p role="status" className={styles.reportWarning}>
          正在以当前 GitHub 登录身份核查公开仓库与 Issues 创建权限…
        </p>}
        {!props.writeEnabled && !props.checking && !props.uncertain &&
          <p role="status" className={styles.reportWarning}>
            当前不能确认写入权限。可保留草稿并在 GitHub 手动提交。
          </p>}
        {props.uncertain && <div role="status" className={styles.reportWarning}>
          <p>之前的创建结果未知，禁止自动重复提交。请先打开 GitHub Issues 核对是否已有该报告。</p>
          <a href={props.githubIssuesUrl} target="_blank" rel="noopener noreferrer">
            查看现有 Issues
          </a>
          <button type="button" onClick={props.onConfirmUnknown} disabled={props.pending}>
            我已在 GitHub 核查，允许再次提交
          </button>
        </div>}
        <p className={styles.note}>请检查报告内容是否包含个人信息。系统不会主动加入令牌、Cookie 或服务端配置。</p>
        <div className={styles.errorActions}>
          <button type="button" onClick={props.onCancel} disabled={props.pending}>关闭</button>
          <button type="submit" disabled={props.pending || !props.writeEnabled}>
            {props.pending ? '提交中…' : '确认提交 Issue'}
          </button>
          {!props.writeEnabled && !props.checking && !props.uncertain &&
            <a href={props.loginUrl}>重新登录 GitHub</a>}
          <a href={props.githubNewIssueUrl} target="_blank" rel="noopener noreferrer">
            在 GitHub 手动提交
          </a>
        </div>
      </form>
    </section>
  </div>
}
