import { Injectable, signal, effect, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type ThemeMode = 'light' | 'dark' | 'system';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly STORAGE_KEY = 'pipeliner-theme';
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private mediaQuery: MediaQueryList | null = null;

  /** Current user preference: light, dark, or system */
  readonly mode = signal<ThemeMode>(this.loadPreference());

  /** Resolved active theme (what's actually applied) */
  readonly active = signal<'light' | 'dark'>('light');

  constructor() {
    if (this.isBrowser) {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.active.set(this.resolve(this.mode()));

      // React to mode changes
      effect(() => {
        const m = this.mode();
        localStorage.setItem(this.STORAGE_KEY, m);
        this.apply(m);
      });

      // React to system theme changes
      this.mediaQuery.addEventListener('change', () => {
        if (this.mode() === 'system') {
          this.apply('system');
        }
      });
    }
  }

  toggle(): void {
    const current = this.mode();
    const next: ThemeMode = current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light';
    this.mode.set(next);
  }

  setMode(mode: ThemeMode): void {
    this.mode.set(mode);
  }

  private loadPreference(): ThemeMode {
    if (typeof localStorage === 'undefined') return 'system';
    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    return 'system';
  }

  private resolve(mode: ThemeMode): 'light' | 'dark' {
    if (mode === 'system') return this.mediaQuery?.matches ? 'dark' : 'light';
    return mode;
  }

  private apply(mode: ThemeMode): void {
    const resolved = this.resolve(mode);
    this.active.set(resolved);
    const html = document.documentElement;
    if (mode === 'system') {
      html.removeAttribute('data-theme');
    } else {
      html.setAttribute('data-theme', mode);
    }
  }
}
