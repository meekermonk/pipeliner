import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { take } from 'rxjs/operators';
import { ThemeService } from '../services/theme.service';
import { EmbedBridgeService } from '../services/embed-bridge.service';

@Component({
  selector: 'app-pipeline-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  template: `
    <!-- Flow gradient stripe -->
    <div class="flow-stripe" *ngIf="!embedBridge.isEmbedded"></div>

    <div class="shell">
      <!-- Top bar -->
      <header class="topbar" *ngIf="!embedBridge.isEmbedded">
        <div class="topbar-brand">
          <span class="brand-logo">Pipeliner</span>
          <span class="brand-sub">Monks.Flow</span>
        </div>
        <div class="topbar-actions">
          <button class="theme-btn" (click)="theme.toggle()" [title]="themeLabel()">
            <span class="material-symbols-outlined">{{ themeIcon() }}</span>
          </button>
          <a class="ops-link" href="https://opsagent.mf4g.studio" target="_blank" rel="noopener">
            <span class="material-symbols-outlined ops-link-icon">hub</span>
            Ops Console
            <span class="material-symbols-outlined ops-link-arrow">open_in_new</span>
          </a>
        </div>
      </header>

      <!-- Content -->
      <main class="shell-content">
        <router-outlet></router-outlet>
      </main>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100vh; overflow: hidden; }

    .flow-stripe {
      position: fixed;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: linear-gradient(90deg, #1A73E8 0%, #E8710A 33%, #F9AB00 66%, #0D652D 100%);
      z-index: 100;
    }

    .shell {
      display: flex;
      flex-direction: column;
      height: 100vh;
      padding-top: 3px;
      font-family: var(--font-sans);
    }

    /* ── Glass top bar ── */
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 24px;
      height: 52px;
      background: rgba(255, 255, 255, 0.72);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--color-outline-variant);
      box-shadow: 0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.1);
      flex-shrink: 0;
      z-index: 10;
    }

    :host-context([data-theme="dark"]) .topbar {
      background: rgba(30, 30, 30, 0.72);
    }

    .topbar-brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .brand-logo {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.3px;
      background: linear-gradient(135deg, #1A73E8, #9334E6);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .brand-sub {
      font-size: 11px;
      font-weight: 500;
      color: var(--color-on-surface-variant);
      padding: 2px 10px;
      background: var(--color-surface-variant);
      border-radius: 10px;
    }

    .topbar-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .theme-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border: none;
      background: none;
      border-radius: 8px;
      color: var(--color-on-surface-variant);
      cursor: pointer;
      transition: background 150ms, color 150ms;

      .material-symbols-outlined { font-size: 20px; }
      &:hover {
        background: var(--color-surface-variant);
        color: var(--color-on-surface);
      }
    }

    .ops-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 500;
      color: var(--color-on-surface-variant);
      text-decoration: none;
      border: 1px solid var(--color-outline-variant);
      border-radius: 8px;
      transition: all 200ms cubic-bezier(0.22, 1, 0.36, 1);
      cursor: pointer;

      &:hover {
        background: var(--color-surface-variant);
        color: var(--color-on-surface);
        border-color: var(--color-outline);
      }
    }

    .ops-link-icon { font-size: 16px; }
    .ops-link-arrow { font-size: 14px; opacity: 0.5; }

    /* ── Content area ── */
    .shell-content {
      flex: 1;
      overflow-y: auto;
      background: var(--color-surface-dim);
    }
  `],
})
export class PipelineShellComponent implements OnInit, OnDestroy {
  theme = inject(ThemeService);
  readonly embedBridge = inject(EmbedBridgeService);
  private bridgeSub = new Subscription();

  ngOnInit(): void {
    if (this.embedBridge.isEmbedded) {
      this.bridgeSub.add(
        this.embedBridge.on('INIT').pipe(take(1)).subscribe(() => {
          this.embedBridge.sendToParent('TOOL_READY', {
            tool: 'pipeline',
            embedded: true,
            protocol_version: 1,
          });
        })
      );

      this.bridgeSub.add(
        this.embedBridge.on('SYNC_REQUEST').subscribe(() => {
          this.embedBridge.consumeDirty();
          this.embedBridge.sendToParent('SYNC_RESPONSE', {
            manifest_data: null,
          });
        })
      );
    }
  }

  ngOnDestroy(): void {
    this.bridgeSub.unsubscribe();
  }

  themeIcon(): string {
    const m = this.theme.mode();
    return m === 'light' ? 'light_mode' : m === 'dark' ? 'dark_mode' : 'routine';
  }

  themeLabel(): string {
    const m = this.theme.mode();
    return m === 'light' ? 'Light' : m === 'dark' ? 'Dark' : 'System';
  }
}
