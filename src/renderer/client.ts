import { BaseClient, getCurrentHub, Scope } from '@sentry/core';
import { Breadcrumb, SentryBreadcrumbHint, SentryEvent } from '@sentry/types';
// tslint:disable-next-line:no-implicit-dependencies
import { ipcRenderer } from 'electron';
import { CommonClient, ElectronOptions, IPC_CRUMB } from '../common';
import { RendererBackend } from './backend';
import { BrowserClient, ReportDialogOptions } from '@sentry/browser';

/** Frontend implementation for Electron renderer backends. */
export class RendererClient extends BaseClient<RendererBackend, ElectronOptions> implements CommonClient {
  /**
   * Internal used browser client
   */
  private inner: BrowserClient;

  /**
   * Creates a new Electron SDK instance.
   * @param options Configuration options for this SDK.
   */
  public constructor(options: ElectronOptions) {
    super(RendererBackend, options);
    this.inner = new BrowserClient(options);
  }

  /**
   * Uploads a native crash dump (Minidump) to Sentry.
   *
   * @param path The relative or absolute path to the minidump.
   * @param event Optional event payload to attach to the minidump.
   * @param scope The SDK scope used to upload.
   */
  public async captureMinidump(_path: string, _event: SentryEvent, _scope?: Scope): Promise<void> {
    // Noop
  }

  /**
   * @inheritDoc
   */
  public async addBreadcrumb(breadcrumb: Breadcrumb, _hint?: SentryBreadcrumbHint, _scope?: Scope): Promise<void> {
    ipcRenderer.send(IPC_CRUMB, breadcrumb);
  }

  /**
   * @inheritdoc {@link BrowserClient.showReportDialog}
   */
  public showReportDialog(options: ReportDialogOptions = {}): void {
    if (!options.eventId) {
      options.eventId = getCurrentHub().lastEventId();
    }
    this.inner.showReportDialog(options);
  }
}
