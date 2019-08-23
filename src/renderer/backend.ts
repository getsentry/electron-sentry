import { crashReporter, ipcRenderer, remote } from 'electron';

import { BrowserBackend } from '@sentry/browser/dist/backend';
import { BaseBackend, Scope } from '@sentry/core';
import { Event, EventHint, Response, Severity, Status } from '@sentry/types';
import { SyncPromise } from '@sentry/utils';

import { CommonBackend, ElectronOptions, IPC_EVENT, IPC_PING, IPC_SCOPE } from '../common';

/** Timeout used for registering with the main process. */
const PING_TIMEOUT = 500;

/** Backend implementation for Electron renderer backends. */
export class RendererBackend extends BaseBackend<ElectronOptions> implements CommonBackend<ElectronOptions> {
  /** The inner SDK used to record JavaScript events. */
  private readonly _inner: BrowserBackend;

  /** Creates a new Electron backend instance. */
  public constructor(options: ElectronOptions) {
    super(options);

    if (this._isNativeEnabled()) {
      this._installNativeHandler();
    }

    this._inner = new BrowserBackend({
      enabled: this._isJavaScriptEnabled(),
      ...options,
    });

    this._pingMainProcess();
  }

  /**
   * @inheritDoc
   */
  public eventFromException(exception: any, hint?: EventHint): SyncPromise<Event> {
    return this._inner.eventFromException(exception, hint);
  }

  /**
   * @inheritDoc
   */
  public eventFromMessage(message: string, level?: Severity, hint?: EventHint): SyncPromise<Event> {
    return this._inner.eventFromMessage(message, level, hint);
  }

  /**
   * @inheritDoc
   * TODO
   */
  public async sendEvent(event: Event): Promise<Response> {
    ipcRenderer.send(IPC_EVENT, event);
    // This is a fire and forget thing
    return { status: Status.Success };
  }

  /**
   * @inheritDoc
   */
  public storeScope(scope: Scope): void {
    ipcRenderer.send(IPC_SCOPE, scope);
  }

  /** Returns whether JS is enabled. */
  private _isJavaScriptEnabled(): boolean {
    return this._options.enableJavaScript !== false;
  }

  /** Returns whether native reports are enabled. */
  private _isNativeEnabled(): boolean {
    // On macOS, we should start the Electron CrashReporter only in the main
    // process. It uses Crashpad internally, which will catch errors from all
    // sub processes thanks to out-of-processes crash handling. On other
    // platforms we need to start the CrashReporter in every sub process. For
    // more information see: https://goo.gl/nhqqwD
    if (process.platform === 'darwin') {
      return false;
    }

    // Mac AppStore builds cannot run the crash reporter due to the sandboxing
    // requirements. In this case, we prevent enabling native crashes entirely.
    // https://electronjs.org/docs/tutorial/mac-app-store-submission-guide#limitations-of-mas-build
    if (process.mas) {
      return false;
    }

    return this._options.enableNative !== false;
  }

  /** Activates the Electron CrashReporter. */
  private _installNativeHandler(): boolean {
    // We will manually submit errors, but CrashReporter requires a submitURL in
    // some versions. Also, provide a productName and companyName, which we will
    // add manually to the event's context during submission.
    crashReporter.start({
      companyName: '',
      ignoreSystemCrashHandler: true,
      productName: remote.app.getName(),
      submitURL: '',
      uploadToServer: false,
    });

    return true;
  }

  /** Checks if the main processes is available and logs a warning if not. */
  private _pingMainProcess(): void {
    // For whatever reason we have to wait PING_TIMEOUT until we send the ping
    // to main.
    setTimeout(() => {
      ipcRenderer.send(IPC_PING);

      const timeout = setTimeout(() => {
        console.warn('Could not connect to Sentry main process. Did you call init?');
      }, PING_TIMEOUT);

      ipcRenderer.on(IPC_PING, () => {
        clearTimeout(timeout);
      });
    }, PING_TIMEOUT);
  }
}
