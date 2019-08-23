import { app, crashReporter, ipcMain } from 'electron';
import { join } from 'path';

import { addBreadcrumb, BaseBackend, captureEvent, captureMessage, configureScope, Dsn, Scope } from '@sentry/core';
// import { getCurrentHub } from '@sentry/node'; TODO
import { NodeBackend } from '@sentry/node/dist/backend';
import { Breadcrumb, Event, EventHint, Response, Severity, Status } from '@sentry/types';
import { forget, SentryError, SyncPromise } from '@sentry/utils';

import { CommonBackend, ElectronOptions, IPC_CRUMB, IPC_EVENT, IPC_PING, IPC_SCOPE } from '../common';
// import { captureMinidump } from '../sdk'; TODO
import { normalizeUrl } from './normalize';
import { Store } from './store';
import { MinidumpUploader } from './uploader';

/** Patch to access internal CrashReporter functionality. */
interface CrashReporterExt {
  getCrashesDirectory(): string;
}

/** Gets the path to the Sentry cache directory. */
function getCachePath(): string {
  return join(app.getPath('userData'), 'sentry');
}

/**
 * Retruns a promise that resolves when app is ready.
 */
export async function isAppReady(): Promise<boolean> {
  return (
    app.isReady() ||
    new Promise<boolean>(resolve => {
      app.once('ready', resolve);
    })
  );
}

/** Backend implementation for Electron renderer backends. */
export class MainBackend extends BaseBackend<ElectronOptions> implements CommonBackend<ElectronOptions> {
  /** The inner SDK used to record Node events. */
  private readonly _inner: NodeBackend;

  /** Store to persist context information beyond application crashes. */
  private readonly _scopeStore: Store<Scope>;

  /** Uploader for minidump files. */
  private _uploader?: MinidumpUploader;

  /** Creates a new Electron backend instance. */
  public constructor(options: ElectronOptions) {
    super(options);
    this._inner = new NodeBackend(options);
    this._scopeStore = new Store<Scope>(getCachePath(), 'scope', new Scope());

    let success = true;

    // We refill the scope here to not have an empty one
    configureScope(scope => {
      // tslint:disable:no-unsafe-any
      const loadedScope = Scope.clone(this._scopeStore.get()) as any;

      if (loadedScope.user) {
        scope.setUser(loadedScope.user);
      }
      if (loadedScope.tags) {
        Object.keys(loadedScope.tags).forEach(key => {
          scope.setTag(key, loadedScope.tags[key]);
        });
      }
      if (loadedScope.extra) {
        Object.keys(loadedScope.extra).forEach(key => {
          scope.setExtra(key, loadedScope.extra[key]);
        });
      }
      if (loadedScope.breadcrumbs) {
        loadedScope.breadcrumbs.forEach((crumb: any) => {
          scope.addBreadcrumb(crumb);
        });
      }
      // tslint:enable:no-unsafe-any
    });

    if (this._isNativeEnabled()) {
      success = this._installNativeHandler() && success;
    }

    this._installIPC();
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
  public eventFromMessage(message: string): SyncPromise<Event> {
    return this._inner.eventFromMessage(message);
  }

  /**
   * @inheritDoc
   */
  public sendEvent(event: Event): void {
    // await isAppReady(); TODO
    this._inner.sendEvent(event);
  }

  /**
   * Uploads the given minidump and attaches event information.
   *
   * @param path A relative or absolute path to the minidump file.
   * @param event Optional event information to add to the minidump request.
   * @returns A promise that resolves to the status code of the request.
   */
  public async uploadMinidump(path: string, event: Event = {}): Promise<Response> {
    if (this._uploader) {
      return this._uploader.uploadMinidump({ path, event });
    }
    return { status: Status.Success };
  }

  /**
   * @inheritDoc
   */
  public storeScope(scope: Scope): void {
    const cloned = Scope.clone(scope);
    (cloned as any).eventProcessors = [];
    // tslint:disable-next-line:no-object-literal-type-assertion
    this._scopeStore.update((current: Scope) => ({ ...current, ...cloned } as Scope));
  }

  /** Returns whether native reports are enabled. */
  private _isNativeEnabled(): boolean {
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
    // We are only called by the frontend if the SDK is enabled and a valid DSN
    // has been configured. If no DSN is present, this indicates a programming
    // error.
    const dsnString = this._options.dsn;
    if (!dsnString) {
      throw new SentryError('Invariant exception: install() must not be called when disabled');
    }

    const dsn = new Dsn(dsnString);

    // We will manually submit errors, but CrashReporter requires a submitURL in
    // some versions. Also, provide a productName and companyName, which we will
    // add manually to the event's context during submission.
    crashReporter.start({
      companyName: '',
      ignoreSystemCrashHandler: true,
      productName: app.getName(),
      submitURL: MinidumpUploader.minidumpUrlFromDsn(dsn),
      uploadToServer: false,
    });

    // The crashReporter has an undocumented method to retrieve the directory
    // it uses to store minidumps in. The structure in this directory depends
    // on the crash library being used (Crashpad or Breakpad).
    const reporter: CrashReporterExt = crashReporter as any;
    const crashesDirectory = reporter.getCrashesDirectory();

    this._uploader = new MinidumpUploader(dsn, crashesDirectory, getCachePath());

    // Flush already cached minidumps from the queue.
    forget(this._uploader.flushQueue());

    // Start to submit recent minidump crashes. This will load breadcrumbs and
    // context information that was cached on disk prior to the crash.
    forget(this._sendNativeCrashes({}));

    // Every time a subprocess or renderer crashes, start sending minidumps
    // right away.
    app.on('web-contents-created', (_, contents) => {
      contents.on('crashed', async () => {
        try {
          await this._sendNativeCrashes(this._getRendererExtra(contents));
        } catch (e) {
          console.error(e);
        }

        addBreadcrumb({
          category: 'exception',
          level: Severity.Critical,
          message: 'Renderer Crashed',
          timestamp: new Date().getTime() / 1000,
        });
      });

      if (this._options.enableUnresponsive !== false) {
        contents.on('unresponsive', () => {
          captureMessage('BrowserWindow Unresponsive');
        });
      }
    });

    return true;
  }

  /** Installs IPC handlers to receive events and metadata from renderers. */
  private _installIPC(): void {
    ipcMain.on(IPC_PING, (event: Electron.Event) => {
      event.sender.send(IPC_PING);
    });

    ipcMain.on(IPC_CRUMB, (_: any, crumb: Breadcrumb) => {
      addBreadcrumb(crumb);
    });

    ipcMain.on(IPC_EVENT, (ipc: Electron.Event, event: Event) => {
      event.extra = {
        ...this._getRendererExtra(ipc.sender),
        ...event.extra,
      };
      captureEvent(event);
    });

    ipcMain.on(IPC_SCOPE, (_: any, rendererScope: Scope) => {
      // tslint:disable:no-unsafe-any
      const sentScope = Scope.clone(rendererScope) as any;
      configureScope(scope => {
        if (sentScope.user) {
          scope.setUser(sentScope.user);
        }
        if (sentScope.tags) {
          Object.keys(sentScope.tags).forEach(key => {
            scope.setTag(key, sentScope.tags[key]);
          });
        }
        if (sentScope.extra) {
          Object.keys(sentScope.extra).forEach(key => {
            scope.setExtra(key, sentScope.extra[key]);
          });
        }
      });
      // tslint:enable:no-unsafe-any
    });
  }

  /** Loads new native crashes from disk and sends them to Sentry. */
  private async _sendNativeCrashes(_extra: object): Promise<void> {
    // Whenever we are called, assume that the crashes we are going to load down
    // below have occurred recently. This means, we can use the same event data
    // for all minidumps that we load now. There are two conditions:
    //
    //  1. The application crashed and we are just starting up. The stored
    //     breadcrumbs and context reflect the state during the application
    //     crash.
    //
    //  2. A renderer process crashed recently and we have just been notified
    //     about it. Just use the breadcrumbs and context information we have
    //     right now and hope that the delay was not too long.

    const uploader = this._uploader;
    if (uploader === undefined) {
      throw new SentryError('Invariant violation: Native crashes not enabled');
    }

    // TODO
    // const currentCloned = Scope.clone(getCurrentHub().getScope());
    // const fetchedScope = this._scopeStore.get();
    // const storedScope = Scope.clone(fetchedScope);
    // let event: Event | null = { extra };
    // event = await storedScope.applyToEvent(event);
    // event = event && (await currentCloned.applyToEvent(event));
    // const paths = await uploader.getNewMinidumps();
    // paths.map(path => {
    //   captureMinidump(path, { ...event });
    // });
  }

  /** Returns extra information from a renderer's web contents. */
  private _getRendererExtra(contents: Electron.WebContents): { [key: string]: any } {
    const customName = this._options.getRendererName && this._options.getRendererName(contents);

    return {
      crashed_process: customName || `renderer[${contents.id}]`,
      crashed_url: normalizeUrl(contents.getURL()),
    };
  }
}
