import React from 'react';
import { Link } from 'react-router-dom';
import { extractCodeBlocks, parseFence, actionLabel } from '../vibecoding/burkitBlocks';
import { describeProjectAction, ALWAYS_CONFIRM_OPS, ProjectAction } from '../../utils/burkitProjectTools';

/* Басты беттегі Бүркіттің (Gemini) жауабын көрсету: markdown (тақырып, тізім, сілтеме, код)
   және ```project блоктары — растау батырмалары бар әрекет карталары. */

// Жол ішіндегі markdown: **bold**, `code`, [сілтеме](/path)
function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={k}>{m[2]}</strong>);
    else if (m[3]) out.push(<code key={k} className="sai__icode">{m[4]}</code>);
    else if (m[7].startsWith('/')) out.push(<Link key={k} to={m[7]} className="sai__link">{m[6]}</Link>);
    else out.push(<a key={k} href={m[7]} target="_blank" rel="noopener noreferrer" className="sai__link">{m[6]}</a>);
    last = m.index + m[0].length;
    k++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const FILE_OP_LABEL: Record<string, string> = {
  write: 'Жазу',
  edit: 'Өзгерту',
  delete: 'Өшіру',
  move: 'Жылжыту',
  read: 'Оқу',
  note: 'Жазба',
  run: 'Команда',
};

export interface ActionState {
  /** Блок орындалды немесе өткізілді */
  handled: boolean;
  running: boolean;
  /** Батырмалар көрсетілсін (соңғы жауап, Бүркіт бос) */
  canAct: boolean;
  link?: string;
}

interface AgentTextProps {
  text: string;
  /** Жауап әлі келіп жатыр — жабылмаған блок көрсетілмейді */
  streaming: boolean;
  stateOf: (index: number) => ActionState;
  onAct: (index: number, skip: boolean) => void;
  onCopy: (text: string) => void;
}

export const AgentText: React.FC<AgentTextProps> = ({ text, streaming, stateOf, onAct, onCopy }) => {
  const blocks = extractCodeBlocks(text);
  const nodes: React.ReactNode[] = [];
  let blockIndex = 0;
  let inBlock = false;
  let fence = '';
  text.split('\n').forEach((line, i) => {
    if (line.startsWith('```')) {
      if (!inBlock) {
        inBlock = true;
        fence = line;
        return;
      }
      inBlock = false;
      const block = blocks[blockIndex];
      const index = blockIndex++;
      if (!block) return;
      const { action } = block;
      if (action?.kind === 'project') {
        nodes.push(<ActionCard key={`b${i}`} action={action} note={block.code} state={stateOf(index)} onAct={(skip) => onAct(index, skip)} onCopy={onCopy} />);
      } else if (action) {
        // Жобаның файлына жазу/өзгерту/оқу — ықшам жол, мәтіні ашылатын
        const label = action.kind === 'run' ? `$ ${block.code.split('\n')[0]}` : actionLabel(action);
        nodes.push(
          <details key={`b${i}`} className="sai__fileop">
            <summary>
              <span className="sai__fileop-kind">{FILE_OP_LABEL[action.kind] ?? action.kind}</span>
              <span className="sai__fileop-path">{label}</span>
            </summary>
            {block.code && <pre><code>{block.code}</code></pre>}
          </details>
        );
      } else {
        nodes.push(
          <div key={`b${i}`} className="sai__code">
            <div className="sai__code-bar">
              <span>{parseFence(fence).language}</span>
              <button type="button" onClick={() => onCopy(block.code)}>Көшіру</button>
            </div>
            <pre><code>{block.code}</code></pre>
          </div>
        );
      }
      return;
    }
    if (inBlock) return;
    const heading = /^#{1,3} (.*)$/.exec(line);
    if (heading) nodes.push(<p key={i} className="sai__md-h">{inline(heading[1])}</p>);
    else if (/^[-*] /.test(line)) nodes.push(<p key={i} className="sai__md-li">{inline(line.slice(2))}</p>);
    else if (line.trim()) nodes.push(<p key={i} className="sai__md-p">{inline(line)}</p>);
  });
  if (inBlock && streaming) {
    nodes.push(<p key="writing" className="sai__md-p sai__muted">…</p>);
  }
  return <div className="sai__md">{nodes}</div>;
};

interface ActionCardProps {
  action: ProjectAction;
  note: string;
  state: ActionState;
  onAct: (skip: boolean) => void;
  onCopy: (text: string) => void;
}

const ActionCard: React.FC<ActionCardProps> = ({ action, note, state, onAct, onCopy }) => {
  const danger = ALWAYS_CONFIRM_OPS.has(action.op);
  return (
    <div className={`sai__action ${danger ? 'is-danger' : ''}`}>
      <div className="sai__action-title">{describeProjectAction(action)}</div>
      {note && <p className="sai__action-note">{note}</p>}
      {state.link && (
        <div className="sai__action-link">
          <a href={state.link} target="_blank" rel="noopener noreferrer">{state.link}</a>
          <button type="button" onClick={() => onCopy(state.link!)}>Көшіру</button>
        </div>
      )}
      <div className="sai__action-foot">
        {state.running ? (
          <span className="sai__muted">Орындалып жатыр…</span>
        ) : state.handled ? (
          <span className="sai__action-done">✓ Қаралды</span>
        ) : state.canAct ? (
          <>
            <button type="button" className="sai__action-btn" onClick={() => onAct(true)}>Өткізу</button>
            <button type="button" className="sai__action-btn is-primary" onClick={() => onAct(false)}>
              {danger ? 'Растау' : 'Орындау'}
            </button>
          </>
        ) : (
          <span className="sai__muted">Орындалмаған</span>
        )}
      </div>
    </div>
  );
};
