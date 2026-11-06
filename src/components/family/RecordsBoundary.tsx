import React from 'react';
import { noteDiag } from '../../lib/diagLog.mjs';

type Props = { children: React.ReactNode };
type State = { error: boolean };

/** A records-list render error stays on this list. The map and the rest of the app stay up. */
export class RecordsBoundary extends React.Component<Props, State> {
  state: State = { error: false };

  static getDerivedStateFromError(): State {
    return { error: true };
  }

  componentDidCatch(): void {
    noteDiag({ kind: 'records', reason: 'render' });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-2xl bg-slate-50 px-3 py-4" role="alert">
          <p className="text-sm font-black text-slate-900">기록을 열지 못했습니다</p>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">저장된 이동 기록은 그대로입니다. 다시 열면 목록을 다시 그립니다.</p>
          <button
            type="button"
            onClick={() => this.setState({ error: false })}
            className="mt-3 rounded-full bg-[#0084FF] px-4 py-2 text-xs font-bold text-white"
          >
            다시 열기
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
