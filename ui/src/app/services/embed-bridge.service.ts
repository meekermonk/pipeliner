import { Injectable, OnDestroy } from '@angular/core';
import { Subject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';

export interface BridgeMessage {
  source: 'core-agents' | 'storyboard-tool' | 'pipeliner';
  type: string;
  payload: Record<string, unknown>;
  protocol_version?: number;
}

const ALLOWED_PARENT_ORIGINS = [
  'https://core-agents.mf4g.studio',
  'https://mf4g.studio',
  'http://localhost:4200',
  'http://localhost:4300',
];

@Injectable({ providedIn: 'root' })
export class EmbedBridgeService implements OnDestroy {
  readonly isEmbedded = window.self !== window.top;
  private parentOrigin: string | null = null;
  private dirty = false;
  private readonly parentMessages$ = new Subject<BridgeMessage>();
  private listener: ((event: MessageEvent) => void) | null = null;

  constructor() {
    if (!this.isEmbedded) return;

    this.listener = (event: MessageEvent) => {
      if (!ALLOWED_PARENT_ORIGINS.includes(event.origin)) return;
      if (event.data?.source !== 'core-agents') return;
      if (!this.parentOrigin) this.parentOrigin = event.origin;
      this.parentMessages$.next(event.data as BridgeMessage);
    };

    window.addEventListener('message', this.listener);
  }

  sendToParent(type: string, payload: Record<string, unknown> = {}): void {
    if (!this.isEmbedded || !this.parentOrigin) return;
    window.parent.postMessage(
      { source: 'pipeliner' as const, type, payload, protocol_version: 1 },
      this.parentOrigin,
    );
  }

  on(type: string): Observable<BridgeMessage> {
    return this.parentMessages$.pipe(filter(m => m.type === type));
  }

  markDirty(): void { this.dirty = true; }
  consumeDirty(): boolean { const was = this.dirty; this.dirty = false; return was; }
  isDirty(): boolean { return this.dirty; }

  ngOnDestroy(): void {
    if (this.listener) window.removeEventListener('message', this.listener);
    this.parentMessages$.complete();
  }
}
