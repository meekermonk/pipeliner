import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadChildren: () => import('./pipeline/pipeline.routes').then(m => m.PIPELINE_ROUTES),
  },
];
