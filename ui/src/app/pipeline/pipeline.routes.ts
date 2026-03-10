import { Routes } from '@angular/router';

export const PIPELINE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./pipeline-shell.component').then(m => m.PipelineShellComponent),
    children: [
      {
        path: '',
        loadComponent: () => import('./pipeline-list.component').then(m => m.PipelineListComponent),
      },
      {
        path: ':id',
        loadComponent: () => import('./pipeline-editor.component').then(m => m.PipelineEditorComponent),
      },
    ],
  },
];
