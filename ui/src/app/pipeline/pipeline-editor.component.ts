import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  OnInit,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FFlowModule, FCanvasComponent, FCreateNodeEvent, FCreateConnectionEvent } from '@foblex/flow';
import { ApiService } from '../services/api.service';

/* ═══════════════════════════════════════════════════════════════════════════
   Agent Registry — typed from CoreAgents schemas
   ═══════════════════════════════════════════════════════════════════════════ */

interface AgentPort {
  name: string;
  type: 'string' | 'list' | 'dict' | 'number' | 'object';
  description: string;
}

interface AgentDef {
  id: string;
  name: string;
  icon: string;
  group: 'operational' | 'content' | 'io';
  description: string;
  color: string;
  modes: ('pipeline' | 'studio')[];
  inputs: AgentPort[];
  outputs: AgentPort[];
  order?: number;
}

interface WorkflowNode {
  id: string;
  agentId: string;
  name: string;
  icon: string;
  group: string;
  color: string;
  position: { x: number; y: number };
  mode: 'pipeline' | 'studio';
  config: Record<string, any>;
}

interface WorkflowEdge {
  id: string;
  outputId: string;
  inputId: string;
}

const AGENT_REGISTRY: AgentDef[] = [
  // ── I/O Agents ──
  {
    id: 'google-drive',
    name: 'Google Drive',
    icon: 'drive_file_move',
    group: 'io',
    color: '#0F9D58',
    description: 'Import from or export to Google Drive',
    modes: ['pipeline'],
    inputs: [{ name: 'content', type: 'string', description: 'Content to export' }],
    outputs: [{ name: 'text_content', type: 'string', description: 'Extracted text content' }],
    order: 0,
  },

  // ── Operational Agents ──
  {
    id: 'briefing', name: 'Briefing', icon: 'description', group: 'operational',
    description: 'Transform unstructured inputs into structured 9-section briefs',
    color: '#1A73E8', modes: ['pipeline', 'studio'], order: 0,
    inputs: [
      { name: 'brief_text', type: 'string', description: 'Raw campaign brief or document text' },
      { name: 'brand_config', type: 'dict', description: 'Brand context and guidelines' },
    ],
    outputs: [
      { name: 'campaign_objective', type: 'string', description: 'Structured campaign objective' },
      { name: 'target_audience', type: 'string', description: 'Target audience description' },
      { name: 'key_messages', type: 'list', description: 'Core messages to communicate' },
      { name: 'workstream_briefs', type: 'list', description: 'Decomposed briefs for downstream agents' },
      { name: 'recommended_pipeline', type: 'list', description: 'Suggested agent sequence' },
      { name: 'complexity_assessment', type: 'string', description: 'simple / moderate / complex' },
    ],
  },
  {
    id: 'proposal', name: 'Proposal', icon: 'handshake', group: 'operational',
    description: 'Generate strategic proposals with territories, timelines, and budgets',
    color: '#1A73E8', modes: ['pipeline', 'studio'],
    inputs: [
      { name: 'brief_config', type: 'object', description: 'Complete brief configuration' },
    ],
    outputs: [
      { name: 'strategic_approach', type: 'string', description: 'Recommended strategic approach' },
      { name: 'territories', type: 'list', description: '3-4 creative direction options' },
      { name: 'channels', type: 'list', description: 'Channel and format recommendations' },
      { name: 'budget_breakdown', type: 'list', description: 'Budget allocation by category' },
    ],
  },
  {
    id: 'production_planner', name: 'Production Planner', icon: 'assignment', group: 'operational',
    description: 'Create per-asset production manifests with detailed specifications',
    color: '#1A73E8', modes: ['pipeline', 'studio'], order: 6,
    inputs: [
      { name: 'brief_data', type: 'object', description: 'Structured brief' },
      { name: 'creative_concepts', type: 'list', description: 'Concepts from Creative Director' },
      { name: 'strategy', type: 'object', description: 'Strategy framework' },
    ],
    outputs: [
      { name: 'manifest_id', type: 'string', description: 'Unique manifest identifier' },
      { name: 'total_assets', type: 'number', description: 'Total asset count' },
      { name: 'assets', type: 'list', description: 'Per-asset specs with dimensions, formats, platforms' },
    ],
  },
  {
    id: 'quality_gate', name: 'Quality Gate', icon: 'verified', group: 'operational',
    description: 'Score assets against ABCD framework (Attract, Brand, Connect, Direct)',
    color: '#1A73E8', modes: ['pipeline'], order: 11,
    inputs: [
      { name: 'assets', type: 'list', description: 'Generated assets to evaluate' },
      { name: 'brand_config', type: 'dict', description: 'Brand context for scoring' },
    ],
    outputs: [
      { name: 'asset_scores', type: 'list', description: 'ABCD scores per asset (0-100)' },
      { name: 'gate_status', type: 'string', description: 'OPEN or BLOCKED' },
      { name: 'blocking_issues', type: 'list', description: 'Issues preventing gate passage' },
    ],
  },
  {
    id: 'producer', name: 'Producer', icon: 'fact_check', group: 'operational',
    description: 'Final QA, asset validation, and delivery manifest generation',
    color: '#1A73E8', modes: ['pipeline', 'studio'], order: 12,
    inputs: [
      { name: 'pipeline_outputs', type: 'object', description: 'All upstream outputs' },
      { name: 'quality_scores', type: 'list', description: 'ABCD scores from Quality Gate' },
    ],
    outputs: [
      { name: 'manifest', type: 'dict', description: 'Complete delivery manifest' },
      { name: 'validation_results', type: 'list', description: 'Platform spec validation' },
      { name: 'qa_summary', type: 'string', description: 'Quality assurance report' },
    ],
  },
  {
    id: 'optimizer', name: 'Optimizer', icon: 'tune', group: 'operational',
    description: 'Analyze assets for creative optimization opportunities',
    color: '#1A73E8', modes: ['pipeline', 'studio'],
    inputs: [
      { name: 'assets', type: 'list', description: 'Assets with quality scores' },
      { name: 'abcd_evaluations', type: 'list', description: 'ABCD evaluation results' },
    ],
    outputs: [
      { name: 'critical_issues', type: 'list', description: 'Must-fix issues' },
      { name: 'high_impact_improvements', type: 'list', description: 'Recommended improvements' },
      { name: 'platform_recommendations', type: 'dict', description: 'Per-platform optimization tips' },
    ],
  },

  // ── Content Creation Agents ──
  {
    id: 'persona', name: 'Persona', icon: 'person_search', group: 'content',
    description: 'Generate detailed micro-personas with psychographics and platform affinity',
    color: '#9334E6', modes: ['pipeline', 'studio'], order: 1,
    inputs: [
      { name: 'brief_data', type: 'object', description: 'Structured brief from Briefing agent' },
    ],
    outputs: [
      { name: 'personas', type: 'list', description: 'Persona profiles with demographics, psychographics, pain points' },
    ],
  },
  {
    id: 'strategy', name: 'Strategy', icon: 'psychology', group: 'content',
    description: 'Develop creative strategy frameworks with platform-specific approaches',
    color: '#9334E6', modes: ['pipeline', 'studio'], order: 2,
    inputs: [
      { name: 'brief_data', type: 'object', description: 'Structured brief' },
      { name: 'personas', type: 'list', description: 'Persona profiles from Persona agent' },
    ],
    outputs: [
      { name: 'feature_focus', type: 'string', description: 'Product/service feature to emphasize' },
      { name: 'thematic_angle', type: 'string', description: 'Creative theme or concept' },
      { name: 'platform_strategy', type: 'dict', description: 'Per-platform strategy' },
      { name: 'cta_logic', type: 'string', description: 'Call-to-action strategy' },
    ],
  },
  {
    id: 'creative_director', name: 'Creative Director', icon: 'palette', group: 'content',
    description: 'Generate scored creative concepts with visual direction and shot lists',
    color: '#9334E6', modes: ['pipeline', 'studio'], order: 3,
    inputs: [
      { name: 'brief_data', type: 'object', description: 'Structured brief' },
      { name: 'strategy', type: 'object', description: 'Strategy framework' },
      { name: 'personas', type: 'list', description: 'Target personas' },
    ],
    outputs: [
      { name: 'static_concepts', type: 'list', description: 'Image/display creative concepts' },
      { name: 'video_concepts', type: 'list', description: 'Video concepts with shot lists' },
      { name: 'selected_concept_index', type: 'number', description: 'Recommended concept (0-based)' },
    ],
  },
  {
    id: 'copy', name: 'Copy', icon: 'edit_note', group: 'content',
    description: 'Generate platform-optimized copy — headlines, body, CTAs per platform',
    color: '#9334E6', modes: ['pipeline', 'studio'], order: 5,
    inputs: [
      { name: 'strategy_brief', type: 'object', description: 'Strategy framework' },
      { name: 'brand_config', type: 'dict', description: 'Brand voice and guidelines' },
      { name: 'platforms', type: 'list', description: 'Target platforms (meta, tiktok, youtube, etc.)' },
      { name: 'languages', type: 'list', description: 'Target languages for translation' },
    ],
    outputs: [
      { name: 'copy_variations', type: 'list', description: 'Copy per platform: hook, body, CTA, character counts' },
    ],
  },
  {
    id: 'storyboard', name: 'Storyboard', icon: 'movie_creation', group: 'content',
    description: 'Generate visual storyboards with frame-by-frame direction',
    color: '#9334E6', modes: ['pipeline'],
    inputs: [
      { name: 'creative_direction', type: 'object', description: 'Creative concept to storyboard' },
      { name: 'storyboard_type', type: 'string', description: 'video / display_ad / ux_flow' },
    ],
    outputs: [
      { name: 'storyboard_frames', type: 'list', description: 'Frame-by-frame: description, camera, transition, duration' },
      { name: 'total_duration_seconds', type: 'number', description: 'Total storyboard duration' },
    ],
  },
  {
    id: 'image', name: 'Image', icon: 'image', group: 'content',
    description: 'Generate campaign images via Imagen 4 with platform-specific formats',
    color: '#9334E6', modes: ['pipeline', 'studio'], order: 8,
    inputs: [
      { name: 'production_manifest', type: 'object', description: 'Asset specs from Production Planner' },
      { name: 'strategy_brief', type: 'object', description: 'Creative direction and brand context' },
    ],
    outputs: [
      { name: 'generated_images', type: 'list', description: 'Images: GCS URI, signed URL, dimensions, prompt used' },
    ],
  },
  {
    id: 'video', name: 'Video', icon: 'videocam', group: 'content',
    description: 'Produce video via Veo 3.1 — 7 sub-agents for full production pipeline',
    color: '#9334E6', modes: ['pipeline', 'studio'], order: 9,
    inputs: [
      { name: 'strategy_brief', type: 'object', description: 'Creative direction' },
      { name: 'brand_config', type: 'dict', description: 'Brand assets and guidelines' },
      { name: 'video_config', type: 'dict', description: 'Duration, aspect ratio, model tier' },
    ],
    outputs: [
      { name: 'video_assets', type: 'list', description: 'Videos: GCS URI, duration, aspect ratio, status' },
      { name: 'concept', type: 'dict', description: 'Title, logline, visual style, mood' },
      { name: 'script', type: 'string', description: 'Complete video script with VO direction' },
    ],
  },
  {
    id: 'audio', name: 'Audio', icon: 'mic', group: 'content',
    description: 'Generate voiceovers (5 voices) and background music, mix audio tracks',
    color: '#9334E6', modes: ['pipeline'],  order: 10,
    inputs: [
      { name: 'copy_data', type: 'object', description: 'VO scripts from Copy agent' },
      { name: 'creative_direction', type: 'object', description: 'Mood, tone, pacing direction' },
    ],
    outputs: [
      { name: 'voice_assets', type: 'list', description: 'Voiceovers: GCS URI, voice name, text length' },
      { name: 'music_assets', type: 'list', description: 'Background music: GCS URI, duration, mood' },
      { name: 'mixed_audio', type: 'list', description: 'Mixed tracks: GCS URI, track count' },
    ],
  },
];

const AGENT_GROUPS: { key: string; label: string; icon: string; color: string; expanded: boolean }[] = [
  { key: 'io', label: 'I/O', icon: 'swap_horiz', color: '#0F9D58', expanded: true },
  { key: 'content', label: 'Creative Agents', icon: 'auto_awesome', color: '#9334E6', expanded: true },
  { key: 'operational', label: 'Operational Agents', icon: 'settings_suggest', color: '#1A73E8', expanded: false },
];

@Component({
  selector: 'app-pipeline-editor',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatSelectModule,
    MatFormFieldModule,
    FFlowModule,
  ],
  template: `
    <div class="editor-shell">
      <!-- Toolbar -->
      <div class="editor-toolbar">
        <div class="toolbar-left">
          <button mat-icon-button (click)="goBack()" matTooltip="Back to workflows">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <div class="toolbar-divider"></div>
          <div class="toolbar-brand">
            <span class="brand-mark">Pipeliner</span>
            <span class="brand-sub">Monks.Flow</span>
          </div>
          <div class="toolbar-divider"></div>
          <input
            class="pipeline-name-input"
            [(ngModel)]="pipelineName"
            (blur)="saveName()"
            placeholder="Untitled workflow"
          />
        </div>
        <div class="toolbar-center">
          <div class="toolbar-stat">
            <span class="material-symbols-outlined stat-icon">hub</span>
            {{ nodes.length }} nodes
          </div>
          <div class="toolbar-stat">
            <span class="material-symbols-outlined stat-icon">timeline</span>
            {{ edges.length }} connections
          </div>
        </div>
        <div class="toolbar-right">
          <button mat-icon-button (click)="fitToScreen()" matTooltip="Fit to screen">
            <mat-icon>fit_screen</mat-icon>
          </button>
          <div class="toolbar-divider"></div>
          <button mat-button class="toolbar-btn" (click)="save()">
            <mat-icon>save</mat-icon>
            Save
          </button>
          <button mat-flat-button color="primary" class="toolbar-btn run-btn" (click)="run()" [disabled]="nodes.length === 0">
            <mat-icon>play_arrow</mat-icon>
            Run
          </button>
        </div>
      </div>

      <div class="editor-body">
        <!-- Agent Library -->
        <div class="palette">
          <div class="palette-search">
            <span class="material-symbols-outlined search-icon">search</span>
            <input class="search-input" placeholder="Search agents..." [(ngModel)]="searchQuery" />
          </div>

          <div class="palette-scroll">
            @for (group of agentGroups; track group.key) {
              @if (getAgentsByGroup(group.key).length > 0) {
                <div class="palette-group">
                  <button class="group-header" [style.--group-color]="group.color" (click)="toggleGroup(group)">
                    <span class="material-symbols-outlined group-icon">{{ group.icon }}</span>
                    <span class="group-label">{{ group.label }}</span>
                    <span class="group-count">{{ getAgentsByGroup(group.key).length }}</span>
                    <span class="material-symbols-outlined group-chevron" [class.expanded]="group.expanded">expand_more</span>
                  </button>
                  @if (group.expanded) {
                    <div class="group-agents">
                      @for (agent of getAgentsByGroup(group.key); track agent.id) {
                        <div
                          class="palette-agent"
                          fExternalItem
                          [fExternalItemId]="'agent-' + agent.id"
                          [fData]="agent"
                          [style.--agent-color]="agent.color"
                        >
                          <div class="agent-icon-wrap">
                            <span class="material-symbols-outlined">{{ agent.icon }}</span>
                          </div>
                          <div class="agent-info">
                            <span class="agent-name">{{ agent.name }}</span>
                            <span class="agent-desc">{{ agent.description }}</span>
                            <div class="agent-badges">
                              <span class="io-badge">{{ agent.inputs.length }} in</span>
                              <span class="io-badge">{{ agent.outputs.length }} out</span>
                            </div>
                          </div>
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            }
          </div>

          <div class="palette-footer">
            <span class="material-symbols-outlined">drag_indicator</span>
            Drag agents onto canvas to build workflow
          </div>
        </div>

        <!-- Canvas -->
        <div class="canvas-container" [class.connect-mode]="!!armedPortId" (click)="onCanvasClick()">
          <f-flow
            fFlowId="workflow"
            fDraggable
            (fCreateNode)="onNodeDropped($event)"
            (fCreateConnection)="onConnectionCreated($event)"
          >
            <f-canvas
              fZoom
              [fZoomMinimum]="0.3"
              [fZoomMaximum]="2.0"
              [position]="canvasPosition"
              [scale]="canvasScale"
            >
              <f-background>
                <f-circle-pattern fPattern></f-circle-pattern>
              </f-background>
              <f-line-alignment></f-line-alignment>
              <f-selection-area></f-selection-area>
              <f-connection-for-create></f-connection-for-create>

              @for (node of nodes; track node.id) {
                <div
                  class="workflow-node"
                  fNode
                  [fNodeId]="node.id"
                  [(fNodePosition)]="node.position"
                  [style.--node-color]="node.color"
                  [style.--node-color-soft]="node.color + '0D'"
                  [style.--node-color-glow]="node.color + '30'"
                >
                  <!-- Header -->
                  <div class="node-header" fDragHandle>
                    <div class="node-icon-wrap">
                      <span class="material-symbols-outlined">{{ node.icon }}</span>
                    </div>
                    <span class="node-title">{{ node.name }}</span>
                    <button class="node-delete" (click)="deleteNode(node.id); $event.stopPropagation()">
                      <span class="material-symbols-outlined">close</span>
                    </button>
                  </div>

                  <!-- Agent selector -->
                  <div class="node-config">
                    <div class="config-row">
                      <label class="config-label">Agent</label>
                      <select
                        class="config-select"
                        [ngModel]="node.agentId"
                        (ngModelChange)="changeNodeAgentById(node, $event)"
                      >
                        <optgroup label="I/O">
                          @for (a of getAgentsByGroup('io'); track a.id) {
                            <option [value]="a.id">{{ a.name }}</option>
                          }
                        </optgroup>
                        <optgroup label="Creative Agents">
                          @for (a of getAgentsByGroup('content'); track a.id) {
                            <option [value]="a.id">{{ a.name }}</option>
                          }
                        </optgroup>
                        <optgroup label="Operational Agents">
                          @for (a of getAgentsByGroup('operational'); track a.id) {
                            <option [value]="a.id">{{ a.name }}</option>
                          }
                        </optgroup>
                      </select>
                    </div>
                  </div>

                  <!-- I/O Ports -->
                  <div class="node-io">
                    <div class="io-section io-inputs">
                      <span class="io-label">INPUTS</span>
                      @for (inp of getAgentDef(node.agentId)?.inputs || []; track inp.name) {
                        <div class="io-port" [matTooltip]="inp.description" matTooltipPosition="left">
                          <div
                            class="port port-input"
                            [class.port-armed]="armedPortId === 'in-' + node.id + '-' + inp.name"
                            [class.port-receivable]="isPortReceivable('in-' + node.id + '-' + inp.name, 'input')"
                            fNodeInput
                            [fInputId]="'in-' + node.id + '-' + inp.name"
                            fInputConnectableSide="left"
                            [fInputMultiple]="true"
                            (dblclick)="onPortDoubleClick('in-' + node.id + '-' + inp.name, 'input', $event)"
                            (click)="onPortClick('in-' + node.id + '-' + inp.name, 'input', $event)"
                          ></div>
                          <span class="port-name">{{ inp.name }}</span>
                          <span class="port-type">{{ inp.type }}</span>
                        </div>
                      }
                    </div>
                    <div class="io-section io-outputs">
                      <span class="io-label">OUTPUTS</span>
                      @for (out of getAgentDef(node.agentId)?.outputs || []; track out.name) {
                        <div class="io-port" [matTooltip]="out.description" matTooltipPosition="right">
                          <span class="port-type">{{ out.type }}</span>
                          <span class="port-name">{{ out.name }}</span>
                          <div
                            class="port port-output"
                            [class.port-armed]="armedPortId === 'out-' + node.id + '-' + out.name"
                            [class.port-receivable]="isPortReceivable('out-' + node.id + '-' + out.name, 'output')"
                            fNodeOutput
                            [fOutputId]="'out-' + node.id + '-' + out.name"
                            fOutputConnectableSide="right"
                            (dblclick)="onPortDoubleClick('out-' + node.id + '-' + out.name, 'output', $event)"
                            (click)="onPortClick('out-' + node.id + '-' + out.name, 'output', $event)"
                          ></div>
                        </div>
                      }
                    </div>
                  </div>
                </div>
              }

              @for (edge of edges; track edge.id) {
                <f-connection
                  [fConnectionId]="edge.id"
                  [fOutputId]="edge.outputId"
                  [fInputId]="edge.inputId"
                  fType="bezier"
                ></f-connection>
              }
            </f-canvas>
          </f-flow>

          @if (nodes.length === 0) {
            <div class="canvas-empty">
              <div class="empty-brand">
                <span class="empty-logo">Pipeliner</span>
              </div>
              <h3>Build your production workflow</h3>
              <p>Drag agents from the library to chain together your creative production pipeline — from briefing through delivery.</p>
              <div class="empty-hints">
                <div class="hint"><span class="material-symbols-outlined">drag_indicator</span> Drag to add</div>
                <div class="hint"><span class="material-symbols-outlined">timeline</span> Connect ports</div>
                <div class="hint"><span class="material-symbols-outlined">tune</span> Configure agents</div>
              </div>
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }

    /* ── CoreAgents design tokens ── */
    :host {
      --ca-elevation-1: 0 1px 2px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.1);
      --ca-elevation-2: 0 2px 6px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.06);
      --ca-elevation-3: 0 4px 12px rgba(0,0,0,0.1), 0 8px 24px rgba(0,0,0,0.08);
      --ca-glass-bg: rgba(255, 255, 255, 0.72);
      --ca-glass-bg-dark: rgba(30, 30, 30, 0.72);
      --ca-glass-blur: blur(12px);
      --ca-ease-out: cubic-bezier(0.22, 1, 0.36, 1);
      --ca-ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    .editor-shell {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: calc(100vh - 2px);
      background: var(--color-surface-variant, #f8f9fa);
    }

    /* ═══ Toolbar — glass header ═══ */
    .editor-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 20px;
      background: var(--ca-glass-bg);
      backdrop-filter: var(--ca-glass-blur);
      -webkit-backdrop-filter: var(--ca-glass-blur);
      border-bottom: 1px solid var(--color-outline-variant);
      box-shadow: var(--ca-elevation-1);
      flex-shrink: 0;
      z-index: 10;
      height: 56px;
    }
    .toolbar-left, .toolbar-right, .toolbar-center { display: flex; align-items: center; gap: 10px; }
    .toolbar-divider { width: 1px; height: 24px; background: var(--color-outline-variant); }

    .toolbar-brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .brand-mark {
      font-size: 17px;
      font-weight: 600;
      color: var(--color-on-surface);
      letter-spacing: -0.3px;
    }
    .brand-sub {
      font-size: 11px;
      font-weight: 500;
      color: var(--color-on-surface-variant);
      padding: 2px 8px;
      background: var(--color-surface-variant);
      border-radius: 10px;
    }

    .toolbar-stat {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      font-weight: 500;
      color: var(--color-on-surface-variant);
      background: var(--color-surface-variant);
      padding: 3px 10px;
      border-radius: 12px;
      .stat-icon { font-size: 14px; width: 14px; height: 14px; }
    }
    .toolbar-btn {
      font-size: 13px; font-weight: 500;
      border-radius: 8px !important;
      transition: all 200ms var(--ca-ease-out);
      &:active { transform: scale(0.97); }
    }
    .run-btn { border-radius: 8px !important; }

    .pipeline-name-input {
      border: none;
      background: transparent;
      font-family: var(--font-sans);
      font-size: 16px;
      font-weight: 600;
      color: var(--color-on-surface);
      padding: 6px 10px;
      border-radius: 8px;
      min-width: 200px;
      letter-spacing: -0.2px;
      transition: background 150ms;
      &:hover { background: var(--color-surface-variant); }
      &:focus { background: var(--color-surface-variant); outline: 2px solid var(--color-primary); outline-offset: 0; }
    }

    :host-context([data-theme="dark"]) .editor-toolbar,
    :host-context([data-theme="dark"]) .palette-search { background: var(--ca-glass-bg-dark); }
    :host-context([data-theme="dark"]) .palette { background: var(--color-surface, #1e1e1e); }

    /* ═══ Body ═══ */
    .editor-body { display: flex; flex: 1; overflow: hidden; }

    /* ═══ Palette / Agent Library — CoreAgents sidebar ═══ */
    .palette {
      width: 280px;
      min-width: 280px;
      border-right: 1px solid var(--color-outline-variant);
      background: var(--color-surface);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      overflow: hidden;
    }
    .palette-search {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border-bottom: 1px solid rgba(0,0,0,0.06);
      background: var(--ca-glass-bg);
      backdrop-filter: var(--ca-glass-blur);
      -webkit-backdrop-filter: var(--ca-glass-blur);
      position: sticky; top: 0; z-index: 2;
      .search-icon { font-size: 20px; color: var(--color-on-surface-variant); }
    }
    .search-input {
      flex: 1; border: none; background: none;
      font-family: var(--font-sans); font-size: 13px;
      color: var(--color-on-surface); outline: none;
      &::placeholder { color: var(--color-on-surface-variant); }
    }
    .palette-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 6px 8px;
      &::-webkit-scrollbar { width: 6px; }
      &::-webkit-scrollbar-track { background: transparent; }
      &::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 3px; }
      &::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.25); }
    }
    .palette-group { padding: 0; }
    .group-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      width: 100%;
      border: none;
      background: transparent;
      cursor: pointer;
      font-family: var(--font-sans);
      color: var(--group-color, var(--color-primary));
      border-bottom: 1px solid rgba(0,0,0,0.06);
      transition: background 150ms;
      &:hover { background: var(--color-surface-variant); }
      .group-icon { font-size: 18px; width: 18px; height: 18px; }
      .group-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; flex: 1; text-align: left; }
      .group-count {
        font-size: 10px; font-weight: 600;
        background: var(--group-color, var(--color-primary));
        color: white; padding: 1px 6px; border-radius: 10px;
        min-width: 20px; text-align: center;
      }
      .group-chevron {
        font-size: 18px; width: 18px; height: 18px;
        transition: transform 200ms var(--ca-ease-out);
        opacity: 0.6;
        &.expanded { transform: rotate(180deg); }
      }
    }
    .group-agents {
      padding: 4px 0;
      animation: accordionOpen 200ms var(--ca-ease-out);
    }
    @keyframes accordionOpen {
      from { opacity: 0; max-height: 0; }
      to { opacity: 1; max-height: 800px; }
    }
    .palette-agent {
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 10px;
      cursor: grab;
      user-select: none;
      margin-bottom: 2px;
      transition: background 200ms var(--ca-ease-out),
                  transform 120ms var(--ca-ease-spring);
      &::before {
        content: '';
        position: absolute;
        left: 0; top: 50%;
        width: 3px; height: 0;
        border-radius: 0 3px 3px 0;
        background: var(--agent-color);
        transition: height 200ms var(--ca-ease-out), top 200ms var(--ca-ease-out);
      }
      &:hover {
        background: var(--color-surface-variant);
        &::before { height: 60%; top: 20%; }
      }
      &:active { cursor: grabbing; transform: scale(0.97); }
    }
    .agent-icon-wrap {
      display: flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0;
      background: color-mix(in srgb, var(--agent-color) 10%, transparent);
      .material-symbols-outlined { font-size: 18px; color: var(--agent-color); }
    }
    .agent-info { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
    .agent-name { font-size: 13px; font-weight: 500; color: var(--color-on-surface); }
    .agent-desc {
      font-size: 11px; color: var(--color-on-surface-variant); line-height: 1.3;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .agent-badges { display: flex; gap: 4px; margin-top: 2px; flex-wrap: wrap; }
    .io-badge, .mode-badge {
      font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 10px;
      line-height: 1.4;
    }
    .io-badge { background: var(--color-surface-variant); color: var(--color-on-surface-variant); }
    .mode-pipeline { background: #E8F0FE; color: #1A73E8; }
    .mode-studio { background: #F3E8FD; color: #9334E6; }

    .palette-footer {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 16px; border-top: 1px solid var(--color-outline-variant);
      font-size: 11px; color: var(--color-on-surface-variant);
      .material-symbols-outlined { font-size: 14px; }
    }

    /* ═══ Canvas ═══ */
    .canvas-container { flex: 1; position: relative; background: var(--color-surface-variant, #f8f9fa); }
    f-flow { width: 100%; height: 100%; }

    /* ═══ Empty State ═══ */
    .canvas-empty {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      display: flex; flex-direction: column; align-items: center;
      gap: 12px; pointer-events: none; text-align: center; max-width: 380px;
      h3 { font-size: 18px; font-weight: 600; color: var(--color-on-surface); margin: 0; letter-spacing: -0.3px; }
      p { font-size: 13px; color: var(--color-on-surface-variant); line-height: 1.5; margin: 0; }
    }
    .empty-brand { margin-bottom: 8px; }
    .empty-logo {
      font-size: 32px; font-weight: 800; letter-spacing: -0.03em;
      background: linear-gradient(135deg, #1A73E8, #9334E6);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .empty-hints { display: flex; gap: 20px; margin-top: 8px; }
    .hint {
      display: flex; align-items: center; gap: 4px;
      font-size: 11px; color: var(--color-on-surface-variant);
      .material-symbols-outlined { font-size: 16px; opacity: 0.6; }
    }

    /* ═══ Workflow Nodes — CoreAgents card style ═══ */
    .workflow-node {
      width: 260px;
      background: var(--color-surface);
      border: 1px solid var(--color-outline-variant);
      border-radius: 12px;
      overflow: visible;
      position: relative;
      box-shadow: var(--ca-elevation-1);
      transition: box-shadow 200ms var(--ca-ease-out), border-color 200ms var(--ca-ease-out);
      &:hover { box-shadow: var(--ca-elevation-2); border-color: var(--node-color); }
      &.f-selected { box-shadow: var(--ca-elevation-2), 0 0 0 2px var(--node-color); border-color: var(--node-color); }
    }

    .node-header {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 14px;
      background: var(--node-color);
      color: white; cursor: move;
      border-radius: 11px 11px 0 0;
    }
    .node-icon-wrap {
      display: flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 7px;
      background: rgba(255,255,255,0.2); flex-shrink: 0;
      .material-symbols-outlined { font-size: 16px; }
    }
    .node-title { flex: 1; font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .node-delete {
      background: none; border: none; cursor: pointer; padding: 2px;
      display: flex; opacity: 0; transition: opacity 120ms;
      color: rgba(255,255,255,0.8); border-radius: 4px;
      .material-symbols-outlined { font-size: 16px; }
      &:hover { color: white; background: rgba(255,255,255,0.15); }
    }
    .workflow-node:hover .node-delete { opacity: 1; }

    /* ═══ Node Config (dropdowns) ═══ */
    .node-config {
      padding: 8px 14px;
      background: var(--node-color-soft);
      display: flex;
      flex-direction: column;
      gap: 6px;
      border-bottom: 1px solid var(--color-outline-variant);
    }
    .config-row { display: flex; align-items: center; gap: 8px; }
    .config-label {
      font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--color-on-surface-variant); width: 40px; flex-shrink: 0;
    }
    .config-select {
      flex: 1; border: 1px solid var(--color-outline-variant); border-radius: 6px;
      background: var(--color-surface); color: var(--color-on-surface);
      font-family: var(--font-sans); font-size: 12px; font-weight: 500;
      padding: 4px 8px; outline: none;
      transition: border-color 150ms;
      &:focus { border-color: var(--node-color); }
    }

    /* ═══ Node I/O Ports ═══ */
    .node-io {
      padding: 8px 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .io-section { display: flex; flex-direction: column; gap: 2px; }
    .io-label {
      font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;
      color: var(--color-on-surface-variant); padding: 0 14px; margin-bottom: 2px;
    }
    .io-port {
      display: flex; align-items: center; gap: 4px;
      padding: 3px 14px; position: relative;
      font-size: 11px;
      transition: background 120ms;
      &:hover { background: var(--color-surface-variant); }
    }
    .port-name {
      font-family: var(--font-mono); font-size: 11px; font-weight: 500;
      color: var(--color-on-surface); flex: 1;
    }
    .io-outputs .port-name { text-align: right; }
    .port-type {
      font-size: 9px; font-weight: 600; text-transform: uppercase;
      color: var(--color-on-surface-variant); background: var(--color-surface-variant);
      padding: 1px 5px; border-radius: 4px;
    }

    .port {
      position: absolute;
      width: 10px; height: 10px; border-radius: 50%;
      top: 50%; transform: translateY(-50%);
      border: 2px solid var(--color-surface);
      background: var(--node-color);
      z-index: 1;
      transition: all 120ms var(--ca-ease-spring);
      &:hover {
        width: 14px; height: 14px;
        box-shadow: 0 0 0 3px var(--node-color-glow);
      }
    }
    .port-input { left: -6px; }
    .port-output { right: -6px; }

    /* ═══ Click-to-Connect States ═══ */
    .port-armed {
      width: 16px !important; height: 16px !important;
      background: white !important;
      border: 3px solid var(--node-color) !important;
      box-shadow: 0 0 0 4px var(--node-color), 0 0 12px var(--node-color) !important;
      animation: armed-pulse 1.2s ease-in-out infinite;
    }
    .port-receivable {
      width: 14px !important; height: 14px !important;
      background: var(--node-color) !important;
      box-shadow: 0 0 0 3px var(--node-color-glow), 0 0 8px var(--node-color-glow) !important;
      cursor: pointer !important;
      animation: receivable-breathe 1s ease-in-out infinite;
    }
    .port-receivable:hover {
      width: 18px !important; height: 18px !important;
      box-shadow: 0 0 0 4px var(--node-color), 0 0 16px var(--node-color) !important;
    }
    .connect-mode .workflow-node { pointer-events: auto; }
    .connect-mode .node-header,
    .connect-mode .node-config,
    .connect-mode .config-select,
    .connect-mode .node-delete { pointer-events: none; opacity: 0.6; }
    .connect-mode .io-port { pointer-events: auto; }

    @keyframes armed-pulse {
      0%, 100% { box-shadow: 0 0 0 4px var(--node-color), 0 0 12px var(--node-color); }
      50% { box-shadow: 0 0 0 6px var(--node-color), 0 0 20px var(--node-color); }
    }
    @keyframes receivable-breathe {
      0%, 100% { box-shadow: 0 0 0 3px var(--node-color-glow), 0 0 8px var(--node-color-glow); }
      50% { box-shadow: 0 0 0 5px var(--node-color-glow), 0 0 14px var(--node-color-glow); }
    }

    /* ═══ Foblex overrides ═══ */
    ::ng-deep {
      .f-connection path { stroke: var(--color-outline-variant, #dadce0); stroke-width: 2; fill: none; }
      .f-connection:hover path, .f-connection.f-selected path { stroke: var(--color-primary); stroke-width: 2.5; }
      f-circle-pattern circle { fill: var(--color-outline-variant, #dadce0); r: 1; }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PipelineEditorComponent implements OnInit {
  @ViewChild(FCanvasComponent) canvas!: FCanvasComponent;

  pipelineId = '';
  pipelineName = '';
  searchQuery = '';
  nodes: WorkflowNode[] = [];
  edges: WorkflowEdge[] = [];
  canvasPosition = { x: 0, y: 0 };
  canvasScale = 1.0;
  agentGroups = AGENT_GROUPS;

  // Cached agent lists to avoid recalculating on every change detection cycle
  cachedIoAgents: AgentDef[] = AGENT_REGISTRY.filter(a => a.group === 'io');
  cachedContentAgents: AgentDef[] = AGENT_REGISTRY.filter(a => a.group === 'content');
  cachedOperationalAgents: AgentDef[] = AGENT_REGISTRY.filter(a => a.group === 'operational');
  private lastSearchQuery = '';

  // Click-to-connect state
  armedPortId: string | null = null;
  armedPortDirection: 'input' | 'output' | null = null;

  private template: any = null;
  private nodeCounter = 0;
  private edgeCounter = 0;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private api: ApiService,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.pipelineId = this.route.snapshot.paramMap.get('id') || '';
    if (this.pipelineId) this.loadTemplate();
  }

  toggleGroup(group: { expanded: boolean }): void {
    group.expanded = !group.expanded;
  }

  getAgentsByGroup(group: string): AgentDef[] {
    // Recompute only when search query changes
    if (this.searchQuery !== this.lastSearchQuery) {
      this.lastSearchQuery = this.searchQuery;
      const q = this.searchQuery.trim().toLowerCase();
      const filterFn = q
        ? (a: AgentDef) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
        : () => true;
      this.cachedIoAgents = AGENT_REGISTRY.filter(a => a.group === 'io').filter(filterFn);
      this.cachedContentAgents = AGENT_REGISTRY.filter(a => a.group === 'content').filter(filterFn);
      this.cachedOperationalAgents = AGENT_REGISTRY.filter(a => a.group === 'operational').filter(filterFn);
    }
    if (group === 'io') return this.cachedIoAgents;
    return group === 'content' ? this.cachedContentAgents : this.cachedOperationalAgents;
  }

  getAgentDef(agentId: string): AgentDef | undefined {
    return AGENT_REGISTRY.find(a => a.id === agentId);
  }

  onNodeDropped(event: FCreateNodeEvent<AgentDef>): void {
    const agent = event.data;
    if (!agent) return;
    this.nodeCounter++;
    this.nodes = [...this.nodes, {
      id: `node-${Date.now()}-${this.nodeCounter}`,
      agentId: agent.id,
      name: agent.name,
      icon: agent.icon,
      group: agent.group,
      color: agent.color,
      position: event.rect ?? { x: 200, y: 200 },
      mode: 'pipeline',
      config: {},
    }];
    this.cdr.markForCheck();
  }

  onConnectionCreated(event: FCreateConnectionEvent): void {
    if (!event.fInputId) return;
    this.edgeCounter++;
    this.edges = [...this.edges, {
      id: `edge-${Date.now()}-${this.edgeCounter}`,
      outputId: event.fOutputId,
      inputId: event.fInputId,
    }];
    this.cdr.markForCheck();
  }

  changeNodeAgentById(node: WorkflowNode, agentId: string): void {
    const agent = this.getAgentDef(agentId);
    if (!agent) return;
    // Remove edges connected to old ports
    this.edges = this.edges.filter(e =>
      !e.outputId.startsWith(`out-${node.id}-`) && !e.inputId.startsWith(`in-${node.id}-`)
    );
    node.agentId = agent.id;
    node.name = agent.name;
    node.icon = agent.icon;
    node.group = agent.group;
    node.color = agent.color;
    node.mode = 'pipeline';
    // Force re-render
    this.nodes = [...this.nodes];
    this.cdr.markForCheck();
  }

  /* ═══ Click-to-Connect ═══
   * Double-click a port to "arm" it. Compatible ports on other nodes
   * highlight as receivable. Single-click a receivable port to wire.
   * Escape or clicking the canvas background disarms.
   */

  @HostListener('document:keydown.escape')
  disarmPort(): void {
    if (this.armedPortId) {
      this.armedPortId = null;
      this.armedPortDirection = null;
      this.cdr.markForCheck();
    }
  }

  onPortDoubleClick(portId: string, direction: 'input' | 'output', event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.armedPortId = portId;
    this.armedPortDirection = direction;
    this.cdr.markForCheck();
  }

  onPortClick(portId: string, direction: 'input' | 'output', event: MouseEvent): void {
    if (!this.armedPortId) return;
    event.stopPropagation();
    event.preventDefault();

    // Can only connect output→input or input→output
    if (direction === this.armedPortDirection) return;

    const outputId = direction === 'input' ? this.armedPortId : portId;
    const inputId = direction === 'input' ? portId : this.armedPortId;

    // Don't connect to same node
    const outputNodeId = outputId.split('-').slice(1, -1).join('-');
    const inputNodeId = inputId.split('-').slice(1, -1).join('-');
    if (outputNodeId === inputNodeId) return;

    // Don't create duplicate edges
    const exists = this.edges.some(e => e.outputId === outputId && e.inputId === inputId);
    if (exists) { this.disarmPort(); return; }

    this.edgeCounter++;
    this.edges = [...this.edges, {
      id: `edge-${Date.now()}-${this.edgeCounter}`,
      outputId,
      inputId,
    }];
    this.disarmPort();
  }

  isPortReceivable(portId: string, direction: 'input' | 'output'): boolean {
    if (!this.armedPortId || direction === this.armedPortDirection) return false;
    // Not on same node
    const armedNodeId = this.armedPortId.split('-').slice(1, -1).join('-');
    const thisNodeId = portId.split('-').slice(1, -1).join('-');
    return armedNodeId !== thisNodeId;
  }

  onCanvasClick(): void {
    this.disarmPort();
  }

  deleteNode(nodeId: string): void {
    this.nodes = this.nodes.filter(n => n.id !== nodeId);
    this.edges = this.edges.filter(e =>
      !e.outputId.includes(nodeId) && !e.inputId.includes(nodeId)
    );
    this.cdr.markForCheck();
  }

  fitToScreen(): void { this.canvas?.fitToScreen({ x: 50, y: 50 }, true); }

  private serializeGraph(): any {
    return {
      nodes: this.nodes.map(n => ({
        id: n.id,
        type: `ops-agent-${n.agentId}`,
        configuration: { agent_id: n.agentId, mode: n.mode, ...n.config },
        metadata: { position: n.position, icon: n.icon, color: n.color, name: n.name, group: n.group },
      })),
      edges: this.edges.map(e => ({ id: e.id, from_node: e.outputId, to_node: e.inputId })),
      graph_metadata: { canvas: { position: this.canvasPosition, scale: this.canvasScale } },
    };
  }

  private deserializeGraph(data: any): void {
    this.nodes = (data.nodes || []).map((n: any) => {
      const agentId = n.configuration?.agent_id || n.type?.replace('ops-agent-', '') || 'briefing';
      const def = this.getAgentDef(agentId);
      return {
        id: n.id,
        agentId,
        name: n.metadata?.name || def?.name || agentId,
        icon: n.metadata?.icon || def?.icon || 'smart_toy',
        group: n.metadata?.group || def?.group || 'operational',
        color: n.metadata?.color || def?.color || '#1A73E8',
        position: n.metadata?.position || { x: 100, y: 100 },
        mode: n.configuration?.mode || 'pipeline',
        config: n.configuration || {},
      };
    });
    this.edges = (data.edges || []).map((e: any) => ({
      id: e.id || `edge-${Date.now()}-${++this.edgeCounter}`,
      outputId: e.from_node,
      inputId: e.to_node,
    }));
    if (data.graph_metadata?.canvas) {
      this.canvasPosition = data.graph_metadata.canvas.position || { x: 0, y: 0 };
      this.canvasScale = data.graph_metadata.canvas.scale || 1.0;
    }
  }

  private loadTemplate(): void {
    this.api.getPipelineTemplate(this.pipelineId).subscribe({
      next: (tpl) => {
        this.template = tpl;
        this.pipelineName = tpl.name || '';
        if (tpl.nodes?.length || tpl.edges?.length) this.deserializeGraph(tpl);
        this.cdr.markForCheck();
      },
      error: () => this.snackBar.open('Failed to load workflow', 'Dismiss', { duration: 4000 }),
    });
  }

  saveName(): void {
    if (this.pipelineName && this.pipelineId) {
      this.api.updatePipelineTemplate(this.pipelineId, { name: this.pipelineName }).subscribe({
        error: () => this.snackBar.open('Failed to update name', 'Dismiss', { duration: 3000 }),
      });
    }
  }

  save(): void {
    if (!this.pipelineId) return;
    this.api.updatePipelineTemplate(this.pipelineId, { name: this.pipelineName, ...this.serializeGraph() }).subscribe({
      next: () => this.snackBar.open('Workflow saved', '', { duration: 2000 }),
      error: () => this.snackBar.open('Failed to save', 'Dismiss', { duration: 4000 }),
    });
  }

  run(): void {
    if (!this.pipelineId) return;
    this.save();
    this.api.startPipelineRun(this.pipelineId).subscribe({
      next: (r) => this.snackBar.open(`Run started (${r.status})`, '', { duration: 3000 }),
      error: () => this.snackBar.open('Failed to start run', 'Dismiss', { duration: 4000 }),
    });
  }

  goBack(): void { this.router.navigate(['/pipeline']); }
}
